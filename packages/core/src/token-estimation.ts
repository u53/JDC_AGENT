import type { Message } from './types.js'

export function estimateTokens(messages: Message[]): number {
  let chars = 0
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'text') chars += block.text.length
      else if (block.type === 'tool_use') chars += JSON.stringify(block.input).length + block.name.length
      else if (block.type === 'tool_result') chars += block.content.length
      else if (block.type === 'image') chars += 1000
    }
  }
  return Math.ceil(chars / 3.5)
}
