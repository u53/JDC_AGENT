export type QueryTokenKind = 'path' | 'symbol' | 'quoted' | 'word' | 'cjk'

export interface QueryToken {
  value: string
  kind: QueryTokenKind
  weight: number
}

const PATH_PATTERN = /(?:^|[\s"'`(])((?:\.{1,2}\/|\/)?(?:[\w.-]+\/)+[\w.-]+(?:\.[A-Za-z0-9]+)?)(?=$|[\s"'`).,;:])/g
const QUOTED_PATTERN = /"([^"]+)"|'([^']+)'|`([^`]+)`/g
const SYMBOL_PATTERN = /\b[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?\b/g
const WORD_PATTERN = /\b[A-Za-z0-9_][A-Za-z0-9_-]{2,}\b/g
const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu

export function tokenizeQueryText(input: string): QueryToken[] {
  const tokens: QueryToken[] = []
  collectRegex(tokens, input, PATH_PATTERN, 'path', 6)
  collectPathBasenames(tokens)
  collectRegex(tokens, input, QUOTED_PATTERN, 'quoted', 4)
  collectRegex(tokens, input, SYMBOL_PATTERN, 'symbol', 5)
  collectRegex(tokens, input, WORD_PATTERN, 'word', 2)
  collectCjk(tokens, input)
  return dedupeTokens(tokens)
}

function collectRegex(tokens: QueryToken[], input: string, pattern: RegExp, kind: QueryTokenKind, weight: number): void {
  pattern.lastIndex = 0
  for (const match of input.matchAll(pattern)) {
    const value = String(match[1] ?? match[2] ?? match[3] ?? match[0]).trim()
    if (!value) continue
    tokens.push({ value: normalizeTokenValue(value, kind), kind, weight })
  }
}

function collectPathBasenames(tokens: QueryToken[]): void {
  for (const token of [...tokens]) {
    if (token.kind !== 'path') continue
    const filename = token.value.split('/').filter(Boolean).at(-1)
    if (filename && filename !== token.value) tokens.push({ value: filename, kind: 'path', weight: token.weight })
  }
}

function collectCjk(tokens: QueryToken[], input: string): void {
  CJK_PATTERN.lastIndex = 0
  for (const match of input.matchAll(CJK_PATTERN)) {
    const text = match[0]
    if (text.length === 1) {
      tokens.push({ value: text, kind: 'cjk', weight: 3 })
      continue
    }
    for (let size = 2; size <= Math.min(4, text.length); size += 1) {
      for (let index = 0; index <= text.length - size; index += 1) {
        tokens.push({ value: text.slice(index, index + size), kind: 'cjk', weight: 3 })
      }
    }
  }
}

function normalizeTokenValue(value: string, kind: QueryTokenKind): string {
  const cleaned = value.replace(/\\/g, '/').replace(/^["'`]+|["'`.,;:]+$/g, '')
  return kind === 'path' ? cleaned.replace(/^\.\/+/g, '') : cleaned
}

function dedupeTokens(tokens: QueryToken[]): QueryToken[] {
  const byKey = new Map<string, QueryToken>()
  for (const token of tokens) {
    if (!token.value) continue
    const key = `${token.kind}:${token.value.toLowerCase()}`
    const existing = byKey.get(key)
    if (!existing || token.weight > existing.weight) byKey.set(key, token)
  }
  return [...byKey.values()]
}
