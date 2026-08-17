// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RpResourceEditor } from '../src/client/resource-editor.tsx'
import { zh, type RpStudioLocaleKey } from '../src/client/locales.ts'
import type { RpResourceEditorDocument, RpResourceEditorState } from '../src/client/resource-controller.ts'

afterEach(cleanup)
const t = (key: RpStudioLocaleKey): string => zh[key]

function ready(document: RpResourceEditorDocument): RpResourceEditorState {
  const id = document.kind === 'preset' ? document.preset.id : document.asset.id
  return { phase: 'ready', target: { kind: document.kind, id }, document, error: undefined }
}

describe('RP structured resource editor', () => {
  it('edits Character Card fields without changing its stable identity', async () => {
    const savedDocuments: RpResourceEditorDocument[] = []
    const onSave = vi.fn(async (document: RpResourceEditorDocument) => { savedDocuments.push(document) })
    render(<RpResourceEditor
      editor={ready({
        kind: 'character', savedAt: 1,
        asset: {
          schemaVersion: 1, id: 'character-1', name: '守门人', description: '旧描述',
          firstMessages: ['欢迎。'], tags: ['观星'],
        },
      })}
      onSave={onSave}
      onClose={vi.fn()}
      t={t}
    />)
    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '新守门人' } })
    fireEvent.change(screen.getByRole('textbox', { name: '描述' }), { target: { value: '新描述' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1) })
    expect(savedDocuments[0]).toMatchObject({
      kind: 'character', asset: { id: 'character-1', name: '新守门人', description: '新描述' },
    })
  })

  it('edits World Info entry triggers, content, and enabled state', async () => {
    const savedDocuments: RpResourceEditorDocument[] = []
    const onSave = vi.fn(async (document: RpResourceEditorDocument) => { savedDocuments.push(document) })
    render(<RpResourceEditor
      editor={ready({
        kind: 'lore', savedAt: 1,
        asset: {
          schemaVersion: 1, id: 'lore-1', name: '观星台',
          entries: [{ id: 'sky', keys: ['星空'], content: '旧设定', enabled: true, priority: 10 }],
        },
      })}
      onSave={onSave}
      onClose={vi.fn()}
      t={t}
    />)
    fireEvent.change(screen.getByRole('textbox', { name: '触发关键词（逗号分隔）' }), {
      target: { value: '星空, 观星台' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: '条目内容' }), { target: { value: '新世界设定' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '启用此条目' }))
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1) })
    expect(savedDocuments[0]).toMatchObject({
      kind: 'lore', asset: { id: 'lore-1', entries: [{ keys: ['星空', '观星台'], content: '新世界设定', enabled: false }] },
    })
  })

  it('edits preset Prompt content, selected order, activation, and generation parameters', async () => {
    const savedDocuments: RpResourceEditorDocument[] = []
    const onSave = vi.fn(async (document: RpResourceEditorDocument) => { savedDocuments.push(document) })
    render(<RpResourceEditor
      editor={ready({
        kind: 'preset', savedAt: 1,
        preset: {
          schemaVersion: 1, id: 'preset-1', name: '北棱预设', savedAt: 1,
          promptDefinitions: [
            { schemaVersion: 1, id: 'main', name: '主提示', role: 'system', content: '旧提示', marker: false },
            { schemaVersion: 1, id: 'style', name: '风格', role: 'system', content: '旧风格', marker: false },
          ],
          promptOrders: [
            { id: 'first', entries: [{ identifier: 'main', enabled: true }, { identifier: 'style', enabled: false }] },
            { id: 'second', entries: [{ identifier: 'style', enabled: true }, { identifier: 'main', enabled: true }] },
          ],
          selectedPromptOrderId: 'first',
          prompts: [{ schemaVersion: 1, id: 'main', role: 'system', content: '旧提示', priority: 0 }],
          generation: { temperature: 1 },
        },
      })}
      onSave={onSave}
      onClose={vi.fn()}
      t={t}
    />)
    fireEvent.change(screen.getByLabelText('当前 Prompt 顺序'), { target: { value: 'second' } })
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Prompt 内容' })[0]!, { target: { value: '新提示正文' } })
    fireEvent.change(screen.getByRole('textbox', { name: '生成参数（高级 JSON）' }), {
      target: { value: '{"temperature":0.7,"top_p":0.9}' },
    })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() => { expect(onSave).toHaveBeenCalledTimes(1) })
    const saved = savedDocuments[0]
    expect(saved).toMatchObject({
      kind: 'preset', preset: {
        id: 'preset-1', selectedPromptOrderId: 'second', generation: { temperature: 0.7, top_p: 0.9 },
      },
    })
    if (saved?.kind !== 'preset') throw new Error('expected preset save')
    expect(saved.preset.promptDefinitions.find(item => item.id === 'main')).toMatchObject({ content: '新提示正文' })
  })
})
