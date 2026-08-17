/** Package-owned pipeline lifecycle invariants. @module @dsh-rp/pipeline-runtime/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { RpPipelineRunInfo } from './types.ts'

const PACKAGE_NAME = '@dsh-rp/pipeline-runtime'

/** Cordis companion plugin name. */
export const name = 'rp-pipeline-runtime-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Install start/stage/terminal enclosure checks. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const active = new Map<string, RpPipelineRunInfo>()
  ctx.on('rp/pipeline-started', (info) => {
    if (info.runId.length === 0 || info.snapshotHash.length !== 64) fail('RP pipeline run identity must be non-empty and content-addressed')
    if (active.has(info.runId)) fail(`RP pipeline run ${JSON.stringify(info.runId)} started twice`)
    active.set(info.runId, info)
  }, { global: true })
  ctx.on('rp/pipeline-stage', (info, stageId) => {
    if (!active.has(info.runId)) fail(`RP pipeline stage ${JSON.stringify(stageId)} settled outside an active run`)
  }, { global: true })
  const settle = (info: RpPipelineRunInfo): void => {
    if (!active.delete(info.runId)) fail(`RP pipeline run ${JSON.stringify(info.runId)} settled without a start`)
  }
  ctx.on('rp/pipeline-completed', settle, { global: true })
  ctx.on('rp/pipeline-failed', settle, { global: true })
}, { inject: ['rpPipelines'] })

/** Register this package's invariant companion. @param ctx - Context carrying the invariant registry. @returns Registration disposer. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
