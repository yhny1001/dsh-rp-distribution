/** Pure SillyTavern chat JSON/JSONL compatibility for the RP product UI. */

/** One speaker-attributed message accepted from or emitted to Tavern chat files. */
export interface TavernChatMessage {
  readonly role: 'user' | 'assistant'
  readonly speakerName: string
  readonly content: string
  readonly sourceSeq?: number
  readonly editRevision?: number
}

/** Parsed Tavern history plus records intentionally omitted from RP history. */
export interface TavernChatParseResult {
  readonly messages: readonly TavernChatMessage[]
  readonly skipped: number
}

const PRIVATE_ROLEPLAY_TAG = /(?:^|[-_.:~])(?:planning|thinking|reasoning|analysis|scratchpad|chain[-_]?of[-_]?thought)(?:$|[-_.:~])/iu
const ROLEPLAY_TAG_OPEN = /<\s*([a-z][a-z0-9_.:~-]*)(?=[\s>])[^>]*>/giu
const ROLEPLAY_TAG_CLOSE = /<\s*\/\s*([a-z][a-z0-9_.:~-]*)\s*>/giu

/** Remove model-leaked private planning blocks from user-visible RP prose without changing the durable source message. */
export function visibleRoleplayText(value: string): string {
  let cursor = 0
  let output = ''
  ROLEPLAY_TAG_OPEN.lastIndex = 0
  for (let match = ROLEPLAY_TAG_OPEN.exec(value); match !== null; match = ROLEPLAY_TAG_OPEN.exec(value)) {
    const name = match[1]!
    if (!PRIVATE_ROLEPLAY_TAG.test(name)) continue
    output += value.slice(cursor, match.index)
    const close = new RegExp(`<\\s*\\/\\s*${escapeRegExp(name)}\\s*>`, 'iu').exec(value.slice(ROLEPLAY_TAG_OPEN.lastIndex))
    if (close === null) {
      cursor = value.length
      break
    }
    cursor = ROLEPLAY_TAG_OPEN.lastIndex + close.index + close[0].length
    ROLEPLAY_TAG_OPEN.lastIndex = cursor
  }
  output += value.slice(cursor)
  ROLEPLAY_TAG_CLOSE.lastIndex = 0
  return output.replace(ROLEPLAY_TAG_CLOSE, (tag, name: string) => PRIVATE_ROLEPLAY_TAG.test(name) ? '' : tag).trim()
}

/** Parse SillyTavern JSONL or a JSON array while omitting metadata and system rows. */
export function parseTavernChat(value: string, fallbackCharacter: string, fallbackPersona: string): TavernChatParseResult {
  const text = value.replace(/^\uFEFF/u, '').trim()
  if (text === '') throw new Error('聊天历史文件为空')
  let values: unknown[]
  if (text.startsWith('[')) {
    const parsed = JSON.parse(text) as unknown
    if (!Array.isArray(parsed)) throw new Error('聊天 JSON 必须是数组')
    values = parsed
  } else {
    values = text.split(/\r?\n/u).filter(line => line.trim() !== '').map((line, index) => {
      try { return JSON.parse(line) as unknown }
      catch { throw new Error(`聊天 JSONL 第 ${String(index + 1)} 行不是有效 JSON`) }
    })
  }
  const messages: TavernChatMessage[] = []
  let skipped = 0
  let total = 0
  for (const [index, value] of values.entries()) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`聊天记录第 ${String(index + 1)} 项必须是对象`)
    const item = value as Record<string, unknown>
    if (item.is_system === true || typeof item.mes !== 'string' || item.mes.trim() === '') { skipped += 1; continue }
    const content = item.mes.trim()
    if (content.length > 32_000) throw new Error(`聊天记录第 ${String(index + 1)} 项超过 32000 字符`)
    total += content.length
    const role = item.is_user === true ? 'user' as const : 'assistant' as const
    const rawName = typeof item.name === 'string' ? item.name.trim() : ''
    messages.push(Object.freeze({ role, speakerName: rawName || (role === 'user' ? fallbackPersona : fallbackCharacter), content }))
  }
  if (messages.length === 0 || messages.length > 500) throw new Error('聊天历史必须包含 1–500 条用户或角色消息')
  if (total > 1_000_000) throw new Error('聊天历史正文总计不能超过 1000000 字符')
  return Object.freeze({ messages: Object.freeze(messages), skipped })
}

/** Serialize visible RP messages as SillyTavern-compatible JSONL. */
export function serializeTavernChat(
  messages: readonly TavernChatMessage[],
  characterName: string,
  personaName: string,
  exportedAt = new Date().toISOString(),
): string {
  const rows: object[] = [{
    user_name: personaName,
    character_name: characterName,
    create_date: exportedAt,
    chat_metadata: { source: '@dsh-rp/product', exported_at: exportedAt },
  }]
  for (const message of messages) rows.push({
    name: message.speakerName,
    is_user: message.role === 'user',
    is_name: true,
    is_system: false,
    send_date: exportedAt,
    mes: message.content,
    extra: {
      ...(message.sourceSeq === undefined ? {} : { dsh_source_seq: message.sourceSeq }),
      ...(message.editRevision === undefined ? {} : { dsh_edit_revision: message.editRevision }),
    },
  })
  return `${rows.map(row => JSON.stringify(row)).join('\n')}\n`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
