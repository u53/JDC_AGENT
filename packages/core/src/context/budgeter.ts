import type { ContextSection, ContextTokenBudget } from './types.js'

export interface ContextBudgetLimits {
  /** Legacy compatibility only. This value is observed in budget metadata but never enforced locally. */
  maxTokens?: number
  /** @deprecated JDC Context Engine never truncates individual sections by a local token ceiling. */
  maxSectionTokens?: number
  /** @deprecated JDC Context Engine never truncates code context by a local token ceiling. */
  maxCodeTokens?: number
}

/** @deprecated Kept for old diagnostics/tests; production budgeting no longer drops sections locally. */
export type DroppedContextReason = 'section_truncated' | 'bundle_token_budget_exceeded'

export interface DroppedContextSection {
  section: ContextSection
  reason: DroppedContextReason
  tokenEstimate: number
}

export interface ContextBudgetResult {
  sections: ContextSection[]
  dropped: DroppedContextSection[]
  budget: ContextTokenBudget
}

// Product contract: JDC Context Engine does not enforce local token, section,
// or code caps. Selection happens before this step via relevance/planning; this
// step only records observed token usage so future maintainers do not quietly
// reintroduce the old 2.5k/700/900 truncation behavior.
export function budgetContextSections(sections: ContextSection[], limits: ContextBudgetLimits): ContextBudgetResult {
  const usedTokens = sections.reduce((total, section) => total + section.tokenEstimate, 0)
  return {
    sections,
    dropped: [],
    budget: { maxTokens: limits.maxTokens, usedTokens, droppedTokens: 0 },
  }
}
