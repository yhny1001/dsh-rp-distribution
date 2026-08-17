// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore, SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { apply, inject } from '../src/client/index.tsx'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const registerSubmissionHandler = vi.fn(() => () => {})
  ctx.provide('conversation', { registerSubmissionHandler } as never)
  ctx.provide('sessions', {
    list: createSnapshotStore({ byId: {}, current: undefined }),
  } as never)
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'settings.plugins.tab': { kind: 'list', scope: 'root' },
      'sidebar.conversation': { kind: 'list', scope: 'session' },
      'conversation.chat.message.after': { kind: 'list', scope: 'session' },
      'conversation.hero.mode': { kind: 'list', scope: 'session' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.input.dock': { kind: 'list', scope: 'session' },
      'conversation.rail.right': { kind: 'list', scope: 'session' },
      'conversation.view': { kind: 'list', scope: 'session' },
    },
  } as never, () => null)
  return { ctx, slots, registerSubmissionHandler }
}

describe('RP Web client assembly', () => {
  it('registers every native projection seat and releases them together', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()

    expect(b.slots.entries('settings.plugins.tab').map(entry => entry.options.id)).toEqual(['rp-studio'])
    expect(b.slots.entries('sidebar.conversation').map(entry => entry.options.id)).toEqual(['rp-packages'])
    expect(b.slots.entries('conversation.chat.message.after').map(entry => entry.options.id)).toEqual(['rp-packages'])
    expect(b.slots.entries('conversation.hero.mode').map(entry => entry.options.id)).toEqual(['rp-mode'])
    expect(b.slots.entries('conversation.session.header.actions').map(entry => entry.options.id)).toEqual(['rp-mode'])
    expect(b.slots.entries('conversation.input.dock').map(entry => entry.options.id)).toEqual(['rp-turn-status'])
    expect(b.slots.entries('conversation.rail.right').map(entry => entry.options.id)).toEqual(['rp-inspector'])
    expect(b.slots.entries('conversation.view').map(entry => entry.options.id)).toEqual(['rp'])
    expect(b.registerSubmissionHandler).toHaveBeenCalledWith(expect.objectContaining({ id: 'rp-web-turn' }))
    expect(b.slots.entries('sidebar.conversation')[0]?.inject).toBeTypeOf('function')

    await fiber.dispose()
    expect(b.slots.entries('settings.plugins.tab')).toHaveLength(0)
    expect(b.slots.entries('sidebar.conversation')).toHaveLength(0)
    expect(b.slots.entries('conversation.chat.message.after')).toHaveLength(0)
    expect(b.slots.entries('conversation.hero.mode')).toHaveLength(0)
    expect(b.slots.entries('conversation.session.header.actions')).toHaveLength(0)
    expect(b.slots.entries('conversation.input.dock')).toHaveLength(0)
    expect(b.slots.entries('conversation.rail.right')).toHaveLength(0)
    expect(b.slots.entries('conversation.view')).toHaveLength(0)
  })
})
