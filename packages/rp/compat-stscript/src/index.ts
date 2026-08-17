/** Bounded, permission-gated STscript compatibility. @module @dsh-rp/compat-stscript */

import { Buffer } from 'node:buffer'
import type { Context } from '@deepseek-ai/cordis'
import { RpCapabilityId, RpComponentId, RpPackageId } from '@dsh-rp/contracts'
import type { JsonObject, JsonValue } from '@dsh-rp/contracts'
import type { RpCapabilityContribution } from '@dsh-rp/capability-catalog'
import type { RpComponentDefinition } from '@dsh-rp/component-runtime'

export const name = 'rp-compat-stscript'
export const inject = ['rpComponents', 'rpCapabilities']

const PACKAGE = RpPackageId('dsh-rp.compat-stscript')
const MAX_SOURCE_BYTES = 64 * 1024
const MAX_COMMANDS = 1_000
const DEFAULT_MAX_COMMANDS = 100
const MAX_CALL_DEPTH = 32
const DEFAULT_MAX_CALL_DEPTH = 8
const MAX_VARIABLES = 1_000
const MAX_STATE_BYTES = 1024 * 1024
const MAX_OUTPUT_CHARACTERS = 100_000
const DEFAULT_MAX_OUTPUT_CHARACTERS = 16_384
const NAME_PATTERN = /^[\p{L}\p{N}_.-]{1,128}$/u

/** Stable failure categories for callers and compatibility reports. */
export type ControlledStscriptErrorCode =
  | 'ABORTED'
  | 'BOUND_EXCEEDED'
  | 'INVALID_ARGUMENT'
  | 'INVALID_SOURCE'
  | 'QUICK_REPLY_CYCLE'
  | 'QUICK_REPLY_MISSING'
  | 'UNSUPPORTED_COMMAND'
  | 'UNSUPPORTED_MACRO'

/** A fail-closed STscript parse or execution failure. */
export class ControlledStscriptError extends Error {
  /** @param code - Stable failure category. @param message - Human-readable detail. */
  constructor(readonly code: ControlledStscriptErrorCode, message: string) {
    super(message)
    this.name = 'ControlledStscriptError'
  }
}

/** Explicit data and limits supplied to the pure interpreter. */
export interface ControlledStscriptOptions {
  readonly localVariables?: Readonly<JsonObject>
  readonly globalVariables?: Readonly<JsonObject>
  readonly quickReplies?: Readonly<Record<string, string>>
  readonly pipe?: JsonValue
  readonly maxCommands?: number
  readonly maxCallDepth?: number
  readonly maxOutputCharacters?: number
  readonly signal?: AbortSignal
}

/** Detached result of one controlled script invocation. */
export interface ControlledStscriptResult {
  readonly schemaVersion: 1
  readonly pipe: JsonValue
  readonly localVariables: JsonObject
  readonly globalVariables: JsonObject
  readonly output: readonly string[]
  readonly commandsExecuted: number
}

/** Register L1 script capabilities and independently selectable components. */
export function apply(ctx: Context): void {
  ctx.effect(function* () {
    for (const component of components()) yield ctx.rpComponents.register(component)
    for (const contribution of capabilities()) yield ctx.rpCapabilities.register(contribution)
  }, 'rp-compat-stscript registrations')
}

/**
 * Execute the safe STscript subset without network, filesystem, model, host, or message access.
 * @param source - Pipe-separated slash commands.
 * @param options - Explicit variables, Quick Reply library, bounds, and cancellation.
 * @returns Final pipe, detached variables, output, and deterministic command count.
 */
export function executeControlledStscript(
  source: string,
  options: ControlledStscriptOptions = {},
): ControlledStscriptResult {
  const limits = resolveLimits(options)
  const runtime: Runtime = {
    local: cloneObject(options.localVariables, 'localVariables'),
    global: cloneObject(options.globalVariables, 'globalVariables'),
    quickReplies: validateQuickReplies(options.quickReplies),
    pipe: cloneValue(options.pipe ?? ''),
    output: [],
    outputCharacters: 0,
    commands: 0,
    stack: [],
    ...limits,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  executeSource(source, runtime)
  validateState(runtime)
  return Object.freeze({
    schemaVersion: 1,
    pipe: cloneValue(runtime.pipe),
    localVariables: cloneObject(runtime.local, 'localVariables'),
    globalVariables: cloneObject(runtime.global, 'globalVariables'),
    output: Object.freeze([...runtime.output]),
    commandsExecuted: runtime.commands,
  })
}

/**
 * Execute one named Quick Reply from an explicitly supplied library.
 * @param label - Quick Reply label to invoke.
 * @param quickReplies - Explicit label-to-script library.
 * @param options - Variables, pipe, bounds, and cancellation controls.
 * @returns Detached bounded execution result.
 */
export function executeControlledQuickReply(
  label: string,
  quickReplies: Readonly<Record<string, string>>,
  options: Omit<ControlledStscriptOptions, 'quickReplies'> = {},
): ControlledStscriptResult {
  validateName(label, 'Quick Reply label')
  return executeControlledStscript(`/run ${quoteToken(label)}`, { ...options, quickReplies })
}

interface Limits {
  readonly maxCommands: number
  readonly maxCallDepth: number
  readonly maxOutputCharacters: number
}

interface Runtime extends Limits {
  readonly local: JsonObject
  readonly global: JsonObject
  readonly quickReplies: Readonly<Record<string, string>>
  pipe: JsonValue
  readonly output: string[]
  outputCharacters: number
  commands: number
  readonly stack: string[]
  readonly signal?: AbortSignal
}

function executeSource(source: string, runtime: Runtime): void {
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) fail('BOUND_EXCEEDED', `STscript source exceeds ${MAX_SOURCE_BYTES} bytes`)
  for (const segment of splitPipeline(source)) executeCommand(segment, runtime)
}

function executeCommand(segment: string, runtime: Runtime): void {
  checkAbort(runtime)
  runtime.commands += 1
  if (runtime.commands > runtime.maxCommands) fail('BOUND_EXCEEDED', `STscript exceeds ${runtime.maxCommands} commands`)
  if (!segment.startsWith('/')) fail('INVALID_SOURCE', `STscript segment must start with "/": ${JSON.stringify(segment)}`)
  const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/u.exec(segment)
  if (match === null) fail('INVALID_SOURCE', `Malformed STscript command ${JSON.stringify(segment)}`)
  const command = (match[1] ?? '').toLocaleLowerCase()
  const raw = match[2] ?? ''
  if (command.startsWith(':')) {
    runQuickReply(command.slice(1), runtime)
    return
  }
  switch (command) {
    case 'pass': runtime.pipe = parseScalar(commandText(raw, runtime)); break
    case 'echo': {
      const value = raw === '' ? renderValue(runtime.pipe) : commandText(raw, runtime)
      appendOutput(value, runtime)
      runtime.pipe = value
      break
    }
    case 'getvar': runtime.pipe = cloneValue(readVariable(runtime.local, positionalName(raw, runtime), 'local')); break
    case 'getglobalvar': runtime.pipe = cloneValue(readVariable(runtime.global, positionalName(raw, runtime), 'global')); break
    case 'setvar': setVariable(runtime.local, variableMutation(raw, runtime), runtime); break
    case 'setglobalvar': setVariable(runtime.global, variableMutation(raw, runtime), runtime); break
    case 'addvar': addVariable(runtime.local, variableMutation(raw, runtime), runtime); break
    case 'addglobalvar': addVariable(runtime.global, variableMutation(raw, runtime), runtime); break
    case 'incvar': incrementVariable(runtime.local, positionalName(raw, runtime), 1, runtime); break
    case 'decvar': incrementVariable(runtime.local, positionalName(raw, runtime), -1, runtime); break
    case 'incglobalvar': incrementVariable(runtime.global, positionalName(raw, runtime), 1, runtime); break
    case 'decglobalvar': incrementVariable(runtime.global, positionalName(raw, runtime), -1, runtime); break
    case 'flushvar': flushVariable(runtime.local, positionalName(raw, runtime), runtime); break
    case 'flushglobalvar': flushVariable(runtime.global, positionalName(raw, runtime), runtime); break
    case 'run': runQuickReply(positionalName(raw, runtime), runtime); break
    default: fail('UNSUPPORTED_COMMAND', `STscript command /${command} is outside the controlled compatibility subset`)
  }
  validateState(runtime)
}

function runQuickReply(label: string, runtime: Runtime): void {
  validateName(label, 'Quick Reply label')
  const source = runtime.quickReplies[label]
  if (source === undefined) fail('QUICK_REPLY_MISSING', `Quick Reply ${JSON.stringify(label)} is not available`)
  if (runtime.stack.includes(label)) fail('QUICK_REPLY_CYCLE', `Quick Reply cycle: ${[...runtime.stack, label].join(' -> ')}`)
  if (runtime.stack.length >= runtime.maxCallDepth) fail('BOUND_EXCEEDED', `Quick Reply call depth exceeds ${runtime.maxCallDepth}`)
  runtime.stack.push(label)
  try { executeSource(source, runtime) } finally { runtime.stack.pop() }
}

function variableMutation(raw: string, runtime: Runtime): { name: string; value: JsonValue } {
  const tokens = tokenize(expandMacros(raw, runtime))
  const named = new Map<string, string>()
  const positional: string[] = []
  for (const token of tokens) {
    const separator = token.indexOf('=')
    if (separator > 0) named.set(token.slice(0, separator).toLocaleLowerCase(), token.slice(separator + 1))
    else positional.push(token)
  }
  const name = named.get('key') ?? named.get('name') ?? positional.shift()
  if (name === undefined) fail('INVALID_ARGUMENT', 'Variable mutation requires key=<name>')
  validateName(name, 'Variable name')
  const explicit = named.get('value') ?? (positional.length === 0 ? undefined : positional.join(' '))
  return { name, value: explicit === undefined ? cloneValue(runtime.pipe) : parseScalar(explicit) }
}

function positionalName(raw: string, runtime: Runtime): string {
  const tokens = tokenize(expandMacros(raw, runtime))
  if (tokens.length !== 1 || tokens[0] === undefined) fail('INVALID_ARGUMENT', 'Command requires exactly one name')
  const token = tokens[0]
  const separator = token.indexOf('=')
  const name = separator > 0 && ['key', 'name'].includes(token.slice(0, separator).toLocaleLowerCase())
    ? token.slice(separator + 1)
    : token
  validateName(name, 'Name')
  return name
}

function setVariable(target: JsonObject, mutation: { name: string; value: JsonValue }, runtime: Runtime): void {
  if (!(mutation.name in target) && Object.keys(target).length >= MAX_VARIABLES) fail('BOUND_EXCEEDED', `Variable store exceeds ${MAX_VARIABLES} entries`)
  target[mutation.name] = cloneValue(mutation.value)
  runtime.pipe = cloneValue(mutation.value)
}

function addVariable(target: JsonObject, mutation: { name: string; value: JsonValue }, runtime: Runtime): void {
  const existing = target[mutation.name] ?? 0
  const value = typeof existing === 'number' && typeof mutation.value === 'number'
    ? existing + mutation.value
    : `${renderValue(existing)}${renderValue(mutation.value)}`
  if (typeof value === 'number' && !Number.isFinite(value)) fail('BOUND_EXCEEDED', 'Variable arithmetic produced a non-finite number')
  setVariable(target, { name: mutation.name, value }, runtime)
}

function incrementVariable(target: JsonObject, name: string, delta: number, runtime: Runtime): void {
  const value = target[name] ?? 0
  if (typeof value !== 'number') fail('INVALID_ARGUMENT', `Variable ${JSON.stringify(name)} is not numeric`)
  setVariable(target, { name, value: value + delta }, runtime)
}

function flushVariable(target: JsonObject, name: string, runtime: Runtime): void {
  Reflect.deleteProperty(target, name)
  runtime.pipe = ''
}

function readVariable(target: JsonObject, name: string, scope: string): JsonValue {
  const value = target[name]
  if (value === undefined) fail('INVALID_ARGUMENT', `${scope} variable ${JSON.stringify(name)} does not exist`)
  return value
}

function expandMacros(value: string, runtime: Runtime): string {
  return value.replace(/\{\{([^{}]+)\}\}/gu, (_whole, macroValue: string) => {
    const macro = macroValue.trim()
    if (macro.toLocaleLowerCase() === 'pipe') return renderValue(runtime.pipe)
    const variable = /^getvar::(.+)$/iu.exec(macro)
    if (variable?.[1] !== undefined) {
      const name = variable[1].trim()
      validateName(name, 'Macro variable name')
      return renderValue(readVariable(runtime.local, name, 'local'))
    }
    const global = /^getglobalvar::(.+)$/iu.exec(macro)
    if (global?.[1] !== undefined) {
      const name = global[1].trim()
      validateName(name, 'Macro variable name')
      return renderValue(readVariable(runtime.global, name, 'global'))
    }
    fail('UNSUPPORTED_MACRO', `STscript macro {{${macro}}} is outside the controlled compatibility subset`)
  })
}

function splitPipeline(source: string): string[] {
  const result: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let escaped = false
  for (const character of source) {
    if (escaped) { current += character; escaped = false; continue }
    if (character === '\\') { current += character; escaped = true; continue }
    if (quote !== undefined) {
      current += character
      if (character === quote) quote = undefined
      continue
    }
    if (character === '"' || character === "'") { current += character; quote = character; continue }
    if (character === '|') {
      pushSegment(result, current)
      current = ''
    } else current += character
  }
  if (escaped || quote !== undefined) fail('INVALID_SOURCE', 'STscript contains an unfinished escape or quote')
  pushSegment(result, current)
  return result
}

function pushSegment(result: string[], value: string): void {
  const segment = value.trim()
  if (segment === '') fail('INVALID_SOURCE', 'STscript contains an empty pipeline segment')
  result.push(segment)
}

function tokenize(value: string): string[] {
  const result: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let escaped = false
  let active = false
  for (const character of value) {
    if (escaped) { current += character; escaped = false; active = true; continue }
    if (character === '\\') { escaped = true; active = true; continue }
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      else current += character
      active = true
      continue
    }
    if (character === '"' || character === "'") { quote = character; active = true; continue }
    if (/\s/u.test(character)) {
      if (active) { result.push(current); current = ''; active = false }
    } else { current += character; active = true }
  }
  if (escaped || quote !== undefined) fail('INVALID_ARGUMENT', 'Command arguments contain an unfinished escape or quote')
  if (active) result.push(current)
  return result
}

function parseScalar(value: string): JsonValue {
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
    const number = Number(value)
    if (Number.isFinite(number)) return number
  }
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null') return null
  return value
}

function commandText(value: string, runtime: Runtime): string {
  return tokenize(expandMacros(value, runtime)).join(' ')
}

function renderValue(value: JsonValue): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function appendOutput(value: string, runtime: Runtime): void {
  runtime.outputCharacters += value.length
  if (runtime.outputCharacters > runtime.maxOutputCharacters) {
    fail('BOUND_EXCEEDED', `STscript output exceeds ${runtime.maxOutputCharacters} characters`)
  }
  runtime.output.push(value)
}

function resolveLimits(options: ControlledStscriptOptions): Limits {
  return {
    maxCommands: boundedInteger(options.maxCommands ?? DEFAULT_MAX_COMMANDS, 'maxCommands', 1, MAX_COMMANDS),
    maxCallDepth: boundedInteger(options.maxCallDepth ?? DEFAULT_MAX_CALL_DEPTH, 'maxCallDepth', 1, MAX_CALL_DEPTH),
    maxOutputCharacters: boundedInteger(
      options.maxOutputCharacters ?? DEFAULT_MAX_OUTPUT_CHARACTERS,
      'maxOutputCharacters', 1, MAX_OUTPUT_CHARACTERS,
    ),
  }
}

function boundedInteger(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail('INVALID_ARGUMENT', `${label} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

function validateQuickReplies(value: Readonly<Record<string, string>> | undefined): Readonly<Record<string, string>> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>
  for (const [label, source] of Object.entries(value ?? {})) {
    validateName(label, 'Quick Reply label')
    if (typeof source !== 'string') fail('INVALID_ARGUMENT', `Quick Reply ${JSON.stringify(label)} must be a string`)
    if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) fail('BOUND_EXCEEDED', `Quick Reply ${JSON.stringify(label)} exceeds ${MAX_SOURCE_BYTES} bytes`)
    result[label] = source
  }
  if (Object.keys(result).length > MAX_VARIABLES) fail('BOUND_EXCEEDED', `Quick Reply library exceeds ${MAX_VARIABLES} entries`)
  return Object.freeze(result)
}

function validateName(value: string, label: string): void {
  if (!NAME_PATTERN.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value.toLocaleLowerCase())) {
    fail('INVALID_ARGUMENT', `${label} is invalid`)
  }
}

function validateState(runtime: Runtime): void {
  if (Object.keys(runtime.local).length > MAX_VARIABLES || Object.keys(runtime.global).length > MAX_VARIABLES) {
    fail('BOUND_EXCEEDED', `Variable store exceeds ${MAX_VARIABLES} entries`)
  }
  const bytes = Buffer.byteLength(JSON.stringify({ local: runtime.local, global: runtime.global, pipe: runtime.pipe }), 'utf8')
  if (bytes > MAX_STATE_BYTES) fail('BOUND_EXCEEDED', `STscript state exceeds ${MAX_STATE_BYTES} bytes`)
}

function checkAbort(runtime: Runtime): void {
  if (runtime.signal?.aborted === true) fail('ABORTED', 'STscript invocation was aborted')
}

function cloneObject(value: Readonly<JsonObject> | undefined, label: string): JsonObject {
  if (value === undefined) return {}
  let serialized: string
  try { serialized = JSON.stringify(value) } catch (error: unknown) { throw new ControlledStscriptError('INVALID_ARGUMENT', `${label} is not finite JSON: ${String(error)}`) }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE_BYTES) fail('BOUND_EXCEEDED', `${label} exceeds ${MAX_STATE_BYTES} bytes`)
  const clone: unknown = JSON.parse(serialized)
  if (!isObject(clone)) fail('INVALID_ARGUMENT', `${label} must be a JSON object`)
  for (const key of Object.keys(clone)) validateName(key, `${label} variable name`)
  return Object.assign(Object.create(null) as JsonObject, clone)
}

function cloneValue<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function quoteToken(value: string): string { return `"${value.replace(/["\\]/gu, character => `\\${character}`)}"` }

function fail(code: ControlledStscriptErrorCode, message: string): never { throw new ControlledStscriptError(code, message) }

function components(): readonly RpComponentDefinition[] {
  return [
    {
      id: RpComponentId('rp.compat.sillytavern.stscript'), packageId: PACKAGE, version: '1.0.0',
      scopes: ['deployment', 'experience', 'profile', 'conversation'],
      provides: ['rp.compat.stscript', 'script.execute'], trust: 'L1',
    },
    {
      id: RpComponentId('rp.compat.sillytavern.quick-reply'), packageId: PACKAGE, version: '1.0.0',
      scopes: ['deployment', 'experience', 'profile', 'conversation'],
      provides: ['rp.compat.quick-reply', 'script.execute'], trust: 'L1',
    },
  ]
}

function capabilities(): readonly RpCapabilityContribution[] {
  const descriptor = (id: string, title: string): RpCapabilityContribution['descriptor'] => ({
    id: RpCapabilityId(id), kind: 'tool', version: '1.0.0', title,
    description: `${title} in a bounded subset without model, message, network, filesystem, JavaScript, or Host access.`,
    trust: 'L1', scopes: ['deployment', 'experience', 'profile', 'conversation'],
    permissions: ['script.execute'], budget: { maxToolCalls: DEFAULT_MAX_COMMANDS },
    tags: ['rp', 'sillytavern', 'stscript', 'bounded'],
  })
  return [
    {
      descriptor: descriptor('rp.compat.stscript.execute', 'Execute controlled STscript'),
      invoke: request => Promise.resolve(executeFromInput(asObject(request.input, 'STscript input'), request)),
    },
    {
      descriptor: descriptor('rp.compat.quick-reply.execute', 'Execute controlled Quick Reply'),
      invoke: (request) => {
        const input = asObject(request.input, 'Quick Reply input')
        const label = requiredString(input.label, 'Quick Reply input.label')
        const quickReplies = stringRecord(input.quickReplies, 'Quick Reply input.quickReplies')
        return Promise.resolve(executeControlledQuickReply(
          label, quickReplies, optionsFromInput(input, request),
        ) as unknown as JsonValue)
      },
    },
  ]
}

function executeFromInput(input: JsonObject, request: Parameters<NonNullable<RpCapabilityContribution['invoke']>>[0]): JsonValue {
  return executeControlledStscript(requiredString(input.source, 'STscript input.source'), optionsFromInput(input, request)) as unknown as JsonValue
}

function optionsFromInput(
  input: JsonObject,
  request: Parameters<NonNullable<RpCapabilityContribution['invoke']>>[0],
): ControlledStscriptOptions {
  const budgetCommands = request.effectiveBudget.maxToolCalls
  const requestedCommands = optionalInteger(input.maxCommands, 'input.maxCommands')
  return {
    ...(input.localVariables === undefined ? {} : { localVariables: asObject(input.localVariables, 'input.localVariables') }),
    ...(input.globalVariables === undefined ? {} : { globalVariables: asObject(input.globalVariables, 'input.globalVariables') }),
    ...(input.quickReplies === undefined ? {} : { quickReplies: stringRecord(input.quickReplies, 'input.quickReplies') }),
    ...(input.pipe === undefined ? {} : { pipe: input.pipe }),
    maxCommands: Math.min(requestedCommands ?? DEFAULT_MAX_COMMANDS, budgetCommands ?? DEFAULT_MAX_COMMANDS),
    ...(input.maxCallDepth === undefined ? {} : { maxCallDepth: requiredInteger(input.maxCallDepth, 'input.maxCallDepth') }),
    ...(input.maxOutputCharacters === undefined ? {} : {
      maxOutputCharacters: requiredInteger(input.maxOutputCharacters, 'input.maxOutputCharacters'),
    }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
  }
}

function asObject(value: JsonValue, label: string): JsonObject {
  if (!isObject(value)) fail('INVALID_ARGUMENT', `${label} must be an object`)
  return value
}

function stringRecord(value: JsonValue | undefined, label: string): Record<string, string> {
  if (value === undefined) fail('INVALID_ARGUMENT', `${label} is required`)
  const object = asObject(value, label)
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(object)) result[key] = requiredString(item, `${label}.${key}`)
  return result
}

function requiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== 'string') fail('INVALID_ARGUMENT', `${label} must be a string`)
  return value
}

function requiredInteger(value: JsonValue, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail('INVALID_ARGUMENT', `${label} must be an integer`)
  return value
}

function optionalInteger(value: JsonValue | undefined, label: string): number | undefined {
  return value === undefined ? undefined : requiredInteger(value, label)
}
