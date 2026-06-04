import { routeHarvestCandidate } from './harvest-router.js'
import type { HarvestCandidate, HarvestDecision, HarvestModelBinding, HarvestPlan, HarvestPlanAction, SkipReason } from './types.js'

export interface HarvestClassifierContext {
  fallbackDecision: HarvestDecision
  modelBinding: HarvestModelBinding
}

export type HarvestClassifier = (candidate: HarvestCandidate, context: HarvestClassifierContext) => Promise<HarvestPlan> | HarvestPlan

export interface ClassifyHarvestPlanOptions {
  classifier?: HarvestClassifier
  fallbackDecision?: HarvestDecision
  modelBinding: HarvestModelBinding
}

export interface HarvestPlanClassification {
  plan: HarvestPlan
  decision: HarvestDecision
  diagnostics: string[]
}

export async function classifyHarvestPlan(candidate: HarvestCandidate, options: ClassifyHarvestPlanOptions): Promise<HarvestPlanClassification> {
  const fallbackDecision = options.fallbackDecision ?? routeHarvestCandidate(candidate)
  const fallbackPlan = harvestPlanFromDecision(candidate, fallbackDecision, 'router fallback')
  if (!options.classifier) return { plan: fallbackPlan, decision: decisionFromHarvestPlan(fallbackPlan), diagnostics: [] }

  try {
    const plan = normalizeHarvestPlan(await options.classifier(candidate, {
      fallbackDecision,
      modelBinding: options.modelBinding,
    }), candidate, fallbackPlan)
    return { plan, decision: decisionFromHarvestPlan(plan), diagnostics: [] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      plan: fallbackPlan,
      decision: decisionFromHarvestPlan(fallbackPlan),
      diagnostics: [`Harvest classifier failed; using router fallback: ${message}`],
    }
  }
}

export function harvestPlanFromDecision(candidate: HarvestCandidate, decision: HarvestDecision, reason = decision.reason): HarvestPlan {
  return {
    id: `plan_${candidate.runLoopId}`,
    runLoopId: candidate.runLoopId,
    reason,
    sourceMessageIds: candidate.assistantMessages.map((message) => message.id),
    actions: [{
      action: decision.action,
      reason: decision.reason,
      priority: decision.action === 'skip' ? 0 : 100,
    }],
  }
}

export function decisionFromHarvestPlan(plan: HarvestPlan): HarvestDecision {
  const action = [...plan.actions].sort((a, b) => b.priority - a.priority)[0]
  if (!action) return { action: 'skip', reason: 'model_noop' }
  if (action.action === 'skip') return { action: 'skip', reason: skipReasonFromString(action.reason) }
  return { action: action.action, reason: action.reason } as HarvestDecision
}

function normalizeHarvestPlan(plan: HarvestPlan, candidate: HarvestCandidate, fallbackPlan: HarvestPlan): HarvestPlan {
  if (!plan || !Array.isArray(plan.actions) || plan.actions.length === 0) return fallbackPlan
  return {
    id: plan.id || `plan_${candidate.runLoopId}`,
    runLoopId: plan.runLoopId || candidate.runLoopId,
    reason: plan.reason || fallbackPlan.reason,
    sourceMessageIds: Array.isArray(plan.sourceMessageIds) ? plan.sourceMessageIds.filter((id) => typeof id === 'string' && id.length > 0) : fallbackPlan.sourceMessageIds,
    actions: plan.actions
      .filter(isHarvestPlanAction)
      .map((action) => ({
        action: action.action,
        reason: action.reason,
        priority: Number.isFinite(action.priority) ? action.priority : 0,
      })),
  }
}

function isHarvestPlanAction(action: unknown): action is HarvestPlanAction {
  if (!action || typeof action !== 'object') return false
  const typed = action as Partial<HarvestPlanAction>
  return isHarvestDecisionAction(typed.action) && typeof typed.reason === 'string'
}

function isHarvestDecisionAction(action: unknown): action is HarvestPlanAction['action'] {
  return action === 'skip' ||
    action === 'distill_runtime' ||
    action === 'distill_conversation' ||
    action === 'distill_memory_candidate' ||
    action === 'distill_project_update' ||
    action === 'distill_team_ledger' ||
    action === 'distill_artifact_summary' ||
    action === 'distill_qa_issue' ||
    action === 'distill_workflow_rule'
}

function skipReasonFromString(reason: string): SkipReason {
  return isSkipReason(reason) ? reason : 'model_noop'
}

function isSkipReason(reason: string): reason is SkipReason {
  return reason === 'greeting_or_smalltalk' ||
    reason === 'no_new_fact' ||
    reason === 'too_short' ||
    reason === 'duplicate_of_existing_context' ||
    reason === 'low_confidence' ||
    reason === 'sensitive_content' ||
    reason === 'rate_limited' ||
    reason === 'model_noop' ||
    reason === 'cancelled' ||
    reason === 'timeout'
}
