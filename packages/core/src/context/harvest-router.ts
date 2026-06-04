import { containsSensitiveContext } from './redaction.js'
import type { HarvestCandidate, HarvestDecision, ToolExecutionEvent } from './types.js'

const GREETING_OR_SMALLTALK = /^(?:hi|hello|hey|yo|你好|您好|嗨|哈喽|早上好|晚上好)[!.。！~\s]*$/i
const NO_NEW_FACT = /^(?:ok|okay|k|yes|yep|yeah|no|nope|thanks?|thank you|ok thanks|thanks ok|got it|sounds good|continue|继续|可以|好的|好|嗯|行|收到|明白|了解|不用|算了)[!.。！,\s]*$/i
const CONFIRMATION_SAVE_SIGNAL = /^(?:yes|yep|yeah|sure|of course|save it|store it|remember that|remember this|当然|可以|对|是的|存一下|记住|记下来)[!.。！,，\s]*(?:存一下|记住|记下来)?[!.。！,，\s]*$/i
const MEMORY_OR_CONVENTION_SIGNAL = /\b(?:remember|memorize|save this|store this|project convention|team convention|repo convention|in this project|we always|we usually|always use|always run|always keep|always write)\b/i
const GOAL_OR_CONSTRAINT_SIGNAL = /\b(?:goal|objective|constraint|requirement|blocked|blocker|must|must not|do not|don't|keep|need to|needs to|should)\b/i
const ASSISTANT_PROJECT_SUMMARY_SIGNAL = /(?:项目整体|项目架构|整体架构|架构概览|模块边界|包边界|package boundaries|architecture overview|project overview|module boundary|release workflow|常用命令|测试命令|构建命令|packages\/core|packages\/ui|packages\/electron)/i
const SUBSTANTIVE_MESSAGE_MIN_CHARS = 18
const ASSISTANT_SUMMARY_MIN_CHARS = 120

export function routeHarvestCandidate(candidate: HarvestCandidate): HarvestDecision {
  const message = candidate.userMessage.trim()

  if (!message || GREETING_OR_SMALLTALK.test(message)) return { action: 'skip', reason: 'greeting_or_smalltalk' }
  if (containsSensitiveContext(candidate)) return { action: 'skip', reason: 'sensitive_content' }

  if (isHarvestConfirmationSaveTurn(message) && hasAssistantProjectSummary(candidate)) {
    return { action: 'distill_project_update', reason: 'confirmation turn backfilled assistant project summary' }
  }

  if (NO_NEW_FACT.test(message)) return { action: 'skip', reason: 'no_new_fact' }

  if (candidate.toolEvents.some(isFailedToolEvent)) {
    return { action: 'distill_runtime', reason: 'tool failure requires runtime narrative distillation' }
  }

  const teamDecision = routeTeamCandidate(candidate)
  if (teamDecision) return teamDecision

  if (candidate.changedFiles.some(isWorkflowFile)) {
    return { action: 'distill_workflow_rule', reason: 'workflow/package file evidence requires workflow rule distillation' }
  }

  if (candidate.changedFiles.some(file => file.trim().length > 0)) {
    return { action: 'distill_project_update', reason: 'changed file evidence requires project update distillation' }
  }

  if (hasAssistantProjectSummary(candidate)) {
    return { action: 'distill_project_update', reason: 'assistant project summary requires project update distillation' }
  }

  if (MEMORY_OR_CONVENTION_SIGNAL.test(message)) {
    return { action: 'distill_memory_candidate', reason: 'explicit memory or project convention candidate' }
  }

  if (GOAL_OR_CONSTRAINT_SIGNAL.test(message) || message.length >= SUBSTANTIVE_MESSAGE_MIN_CHARS) {
    return { action: 'distill_conversation', reason: 'substantive conversation turn requires model distillation' }
  }

  return { action: 'skip', reason: 'no_new_fact' }
}

function routeTeamCandidate(candidate: HarvestCandidate): HarvestDecision | undefined {
  if (!isTeamOrigin(candidate)) return undefined
  const artifactEvents = candidate.toolEvents.filter(isTeamArtifactToolEvent)
  const hasStructuredTeamEvidence = artifactEvents.length > 0

  if (candidate.origin?.actor === 'team_pm' && isDurableTeamDecision(candidate.userMessage)) {
    return { action: 'distill_team_ledger', reason: 'structured Team PM decision requires team ledger distillation' }
  }

  for (const event of artifactEvents) {
    const action = toolEventString(event, ['action', 'toolAction'])
    const status = toolEventString(event, ['new_status', 'newStatus', 'status'])
    const target = toolEventString(event, ['target_id', 'targetId', 'issueId', 'issue_id'])
    if (action === 'create_issue' || target.startsWith('ISSUE-') || status === 'resolved' || status === 'wontfix') {
      return { action: 'distill_qa_issue', reason: 'structured Team QA issue candidate' }
    }
    if (action === 'update_status' && status === 'completed') {
      return { action: 'distill_team_ledger', reason: 'structured Team task result candidate' }
    }
  }

  if (hasStructuredTeamEvidence) {
    return { action: 'distill_artifact_summary', reason: 'structured Team artifact candidate' }
  }

  if (candidate.origin?.actor === 'team_worker') {
    return { action: 'skip', reason: 'no_new_fact' }
  }

  return undefined
}

function isFailedToolEvent(event: ToolExecutionEvent): boolean {
  const record = event as Record<string, unknown>
  const status = typeof event.status === 'string' ? event.status : typeof record.type === 'string' ? record.type : ''
  const result = record.result && typeof record.result === 'object' ? record.result as Record<string, unknown> : undefined
  return /^(?:error|failed|failure)$/i.test(status) || record.isError === true || result?.isError === true
}

function isTeamOrigin(candidate: HarvestCandidate): boolean {
  return candidate.origin?.actor === 'team_pm' || candidate.origin?.actor === 'team_worker' || typeof candidate.origin?.teamId === 'string'
}

function isTeamArtifactToolEvent(event: ToolExecutionEvent): boolean {
  return event.name === 'team_artifact' || toolEventString(event, ['toolName', 'name']) === 'team_artifact'
}

function isDurableTeamDecision(text: string): boolean {
  const normalized = text.trim()
  if (normalized.length < 12) return false
  if (/(思考中|等待|处理中|reviewing|waiting|thinking|in progress|status update|heartbeat)/i.test(normalized)) return false
  return /(decision|decided|must|keep|choose|chosen|adopt|决定|决策|必须|保持|采用|约定|选择)/i.test(normalized)
}

function toolEventString(event: ToolExecutionEvent, keys: string[]): string {
  const record = event as Record<string, unknown>
  for (const key of keys) {
    const direct = record[key]
    if (typeof direct === 'string') return direct
    const nested = nestedToolInputString(record, key)
    if (nested) return nested
  }
  return ''
}

function nestedToolInputString(record: Record<string, unknown>, key: string): string {
  for (const holderKey of ['input', 'args', 'arguments', 'params']) {
    const holder = record[holderKey]
    if (holder && typeof holder === 'object' && !Array.isArray(holder)) {
      const value = (holder as Record<string, unknown>)[key]
      if (typeof value === 'string') return value
    }
  }
  return ''
}

function isWorkflowFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '')
  return /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(normalized) ||
    normalized === 'package.json' ||
    /^packages\/[^/]+\/package\.json$/i.test(normalized)
}

export function isHarvestConfirmationSaveTurn(message: string): boolean {
  return CONFIRMATION_SAVE_SIGNAL.test(message.trim())
}

function hasAssistantProjectSummary(candidate: HarvestCandidate): boolean {
  return assistantMessagesContainProjectSummary(candidate.assistantMessages)
}

export function assistantMessagesContainProjectSummary(assistantMessages: HarvestCandidate['assistantMessages']): boolean {
  const text = assistantText(assistantMessages)
  return text.length >= ASSISTANT_SUMMARY_MIN_CHARS && ASSISTANT_PROJECT_SUMMARY_SIGNAL.test(text)
}

function assistantText(assistantMessages: HarvestCandidate['assistantMessages']): string {
  return assistantMessages
    .flatMap((message) => Array.isArray(message.content)
      ? message.content.flatMap((block) => {
        if (!block || typeof block !== 'object') return []
        const typed = block as { type?: string; text?: unknown }
        return typed.type === 'text' && typeof typed.text === 'string' ? [typed.text] : []
      })
      : [])
    .join('\n')
}
