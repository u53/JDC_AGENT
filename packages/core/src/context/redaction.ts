import type { HarvestCandidate, RawEvidence } from './types.js'

export interface RedactionOptions {
  enabled?: boolean
  mode?: 'strict' | 'balanced'
}

export interface RedactionHit {
  path: string
  pattern: string
}

export interface RedactionResult<T> {
  value: T
  redacted: boolean
  hits: RedactionHit[]
}

type PatternRedactor = {
  name: string
  pattern: RegExp
  replacement: string
}

const DEFAULT_REDACTION_OPTIONS: Required<RedactionOptions> = {
  enabled: true,
  mode: 'strict',
}

const SENSITIVE_ASSIGNMENT_KEY_SOURCE = String.raw`(?:api[_-]?key|access[_-]?token|auth(?:orization)?|bearer|client[_-]?secret|database[_-]?url|db[_-]?password|passwd|password|private[_-]?key|secret|token|credential|cookie|session[_-]?key)`
const SECRET_KEY_PATTERN = new RegExp(SENSITIVE_ASSIGNMENT_KEY_SOURCE, 'i')
const REASONING_KEY_PATTERN = /raw[_-]?thinking|thinking|reasoning|reasoning[_-]?summary|chain[_-]?of[_-]?thought/i
const REASONING_TEXT_PATTERN = /(?:raw[_ -]?thinking|chain[-_ ]of[-_ ]thought|reasoning(?:_summary)?)/i

const STRICT_PATTERNS: PatternRedactor[] = [
  {
    name: 'authorization-bearer',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
    replacement: 'Bearer [REDACTED:secret]',
  },
  {
    name: 'openai-api-key',
    pattern: /\bsk-(?:proj-|live-)?[A-Za-z0-9_-]{16,}\b/g,
    replacement: '[REDACTED:secret]',
  },
  {
    name: 'github-token',
    pattern: /\b(?:github_pat|ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{16,}\b/g,
    replacement: '[REDACTED:secret]',
  },
  {
    name: 'database-url',
    pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s'"<>]+/gi,
    replacement: '[REDACTED:secret]',
  },
  {
    name: 'private-key-block',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: '[REDACTED:secret]',
  },
  {
    name: 'assigned-secret-quoted',
    pattern: new RegExp(String.raw`\b(${SENSITIVE_ASSIGNMENT_KEY_SOURCE}\s*[:=]\s*)(["'\`])([^\r\n]*?\S[^\r\n]*?)\2`, 'gi'),
    replacement: '$1$2[REDACTED:secret]$2',
  },
  {
    name: 'assigned-secret',
    pattern: new RegExp(String.raw`\b(${SENSITIVE_ASSIGNMENT_KEY_SOURCE}\s*[:=]\s*)([^\s,'"\`{}\]]{6,})`, 'gi'),
    replacement: '$1[REDACTED:secret]',
  },
]

export function redactText(value: string, options: RedactionOptions = {}): RedactionResult<string> {
  const config = normalizeOptions(options)
  if (!config.enabled) return { value, redacted: false, hits: [] }

  const { value: redacted, hits } = redactStringAtPath(value, 'text', config.mode)
  return { value: redacted, redacted: hits.length > 0, hits }
}

export function containsSensitiveContext(value: unknown, options: Omit<RedactionOptions, 'enabled'> = {}): boolean {
  return collectSensitiveHits(value, '', options.mode ?? DEFAULT_REDACTION_OPTIONS.mode).length > 0
}

export function containsRawReasoningData(value: unknown): boolean {
  if (typeof value === 'string') return REASONING_TEXT_PATTERN.test(value)
  if (Array.isArray(value)) return value.some(containsRawReasoningData)
  if (!value || typeof value !== 'object') return false

  return Object.entries(value).some(([key, nested]) => REASONING_KEY_PATTERN.test(key) || containsRawReasoningData(nested))
}

export function redactRawEvidenceForDistillation(evidence: RawEvidence, options: RedactionOptions = {}): RedactionResult<RawEvidence> {
  const result = redactUnknown(evidence, '', normalizeOptions(options))
  return {
    value: result.value as RawEvidence,
    redacted: result.hits.length > 0,
    hits: result.hits,
  }
}

export function redactHarvestCandidateForDistillation(candidate: HarvestCandidate, options: RedactionOptions = {}): RedactionResult<HarvestCandidate> {
  const result = redactUnknown(candidate, '', normalizeOptions(options))
  return {
    value: result.value as HarvestCandidate,
    redacted: result.hits.length > 0,
    hits: result.hits,
  }
}

export function redactValueForDistillation<T>(value: T, options: RedactionOptions = {}): RedactionResult<T> {
  const result = redactUnknown(value, '', normalizeOptions(options))
  return {
    value: result.value as T,
    redacted: result.hits.length > 0,
    hits: result.hits,
  }
}

export function redactForDurableStorage<T>(value: T, options: RedactionOptions = {}): RedactionResult<T> {
  return redactValueForDistillation(value, options)
}

function normalizeOptions(options: RedactionOptions): Required<RedactionOptions> {
  return {
    enabled: options.enabled ?? DEFAULT_REDACTION_OPTIONS.enabled,
    mode: options.mode ?? DEFAULT_REDACTION_OPTIONS.mode,
  }
}

function redactUnknown(value: unknown, path: string, options: Required<RedactionOptions>): RedactionResult<unknown> {
  if (!options.enabled) return { value, redacted: false, hits: [] }

  if (typeof value === 'string') {
    const result = redactStringAtPath(value, path || 'value', options.mode)
    return { value: result.value, redacted: result.hits.length > 0, hits: result.hits }
  }

  if (Array.isArray(value)) {
    const redacted = value.map((item, index) => redactUnknown(item, appendPath(path, String(index)), options))
    return combineArray(value, redacted)
  }

  if (!value || typeof value !== 'object') {
    return { value, redacted: false, hits: [] }
  }

  const entries = Object.entries(value as Record<string, unknown>)
  const clone: Record<string, unknown> = {}
  const hits: RedactionHit[] = []

  for (const [key, nested] of entries) {
    const nestedPath = appendPath(path, key)
    if (REASONING_KEY_PATTERN.test(key)) {
      clone[key] = '[REDACTED:reasoning]'
      hits.push({ path: nestedPath, pattern: 'raw-reasoning-field' })
      continue
    }

    if (SECRET_KEY_PATTERN.test(key) && typeof nested === 'string' && nested.trim()) {
      clone[key] = '[REDACTED:secret]'
      hits.push({ path: nestedPath, pattern: 'secret-field' })
      continue
    }

    const result = redactUnknown(nested, nestedPath, options)
    clone[key] = result.value
    hits.push(...result.hits)
  }

  return { value: clone, redacted: hits.length > 0, hits }
}

function combineArray(original: unknown[], results: Array<RedactionResult<unknown>>): RedactionResult<unknown[]> {
  const hits = results.flatMap((result) => result.hits)
  if (hits.length === 0) return { value: original, redacted: false, hits: [] }
  return { value: results.map((result) => result.value), redacted: true, hits }
}

function redactStringAtPath(value: string, path: string, mode: RedactionOptions['mode']): RedactionResult<string> {
  let current = value
  const hits: RedactionHit[] = []
  const patterns = mode === 'balanced' ? STRICT_PATTERNS.filter((redactor) => redactor.name !== 'assigned-secret') : STRICT_PATTERNS

  for (const redactor of patterns) {
    redactor.pattern.lastIndex = 0
    if (!redactor.pattern.test(current)) continue
    redactor.pattern.lastIndex = 0
    current = current.replace(redactor.pattern, redactor.replacement)
    hits.push({ path, pattern: redactor.name })
  }

  return { value: current, redacted: hits.length > 0, hits }
}

function collectSensitiveHits(value: unknown, path: string, mode: RedactionOptions['mode']): RedactionHit[] {
  if (typeof value === 'string') return redactStringAtPath(value, path || 'value', mode).hits
  if (Array.isArray(value)) return value.flatMap((item, index) => collectSensitiveHits(item, appendPath(path, String(index)), mode))
  if (!value || typeof value !== 'object') return []

  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const nestedPath = appendPath(path, key)
    if (SECRET_KEY_PATTERN.test(key) && typeof nested === 'string' && nested.trim()) return [{ path: nestedPath, pattern: 'secret-field' }]
    return collectSensitiveHits(nested, nestedPath, mode)
  })
}

function appendPath(base: string, segment: string): string {
  return base ? `${base}.${segment}` : segment
}
