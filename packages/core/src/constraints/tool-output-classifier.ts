import type { VerificationKind } from './verification-ledger.js'

export function classifyVerificationCommand(command: string): { kind: VerificationKind } | undefined {
  const normalized = command.toLowerCase()

  if (/\b(vitest|jest|mocha|pytest)\b/.test(normalized)) return { kind: 'test' }
  if (/\b(go test|cargo test|mvn test|gradle test)\b/.test(normalized)) return { kind: 'test' }
  if (/\b(npm|pnpm|yarn|bun)\b.*\btest\b/.test(normalized)) return { kind: 'test' }
  if (/\b(tsc|typecheck)\b/.test(normalized)) return { kind: 'typecheck' }
  if (/\b(npm|pnpm|yarn|bun)\b.*\b(typecheck|check-types)\b/.test(normalized)) return { kind: 'typecheck' }
  if (/\b(npm|pnpm|yarn|bun)\b.*\bbuild\b/.test(normalized)) return { kind: 'build' }
  if (/\b(npm|pnpm|yarn|bun)\b.*\blint\b/.test(normalized)) return { kind: 'lint' }
  if (/\beslint\b/.test(normalized)) return { kind: 'lint' }

  return undefined
}
