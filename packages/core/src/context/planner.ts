import { createHash } from 'node:crypto'
import { deriveContextEvidenceRequirements } from './retrieval-requirements.js'
import type { ContextEvidenceRequirement, ContextPlan, ContextPlanIntent, ContextRequest, ContextSection } from './types.js'

export function planContext(request: ContextRequest, sections: ContextSection[]): ContextPlan {
  const intent = inferIntent(request)
  const evidenceRequirements = request.evidenceRequirements ?? deriveContextEvidenceRequirements(request)
  const relevantSections: string[] = []
  const suppressedSections: Array<{ id: string; reason: string }> = []

  for (const section of sections) {
    const suppression = suppressionReason(request, section)
    if (suppression) {
      suppressedSections.push({ id: section.id, reason: suppression })
      continue
    }
    if (isRelevant(intent, section)) relevantSections.push(section.id)
  }

  return {
    id: `ctx_plan_${hashText(`${request.sessionId}:${request.createdAt}:${request.userMessage}`).slice(0, 16)}`,
    requestHash: hashText(JSON.stringify({
      sessionId: request.sessionId,
      cwd: request.cwd,
      userMessage: request.userMessage,
      mode: request.mode,
      transcriptAlreadyInModel: request.transcriptAlreadyInModel === true,
    })),
    intent,
    objective: request.userMessage.trim() || request.mode,
    relevantSections,
    suppressedSections,
    evidenceRequirements,
    missingEvidence: missingEvidenceFor(intent, sections, evidenceRequirements),
    diagnostics: [],
  }
}

function missingEvidenceFor(_intent: ContextPlanIntent, sections: ContextSection[], requirements: ContextEvidenceRequirement[]): ContextEvidenceRequirement[] {
  return requirements
    .filter((requirement) => !requirementSatisfied(requirement, sections))
    .map((requirement) => ({ ...requirement, status: 'missing' }))
}

function requirementSatisfied(requirement: ContextEvidenceRequirement, sections: ContextSection[]): boolean {
  if (requirement.kind === 'relevant_code') return sections.some((section) => section.kind === 'relevant_code')
  if (requirement.kind === 'runtime_or_code') return sections.some((section) => section.kind === 'runtime_state' || section.kind === 'relevant_code')
  if (requirement.kind === 'diff_or_relevant_code') return sections.some((section) => section.kind === 'git_state' || section.kind === 'relevant_code')
  if (requirement.kind === 'repo_map') return sections.some((section) => section.kind === 'code_map')
  if (requirement.kind === 'project_doc') return sections.some((section) => section.kind === 'project_profile')
  return false
}

function inferIntent(request: ContextRequest): ContextPlanIntent {
  if (request.mode !== 'chat') return request.mode
  const text = request.userMessage.toLowerCase()

  if (/\b(review|code review|diff|pull request|pr)\b|审查|评审|审核/.test(text)) return 'review'
  if (/记住|保存|remember|memory/.test(text)) return 'memory_update'
  if (/\b(fix|implement|refactor|change|update|edit|modify|patch)\b|修复|修改|实现|改代码|写代码|feature/.test(text)) return 'code_edit'
  if (/\b(why|investigate|diagnose|debug|explain)\b|为什么|为何|排查|定位/.test(text)) return 'debug'
  if (/\b(bug|error|failed|failure|cancelled|canceled|crash|runtime|cpu|performance)\b|报错|错误|失败|卡死|性能|崩溃/.test(text)) return 'debug'
  return 'chat'
}

function suppressionReason(_request: ContextRequest, section: ContextSection): string | null {
  const content = section.content.toLowerCase()
  if (section.kind === 'diagnostics' && /model_noop|noop|no durable/.test(content)) return 'low_salience_diagnostic'
  if (section.freshness === 'stale' && isLowValueStaleSection(section)) return 'stale_low_value'
  return null
}

function isLowValueStaleSection(section: ContextSection): boolean {
  if (section.kind === 'user_intent') return false
  if (section.kind === 'memory' && /known issue/i.test(section.title)) return false
  return section.kind === 'memory' || section.kind === 'diagnostics'
}

function isRelevant(intent: ContextPlanIntent, section: ContextSection): boolean {
  if (section.kind === 'agent_contract') return ['debug', 'code_edit', 'review', 'plan', 'memory_update'].includes(intent)
  if (section.kind === 'user_intent') return ['chat', 'debug', 'code_edit', 'review', 'plan', 'memory_update'].includes(intent)
  if (section.kind === 'memory') return true
  if (intent === 'debug') return ['runtime_state', 'diagnostics', 'relevant_code', 'ide_state', 'memory', 'project_profile', 'user_intent'].includes(section.kind)
  if (intent === 'code_edit') return ['runtime_state', 'relevant_code', 'ide_state', 'git_state', 'memory', 'project_profile', 'conversation_state', 'user_intent'].includes(section.kind)
  if (intent === 'review') return ['relevant_code', 'git_state', 'memory', 'project_profile', 'user_intent'].includes(section.kind)
  if (intent === 'plan') return ['project_profile', 'memory', 'conversation_state', 'code_map', 'user_intent'].includes(section.kind)
  if (intent === 'memory_update') return ['conversation_state', 'memory', 'project_profile'].includes(section.kind)
  return ['memory', 'conversation_state', 'project_profile', 'ide_state', 'user_intent'].includes(section.kind)
}

function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}
