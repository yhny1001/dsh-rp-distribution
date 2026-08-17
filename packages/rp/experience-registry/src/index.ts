/** Dynamic Experience registry with agent-directed adaptive selection. @module @dsh-rp/experience-registry */

import { Context, Service } from '@deepseek-ai/cordis'
import type { RpExperienceManifest } from '@dsh-rp/contracts'
import type { RpExperienceSelection, RpExperienceSelectionRequest } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    rpExperiences: RpExperienceRegistry
  }

  interface Events {
    /**
     * An Experience registration changed.
     * @param id - Changed Experience id.
     * @mode emit
     */
    'rp/experiences-changed'(id: string): void
  }
}

/** Experience lookup or selection failure. */
export class RpExperienceError extends Error {
  /** Machine-readable failure category. */
  readonly code: 'DUPLICATE' | 'MISSING' | 'DENIED' | 'INVALID'

  /** @param message - Human-readable failure. @param code - Stable category. */
  constructor(message: string, code: RpExperienceError['code']) {
    super(message)
    this.name = 'RpExperienceError'
    this.code = code
  }
}

/** Registry for Experience manifests; selection never mutates a manifest. */
export class RpExperienceRegistry extends Service {
  private readonly experiences = new Map<string, RpExperienceManifest>()

  constructor(ctx: Context) {
    super(ctx, 'rpExperiences')
  }

  /**
   * Register one complete Experience.
   * @param experience - Immutable composition.
   * @returns Idempotent disposer.
   */
  register(experience: RpExperienceManifest): () => void {
    validateExperience(experience)
    if (this.experiences.has(experience.id)) {
      throw new RpExperienceError(`RP Experience ${JSON.stringify(experience.id)} is already registered`, 'DUPLICATE')
    }
    const stored = freezeExperience(experience)
    this.experiences.set(stored.id, stored)
    this.ctx.emit('rp/experiences-changed', stored.id)
    let active = true
    return () => {
      if (!active) return
      active = false
      if (this.experiences.get(stored.id) !== stored) return
      this.experiences.delete(stored.id)
      this.ctx.emit('rp/experiences-changed', stored.id)
    }
  }

  /**
   * List registered Experiences in id order.
   * @returns Immutable manifests.
   */
  list(): readonly RpExperienceManifest[] {
    return [...this.experiences.values()].sort((left, right) => left.id.localeCompare(right.id))
  }

  /**
   * Get one Experience.
   * @param id - Experience id.
   * @returns Immutable manifest when registered.
   */
  get(id: string): RpExperienceManifest | undefined {
    return this.experiences.get(id)
  }

  /**
   * Select an Experience with explicit choices taking precedence over hints.
   * @param request - Explicit choices, allowlist, and task hints.
   * @returns Selected manifest and reason.
   */
  select(request: RpExperienceSelectionRequest = {}): RpExperienceSelection {
    const allowed = request.allowed === undefined ? undefined : new Set(request.allowed)
    const select = (id: string, reason: RpExperienceSelection['reason']): RpExperienceSelection => {
      if (allowed !== undefined && !allowed.has(id)) {
        throw new RpExperienceError(`RP Experience ${JSON.stringify(id)} is denied by the caller allowlist`, 'DENIED')
      }
      const experience = this.experiences.get(id)
      if (experience === undefined) throw new RpExperienceError(`RP Experience ${JSON.stringify(id)} is not registered`, 'MISSING')
      return Object.freeze({ experience, reason })
    }
    if (request.requested !== undefined) return select(request.requested, 'requested')
    if (request.agentChoice !== undefined) return select(request.agentChoice, 'agent-choice')
    const hints = request.hints
    if (hints?.creator === true) return select('rp-creator', 'creator')
    if (hints?.rules === true) return select('rp-trpg', 'rules')
    if (hints?.worldSimulation === true) return select('rp-world-sim', 'world-sim')
    if ((hints?.participantCount ?? 0) > 2) return select('rp-multi-character', 'multi-character')
    if (hints?.quality === 'maximum') return select('rp-premium', 'premium')
    if (hints?.director === true) return select('rp-directed', 'directed')
    if (hints?.quality === 'fast') return select('rp-fast', 'fast')
    return select('rp-adaptive', 'adaptive')
  }
}

/** Validate required manifest fields. */
function validateExperience(experience: RpExperienceManifest): void {
  if (experience.id.length === 0 || experience.name.length === 0) {
    throw new RpExperienceError('RP Experience id and name must be non-empty', 'INVALID')
  }
  if (experience.components.length === 0) {
    throw new RpExperienceError(`RP Experience ${JSON.stringify(experience.id)} must contain a component`, 'INVALID')
  }
  if (experience.pipelines.turn === undefined) {
    throw new RpExperienceError(`RP Experience ${JSON.stringify(experience.id)} must select a turn pipeline`, 'INVALID')
  }
}

/** Detach all caller-owned collections. */
function freezeExperience(experience: RpExperienceManifest): RpExperienceManifest {
  return Object.freeze({
    ...experience,
    components: Object.freeze([...experience.components]),
    agents: Object.freeze(experience.agents.map(agent => Object.freeze({
      ...agent,
      capabilities: Object.freeze([...agent.capabilities]),
      ...(agent.budget === undefined ? {} : { budget: Object.freeze({ ...agent.budget }) }),
    }))),
    pipelines: Object.freeze({ ...experience.pipelines }),
    ...(experience.uiSlots === undefined ? {} : { uiSlots: Object.freeze([...experience.uiSlots]) }),
    ...(experience.defaults === undefined ? {} : { defaults: Object.freeze({ ...experience.defaults }) }),
  })
}

export default RpExperienceRegistry
