import { describe, expect, it } from 'vitest'
import { __anthropicPromptTest } from './anthropic.js'
import type { PromptSegment } from '../types.js'

describe('provider prompt contracts', () => {
  it('keeps JDC identity first in Anthropic stream system blocks', () => {
    const segments: PromptSegment[] = [
      { content: '# Identity\nYou are JDCAGNET, JDC Context Engine powered coding agent.', cacheable: true },
      { content: '<jdc-context-engine>本轮注入项目上下文</jdc-context-engine>', cacheable: false },
    ]

    const blocks = __anthropicPromptTest.resolveStreamSystemPrompt(segments, 'x-anthropic-billing-header: cc_version=test;')
    const text = blocks.map((block: any) => block.text).join('\n')

    expect(text).toContain('You are JDCAGNET')
    expect(text).not.toContain('You are Claude Code')
    expect(blocks.every((block: any) => block.type === 'text')).toBe(true)
    expect(blocks.find((block: any) => block.text.includes('<jdc-context-engine>'))?.cache_control).toBeUndefined()
  })

  it('keeps stream and non-stream prompt semantics aligned for JDC context segments', () => {
    const segments: PromptSegment[] = [
      { content: '# Identity\nYou are JDCAGNET.', cacheable: true },
      { content: '<jdc-context-engine>动态项目上下文</jdc-context-engine>', cacheable: false },
    ]

    const streamBlocks = __anthropicPromptTest.resolveStreamSystemPrompt(segments, '')
    const chatBlocks = __anthropicPromptTest.resolveSystemPrompt(segments)

    expect(streamBlocks.map((block: any) => block.text).join('\n')).toContain('<jdc-context-engine>')
    expect(chatBlocks.map((block: any) => block.text).join('\n')).toContain('<jdc-context-engine>')
  })
})
