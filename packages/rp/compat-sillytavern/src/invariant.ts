/** Invariant companion for the SillyTavern adapter. @module @dsh-rp/compat-sillytavern/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

export const name = 'rp-compat-sillytavern-invariant'
export const inject = ['invariants']
/** No runtime invariant: parser functions are pure and Cordis registrations are covered by the package HMR test. */
const install: InvariantInstaller = () => {}
/** Registrations are grouped in one Cordis effect and audited by the package HMR test. */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register('@dsh-rp/compat-sillytavern', install))
