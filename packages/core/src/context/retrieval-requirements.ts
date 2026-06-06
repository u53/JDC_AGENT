import type { ContextEvidenceRequirement, ContextEvidenceRequirementKind, ContextPlanIntent, ContextRequest } from './types.js'

const PATH_HINT_PATTERN = /(?:^|[\s"'`(])((?:\.{1,2}\/|\/)?(?:[\w.-]+\/)+[\w.-]+\.[A-Za-z0-9]+)(?=$|[\s"'`).,;:])/g
const SYMBOL_HINT_PATTERN = /\b[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?\b/g
const RESERVED_WORDS = new Set([
  'and',
  'the',
  'for',
  'with',
  'from',
  'this',
  'that',
  'phase',
  'fix',
  'review',
  'debug',
  'test',
  'file',
  'code',
  'packages',
  'src',
])

export function deriveContextEvidenceRequirements(request: ContextRequest): ContextEvidenceRequirement[] {
  const intent = inferRequirementIntent(request)
  const objective = request.userMessage.trim() || request.mode
  const relatedFiles = uniqueMatches(objective, PATH_HINT_PATTERN).map(normalizePathHint)
  const relatedSymbols = uniqueMatches(objective, SYMBOL_HINT_PATTERN)
    .filter((symbol) => symbol.length >= 3)
    .filter((symbol) => !RESERVED_WORDS.has(symbol.toLowerCase()))
    .filter(isSymbolHint)
    .filter((symbol) => !relatedFiles.some((file) => file.includes(symbol)))

  if (intent === 'code_edit') {
    return [makeRequirement('req_relevant_code', 'relevant_code', 'Code edit turns need target file or symbol evidence before mutation.', objective, 'must', relatedFiles, relatedSymbols)]
  }

  if (intent === 'debug') {
    return [makeRequirement('req_runtime_or_code', 'runtime_or_code', 'Debug turns need runtime output, relevant code, or both.', objective, 'must', relatedFiles, relatedSymbols)]
  }

  if (intent === 'review') {
    return [makeRequirement('req_diff_or_relevant_code', 'diff_or_relevant_code', 'Review turns need changed-file, git, or relevant code evidence.', objective, 'must', relatedFiles, relatedSymbols)]
  }

  if (intent === 'plan') {
    return [makeRequirement('req_repo_map', 'repo_map', 'Planning turns benefit from a compact repository map and project structure evidence.', objective, 'should', relatedFiles, relatedSymbols)]
  }

  return []
}

function makeRequirement(
  id: string,
  kind: ContextEvidenceRequirementKind,
  reason: string,
  query: string,
  priority: ContextEvidenceRequirement['priority'],
  relatedFiles: string[],
  relatedSymbols: string[],
): ContextEvidenceRequirement {
  return {
    id,
    kind,
    reason,
    query,
    priority,
    relatedFiles,
    relatedSymbols,
    docRefs: extractDocRefs(query),
    languageHints: extractLanguageHints(query),
  }
}

function inferRequirementIntent(request: ContextRequest): ContextPlanIntent {
  if (request.mode !== 'chat') return request.mode
  const text = request.userMessage.toLowerCase()
  if (/\b(review|code review|diff|pull request|pr)\b|审查|评审|审核/.test(text)) return 'review'
  if (/\b(plan|design|spec|proposal)\b|计划|方案|设计/.test(text)) return 'plan'
  if (/\b(fix|implement|refactor|change|update|edit|modify|patch)\b|修复|修改|实现|改代码|写代码|feature/.test(text)) return 'code_edit'
  if (/\b(why|investigate|diagnose|debug|explain|bug|error|failed|failure|cancelled|canceled|crash|runtime|performance)\b|为什么|为何|排查|定位|报错|错误|失败|卡死|性能|崩溃/.test(text)) return 'debug'
  return 'chat'
}

function uniqueMatches(text: string, pattern: RegExp): string[] {
  pattern.lastIndex = 0
  const out: string[] = []
  const seen = new Set<string>()
  for (const match of text.matchAll(pattern)) {
    const value = String(match[1] ?? match[0]).trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

function isSymbolHint(value: string): boolean {
  return value.includes('.') || /[A-Z_$]/.test(value)
}

function normalizePathHint(value: string): string {
  return value.replace(/\\/g, '/').replace(/^["'`]+|["'`.,;:]+$/g, '')
}

function extractDocRefs(text: string): string[] {
  return uniqueMatches(text, /\b((?:README|AGENTS|JDCAGNET|CHANGELOG|CONTRIBUTING|DESIGN|PLAN)(?:\.[A-Za-z0-9]+)?)\b/gi)
}

function extractLanguageHints(text: string): string[] {
  const hints = new Set<string>()
  if (/\b(?:ts|tsx|typescript)\b/i.test(text)) hints.add('typescript')
  if (/\b(?:js|jsx|javascript)\b/i.test(text)) hints.add('javascript')
  if (/\bpython|\.py\b/i.test(text)) hints.add('python')
  if (/\brust|\.rs\b/i.test(text)) hints.add('rust')
  if (/\bgo|golang|\.go\b/i.test(text)) hints.add('go')
  return [...hints]
}
