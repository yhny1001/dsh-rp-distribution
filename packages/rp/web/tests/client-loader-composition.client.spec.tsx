// @vitest-environment jsdom
/** Real built-bundle/ModuleLoader/Cordis proof for the product-visible RP client. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import * as JsxRuntime from 'react/jsx-runtime'
import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import * as ClientRuntime from '@deepseek-ai/dsh-client-runtime/client'
import * as ClientUiAttachment from '@deepseek-ai/dsh-client-ui-attachment'
import { createSnapshotStore, SlotRegistry, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  ClientModuleSystem,
  type DshWindow,
} from '@deepseek-ai/dsh-client-modules/client'
import {
  ConversationController,
  type ConversationSubmissionHandler,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { RpConversationInjected } from '../src/client/rp-conversation.tsx'

const win = globalThis as DshWindow

afterEach(() => {
  delete win.__ModuleLoader__
  vi.unstubAllGlobals()
})

describe('RP Web built client composition', () => {
  it('loads the emitted client bundle and installs a reversible live RP submission route', async () => {
    const id = '@dsh-rp/web'
    const url = '/plugins/dsh-rp-web.js'
    const bundle = readFileSync(join(process.cwd(), 'packages/rp/web/lib/client.js'), 'utf8')
    const modules = new ClientModuleSystem({
      modules: [{ id, url, rev: 'test' }],
      staticModules: {
        react: React,
        'react/jsx-runtime': JsxRuntime,
        '@deepseek-ai/dsh-client-runtime/client': ClientRuntime,
        '@deepseek-ai/dsh-client-ui-attachment': ClientUiAttachment,
      },
      loadBundle: async (requested) => {
        expect(requested).toBe(url)
        ;(0, eval)(bundle)
      },
    })
    const plugin = await modules.import(id) as {
      apply: (ctx: Context) => void
      inject: readonly string[]
    }
    expect(plugin.inject).toEqual(['slots', 'locale', 'conversation', 'sessions'])

    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('sessions', {
      list: createSnapshotStore({ byId: { 'loader-session': {} }, current: 'loader-session' }),
    } as never)
    await ctx.plugin(ConversationController, { input: {} as never, blocks: {} as never }).await()
    const conversation = ctx.get('conversation') as ConversationController
    const slots = ctx.get('slots') as SlotRegistry
    slots.register({
      name: 'root',
      children: {
        'settings.plugins.tab': { kind: 'list', scope: 'root' },
        'sidebar.conversation': { kind: 'list', scope: 'session' },
        'conversation.chat.message.after': { kind: 'list', scope: 'session' },
        'conversation.hero.mode': { kind: 'list', scope: 'session' },
        'conversation.session.header.actions': { kind: 'list', scope: 'session' },
        'conversation.input.right': { kind: 'list', scope: 'session' },
        'conversation.input.dock': { kind: 'list', scope: 'session' },
        'conversation.rail.right': { kind: 'list', scope: 'session' },
        'conversation.view': { kind: 'list', scope: 'session' },
      },
    } as never, () => null)

    const fiber = ctx.plugin({ inject: [...plugin.inject], apply: plugin.apply })
    await fiber.await()
    expect(slots.entries('conversation.view').map(entry => entry.options.id)).toEqual(['rp'])
    expect(slots.entries('conversation.hero.mode').map(entry => entry.options.id)).toEqual(['rp-mode'])
    expect(slots.entries('conversation.session.header.actions').map(entry => entry.options.id)).toEqual(['rp-mode'])
    expect(slots.entries('conversation.rail.right').map(entry => entry.options.id)).toEqual(['rp-inspector'])
    expect(slots.entries('conversation.input.right')).toHaveLength(0)
    const sessionId = 'loader-session' as SessionId
    const duplicate: ConversationSubmissionHandler = {
      id: 'rp-web-turn', matches: () => false, submit: async () => {},
    }
    expect(() => conversation.registerSubmissionHandler(duplicate)).toThrow(/already registered/)

    const injectFactory = slots.entries('conversation.hero.mode')[0]?.inject as unknown as
      ((id: SessionId) => RpConversationInjected)
    const injected = injectFactory(sessionId)
    expect(injected.hooks.rpTurn.getSnapshot().mode).toBe('rp')
    injected.setMode('agent')
    expect(injected.hooks.rpTurn.getSnapshot().mode).toBe('agent')

    await fiber.dispose()
    expect(slots.entries('conversation.view')).toHaveLength(0)
    expect(slots.entries('conversation.hero.mode')).toHaveLength(0)
    expect(slots.entries('conversation.session.header.actions')).toHaveLength(0)
    expect(slots.entries('conversation.rail.right')).toHaveLength(0)
    const release = conversation.registerSubmissionHandler(duplicate)
    release()
  })
})
