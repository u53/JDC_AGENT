import type { VerificationKind } from './verification-ledger.js'

export function classifyVerificationCommand(command: string): { kind: VerificationKind } | undefined {
  for (const segment of commandSegments(command)) {
    const kind = classifyCommandSegment(segment)
    if (kind) return { kind }
  }

  return undefined
}

function classifyCommandSegment(segment: string): VerificationKind | undefined {
  const normalized = stripShellComment(segment).trim().toLowerCase()
  if (!normalized) return undefined

  if (/^git\s+diff\s+--check\b/.test(normalized)) return 'diff_check'
  if (/^(vitest|jest|mocha|pytest)\b/.test(normalized)) return 'test'
  if (/^go\s+test\b/.test(normalized)) return 'test'
  if (/^cargo\s+test\b/.test(normalized)) return 'test'
  if (/^mvn\s+test\b/.test(normalized)) return 'test'
  if (/^gradle\s+test\b/.test(normalized)) return 'test'
  if (/^(npm|pnpm|yarn|bun)\b.*\b(exec|dlx)\s+(vitest|jest|mocha|pytest)\b/.test(normalized)) return 'test'
  if (/^(npm|pnpm|yarn|bun)\b.*\btest\b/.test(normalized)) return 'test'
  if (/^(tsc|typecheck)\b/.test(normalized)) return 'typecheck'
  if (/^(npm|pnpm|yarn|bun)\b.*\b(typecheck|check-types)\b/.test(normalized)) return 'typecheck'
  if (/^(npm|pnpm|yarn|bun)\b.*\bbuild\b/.test(normalized)) return 'build'
  if (/^(npm|pnpm|yarn|bun)\b.*\blint\b/.test(normalized)) return 'lint'
  if (/^eslint\b/.test(normalized)) return 'lint'

  return undefined
}

function commandSegments(command: string): string[] {
  const segments: string[] = []
  let start = 0
  let quote: 'single' | 'double' | undefined
  let escaped = false

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    const next = command[index + 1]

    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && quote !== 'single') {
      escaped = true
      continue
    }
    if (char === "'" && quote !== 'double') {
      quote = quote === 'single' ? undefined : 'single'
      continue
    }
    if (char === '"' && quote !== 'single') {
      quote = quote === 'double' ? undefined : 'double'
      continue
    }
    if (!quote && char === '&' && next === '&') {
      segments.push(command.slice(start, index))
      start = index + 2
      index += 1
    }
  }

  segments.push(command.slice(start))
  return segments
}

function stripShellComment(segment: string): string {
  let quote: 'single' | 'double' | undefined
  let escaped = false

  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index]

    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\' && quote !== 'single') {
      escaped = true
      continue
    }
    if (char === "'" && quote !== 'double') {
      quote = quote === 'single' ? undefined : 'single'
      continue
    }
    if (char === '"' && quote !== 'single') {
      quote = quote === 'double' ? undefined : 'double'
      continue
    }
    if (!quote && char === '#') return segment.slice(0, index)
  }

  return segment
}
