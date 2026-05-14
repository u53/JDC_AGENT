import type { Message } from './types.js'

export function estimateTokens(messages: Message[]): number {
  let tokens = 0
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'text') tokens += estimateTextTokens(block.text)
      else if (block.type === 'tool_use') tokens += estimateTextTokens(JSON.stringify(block.input)) + block.name.length
      else if (block.type === 'tool_result') tokens += estimateTextTokens(block.content)
      else if (block.type === 'image') tokens += 1000
    }
  }
  return tokens
}

function estimateTextTokens(text: string): number {
  let tokens = 0
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (code >= 0x4E00 && code <= 0x9FFF) {
      // CJK Unified Ideographs — ~1.5 tokens per character
      tokens += 1.5
    } else if (code >= 0x3000 && code <= 0x303F) {
      // CJK punctuation
      tokens += 1
    } else if (code >= 0xFF00 && code <= 0xFFEF) {
      // Fullwidth forms
      tokens += 1
    } else if (code > 0x7F) {
      // Other non-ASCII (e.g. accented Latin, Cyrillic, etc.)
      tokens += 1
    } else {
      // ASCII — ~4 chars per token
      tokens += 0.25
    }
  }
  return Math.ceil(tokens)
}
