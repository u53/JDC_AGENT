import { joinSegments } from '../context.js'
import type { PromptSegment } from '../types.js'

export interface OpenAIPromptParts {
  stablePrompt?: string
  dynamicPrompt?: string
}

export function resolveOpenAIPromptParts(systemPrompt?: string | PromptSegment[]): OpenAIPromptParts {
  if (!systemPrompt) return {}
  if (typeof systemPrompt === 'string') return { stablePrompt: systemPrompt }

  return {
    stablePrompt: joinPromptSegments(systemPrompt.filter(segment => segment.cacheable)),
    dynamicPrompt: joinPromptSegments(systemPrompt.filter(segment => !segment.cacheable)),
  }
}

export function formatOpenAIDynamicPrompt(dynamicPrompt: string): string {
  return `<dynamic-context>\n${dynamicPrompt}\n</dynamic-context>`
}

function joinPromptSegments(segments: PromptSegment[]): string | undefined {
  if (segments.length === 0) return undefined
  const joined = joinSegments(segments)
  return joined.trim().length > 0 ? joined : undefined
}
