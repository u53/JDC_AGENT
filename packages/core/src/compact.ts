import type { Message, ModelConfig, StreamChunk } from './types.js'
import type { ModelProvider } from './model-provider.js'
import { v4 as uuid } from 'uuid'

const COMPACT_PROMPT = `Your task is to create a detailed summary of the conversation so far.
This summary should capture technical details, code patterns, and decisions essential for continuing work.

CRITICAL: Respond with TEXT ONLY. Do NOT call any tools.

Your summary should include:
1. Primary Request and Intent
2. Key Technical Concepts
3. Files and Code Sections (with snippets)
4. Errors and fixes
5. Problem Solving progress
6. Pending Tasks
7. Current Work
8. Next Step

Wrap your analysis in <analysis> tags, then provide the summary in <summary> tags.`

const KEEP_RECENT = 6

export async function compactMessages(
  messages: Message[],
  provider: ModelProvider,
  config: ModelConfig,
  onChunk?: (chunk: StreamChunk) => void
): Promise<Message[]> {
  if (messages.length <= KEEP_RECENT) return messages

  const toCompress = messages.slice(0, messages.length - KEEP_RECENT)
  const toKeep = messages.slice(messages.length - KEEP_RECENT)

  const compactConfig: ModelConfig = { ...config, systemPrompt: COMPACT_PROMPT, maxTokens: 8192 }
  const compactMsgs: Message[] = [
    ...toCompress,
    { id: uuid(), role: 'user', content: [{ type: 'text', text: 'Please summarize the conversation above.' }], timestamp: Date.now() },
  ]

  let summaryText = ''
  for await (const chunk of provider.stream(compactMsgs, [], compactConfig)) {
    if (chunk.type === 'text_delta' && chunk.text) {
      summaryText += chunk.text
      onChunk?.(chunk)
    }
  }

  const formatted = formatCompactSummary(summaryText)

  const summaryMessage: Message = {
    id: uuid(),
    role: 'user',
    content: [{ type: 'text', text: `[Context Summary]\n\n${formatted}` }],
    timestamp: Date.now(),
  }

  return [summaryMessage, ...toKeep]
}

function formatCompactSummary(raw: string): string {
  let result = raw.replace(/<analysis>[\s\S]*?<\/analysis>/g, '')
  const match = result.match(/<summary>([\s\S]*?)<\/summary>/)
  if (match) result = match[1].trim()
  return result.trim() || raw
}
