const rememberedCodeExpansions = new Map<string, boolean>()
const MAX_REMEMBERED_CODE_BLOCKS = 300

function hashText(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function createMarkdownCodeBlockKey(
  language: string,
  copyText: string,
  positionKey = '',
): string {
  return [language || 'code', copyText.length, hashText(copyText), positionKey].join(':')
}

export function getRememberedCodeExpansion(key: string, fallback: boolean): boolean {
  return rememberedCodeExpansions.get(key) ?? fallback
}

export function rememberCodeExpansion(key: string, expanded: boolean): void {
  if (!rememberedCodeExpansions.has(key) && rememberedCodeExpansions.size >= MAX_REMEMBERED_CODE_BLOCKS) {
    const oldestKey = rememberedCodeExpansions.keys().next().value
    if (oldestKey) rememberedCodeExpansions.delete(oldestKey)
  }
  rememberedCodeExpansions.set(key, expanded)
}

export function clearRememberedCodeExpansions(): void {
  rememberedCodeExpansions.clear()
}
