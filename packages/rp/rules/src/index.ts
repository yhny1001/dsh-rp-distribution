/** Pluggable deterministic RP rules engines. @module @dsh-rp/rules */
import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { RpRuleSystemId } from '@dsh-rp/contracts'
import type { JsonObject, JsonValue, RpRuleSystemId as RuleSystemId } from '@dsh-rp/contracts'

declare module '@deepseek-ai/cordis' {
  interface Context { rpRules: RpRulesRuntime }
  interface Events {
    /**
     * A registered rules engine completed one evaluation.
     * @param system - Rules-engine identity.
     * @param result - Detached JSON result.
     * @mode emit
     */
    'rp/rules-evaluated'(system: RuleSystemId, result: JsonValue): void
  }
}

/** One replaceable deterministic rules engine. */
export interface RpRuleSystem {
  readonly id: RuleSystemId
  readonly version: string
  readonly title: string
  evaluate(input: JsonObject, signal?: AbortSignal): Promise<JsonValue>
}

/** Registry and invocation owner for replaceable RP rules engines. */
export class RpRulesRuntime extends Service {
  private readonly systems = new Map<RuleSystemId, RpRuleSystem>()
  constructor(ctx: Context) {
    super(ctx, 'rpRules')
    ctx.effect(() => this.register(createSeededDiceSystem()))
  }

  /**
   * Register one rules engine.
   * @param system - Rules engine definition.
   * @returns Idempotent registration disposer.
   */
  register(system: RpRuleSystem): () => void {
    if (String(system.id).trim() === '' || system.version.trim() === '' || system.title.trim() === '') {
      throw new Error('RP rules engine id, version, and title are required')
    }
    if (this.systems.has(system.id)) throw new Error(`RP rules engine ${JSON.stringify(system.id)} already exists`)
    this.systems.set(system.id, system)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.systems.get(system.id) === system) this.systems.delete(system.id)
    }
  }

  /**
   * List registered rules engines in deterministic order.
   * @returns Frozen engine metadata.
   */
  list(): readonly Readonly<Pick<RpRuleSystem, 'id' | 'version' | 'title'>>[] {
    return Object.freeze([...this.systems.values()]
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))
      .map(system => Object.freeze({ id: system.id, version: system.version, title: system.title })))
  }

  /**
   * Evaluate one request through its owning rules engine.
   * @param systemId - Registered rules-engine identity.
   * @param input - Engine-specific JSON input.
   * @param signal - Optional cancellation signal.
   * @returns Detached JSON result.
   */
  async evaluate(systemId: RuleSystemId, input: JsonObject, signal?: AbortSignal): Promise<JsonValue> {
    if (signal?.aborted === true) throw abortError(signal)
    const system = this.systems.get(systemId)
    if (system === undefined) throw new Error(`RP rules engine ${JSON.stringify(systemId)} is not registered`)
    const result = structuredClone(await system.evaluate(structuredClone(input), signal))
    this.ctx.emit('rp/rules-evaluated', systemId, result)
    return result
  }
}

/**
 * Create the built-in seeded dice engine.
 * @returns Deterministic dice rules engine.
 */
export function createSeededDiceSystem(): RpRuleSystem {
  return {
    id: RpRuleSystemId('seeded-dice'),
    version: '1.0.0',
    title: 'Seeded Dice',
    evaluate(input, signal) {
      if (signal?.aborted === true) return Promise.reject(abortError(signal))
      const notation = requiredString(input.notation, 'notation')
      const seed = requiredString(input.seed, 'seed')
      const match = /^(\d{1,3})d(\d{1,4})([+-]\d{1,7})?$/u.exec(notation)
      if (match === null) throw new Error('Seeded dice notation must match NdM or NdM+K')
      const count = Number(match[1])
      const sides = Number(match[2])
      const modifier = Number(match[3] ?? 0)
      if (count < 1 || count > 100 || sides < 2 || sides > 1_000 || Math.abs(modifier) > 1_000_000) {
        throw new Error('Seeded dice limits are 1..100 dice, 2..1000 sides, and a modifier up to 1000000')
      }
      const rolls = Array.from({ length: count }, (_, index) => seededRoll(seed, notation, index, sides))
      const total = rolls.reduce((sum, value) => sum + value, modifier)
      const target = input.target === undefined ? undefined : boundedTarget(input.target)
      return Promise.resolve({
        system: 'seeded-dice', notation, rolls, modifier, total,
        seedHash: createHash('sha256').update(seed).digest('hex'),
        ...(target === undefined ? {} : { target, success: total >= target }),
      })
    },
  }
}

function seededRoll(seed: string, notation: string, index: number, sides: number): number {
  const digest = createHash('sha256').update(`${seed}\u0000${notation}\u0000${index}`).digest()
  return digest.readUInt32BE(0) % sides + 1
}
function requiredString(value: JsonValue | undefined, name: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 4_000) {
    throw new Error(`Seeded dice ${name} must be a non-empty string of at most 4000 characters`)
  }
  return value
}
function boundedTarget(value: JsonValue): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > 1_000_000) {
    throw new Error('Seeded dice target must be a safe integer from -1000000 to 1000000')
  }
  return value
}
function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason ?? 'rules evaluation cancelled'))
}

export default RpRulesRuntime
