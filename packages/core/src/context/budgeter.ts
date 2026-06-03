import type { ContextSection, ContextTokenBudget } from './types.js'

export interface ContextBudgetLimits {
  maxTokens: number
  maxSectionTokens: number
  maxCodeTokens: number
}

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

export function budgetContextSections(sections: ContextSection[], limits: ContextBudgetLimits): ContextBudgetResult {
  const dropped: DroppedContextSection[] = []
  const resized = sections.map((section) => enforceSectionLimit(section, limits, dropped))
  const kept: ContextSection[] = []
  let usedTokens = 0
  let droppedTokens = dropped.reduce((total, drop) => total + drop.tokenEstimate, 0)

  for (const section of resized) {
    if (usedTokens + section.tokenEstimate > limits.maxTokens) {
      dropped.push({ section, reason: 'bundle_token_budget_exceeded', tokenEstimate: section.tokenEstimate })
      droppedTokens += section.tokenEstimate
      continue
    }
    kept.push(section)
    usedTokens += section.tokenEstimate
  }

  return {
    sections: kept,
    dropped,
    budget: { maxTokens: limits.maxTokens, usedTokens, droppedTokens },
  }
}

function enforceSectionLimit(section: ContextSection, limits: ContextBudgetLimits, dropped: DroppedContextSection[]): ContextSection {
  const maxTokens = section.kind === 'relevant_code' ? limits.maxCodeTokens : limits.maxSectionTokens
  if (section.tokenEstimate <= maxTokens) return section

  const droppedTokens = section.tokenEstimate - maxTokens
  dropped.push({ section, reason: 'section_truncated', tokenEstimate: droppedTokens })
  return {
    ...section,
    content: truncateToTokenEstimate(section.content, maxTokens),
    tokenEstimate: maxTokens,
  }
}

function truncateToTokenEstimate(content: string, maxTokens: number): string {
  const maxChars = Math.max(0, maxTokens * 4)
  if (content.length <= maxChars) return `${content}\n[truncated by JDC Context Engine]`
  return `${content.slice(0, maxChars).trimEnd()}\n[truncated by JDC Context Engine]`
}
