import { containsSensitiveContext } from './redaction.js'
import type { HarvestCandidate, HarvestDecision, ToolExecutionEvent } from './types.js'

const GREETING_OR_SMALLTALK = /^(?:hi|hello|hey|yo|你好|您好|嗨|哈喽|早上好|晚上好)[!.。！~\s]*$/i
const NO_NEW_FACT = /^(?:ok|okay|k|yes|yep|yeah|no|nope|thanks?|thank you|ok thanks|thanks ok|got it|sounds good|continue|继续|可以|好的|好|嗯|行|收到|明白|了解|不用|算了)[!.。！,\s]*$/i
const MEMORY_OR_CONVENTION_SIGNAL = /\b(?:remember|memorize|save this|store this|project convention|team convention|repo convention|in this project|we always|we usually|always use|always run|always keep|always write)\b/i
const GOAL_OR_CONSTRAINT_SIGNAL = /\b(?:goal|objective|constraint|requirement|blocked|blocker|must|must not|do not|don't|keep|need to|needs to|should)\b/i
const SUBSTANTIVE_MESSAGE_MIN_CHARS = 18

export function routeHarvestCandidate(candidate: HarvestCandidate): HarvestDecision {
  const message = candidate.userMessage.trim()

  if (!message || GREETING_OR_SMALLTALK.test(message)) return { action: 'skip', reason: 'greeting_or_smalltalk' }
  if (NO_NEW_FACT.test(message)) return { action: 'skip', reason: 'no_new_fact' }
  if (containsSensitiveContext(candidate)) return { action: 'skip', reason: 'sensitive_content' }

  if (candidate.toolEvents.some(isFailedToolEvent)) {
    return { action: 'distill_runtime', reason: 'tool failure requires runtime narrative distillation' }
  }

  if (candidate.changedFiles.some(file => file.trim().length > 0)) {
    return { action: 'distill_project_update', reason: 'changed file evidence requires project update distillation' }
  }

  if (MEMORY_OR_CONVENTION_SIGNAL.test(message)) {
    return { action: 'distill_memory_candidate', reason: 'explicit memory or project convention candidate' }
  }

  if (GOAL_OR_CONSTRAINT_SIGNAL.test(message) || message.length >= SUBSTANTIVE_MESSAGE_MIN_CHARS) {
    return { action: 'distill_conversation', reason: 'substantive conversation turn requires model distillation' }
  }

  return { action: 'skip', reason: 'no_new_fact' }
}

function isFailedToolEvent(event: ToolExecutionEvent): boolean {
  const record = event as Record<string, unknown>
  const status = typeof event.status === 'string' ? event.status : typeof record.type === 'string' ? record.type : ''
  const result = record.result && typeof record.result === 'object' ? record.result as Record<string, unknown> : undefined
  return /^(?:error|failed|failure)$/i.test(status) || record.isError === true || result?.isError === true
}
