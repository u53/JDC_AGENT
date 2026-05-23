export interface ModelTraits {
  isReasoning: boolean
  useMaxCompletionTokens: boolean
  rejectsTemperature: boolean
}

const REASONING_PATTERNS: RegExp[] = [
  /^gpt-?5/,
  /^o[1-9]/,
  /^o[1-9]-/,
  /-reasoner($|[-:])/,
  /^deepseek-r/,
  /-thinking($|[-:])/,
  /^grok-.*-reason/,
  /^qwen3?-.*-thinking/,
  /^glm-.*-think/,
]

export function getModelTraits(modelId: string): ModelTraits {
  const id = (modelId || '').toLowerCase()
  const isReasoning = REASONING_PATTERNS.some(re => re.test(id))
  return {
    isReasoning,
    useMaxCompletionTokens: isReasoning,
    rejectsTemperature: isReasoning,
  }
}
