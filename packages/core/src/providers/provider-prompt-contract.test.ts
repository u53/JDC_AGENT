import { describe, expect, it } from 'vitest'
import { __anthropicPromptTest } from './anthropic.js'
import { __openAiChatPromptTest } from './openai-chat.js'
import { __openAiResponsesPromptTest } from './openai-responses.js'
import type { PromptSegment } from '../types.js'

describe('provider prompt contracts', () => {
  it('keeps JDC identity first in Anthropic stream system blocks', () => {
    const segments: PromptSegment[] = [
      { content: '# Identity\nYou are JDC CODE, JDC Context Engine powered coding agent.', cacheable: true },
      { content: '<jdc-context-engine>本轮注入项目上下文</jdc-context-engine>', cacheable: false },
    ]

    const blocks = __anthropicPromptTest.resolveStreamSystemPrompt(segments, 'x-anthropic-billing-header: cc_version=test;')
    const text = blocks.map((block: any) => block.text).join('\n')

    expect(text).toContain('You are JDC CODE')
    expect(text).not.toContain(['You are', 'Claude Code'].join(' '))
    expect(blocks.every((block: any) => block.type === 'text')).toBe(true)
    expect(blocks.find((block: any) => block.text.includes('<jdc-context-engine>'))?.cache_control).toBeUndefined()
  })

  it('keeps stream and non-stream prompt semantics aligned for JDC context segments', () => {
    const segments: PromptSegment[] = [
      { content: '# Identity\nYou are JDC CODE.', cacheable: true },
      { content: '<jdc-context-engine>动态项目上下文</jdc-context-engine>', cacheable: false },
    ]

    const streamBlocks = __anthropicPromptTest.resolveStreamSystemPrompt(segments, '')
    const chatBlocks = __anthropicPromptTest.resolveSystemPrompt(segments)

    expect(streamBlocks.map((block: any) => block.text).join('\n')).toContain('<jdc-context-engine>')
    expect(chatBlocks.map((block: any) => block.text).join('\n')).toContain('<jdc-context-engine>')
  })

  it('keeps only cacheable segments in OpenAI Chat system prompt', () => {
    const prompt = __openAiChatPromptTest.resolveSystemPrompt([
      { content: '# Identity\nYou are JDC CODE.', cacheable: true },
      { content: '<jdc-context-engine>项目上下文</jdc-context-engine>', cacheable: false },
    ])

    expect(prompt).toContain('You are JDC CODE')
    expect(prompt).not.toContain('<jdc-context-engine>')
  })

  it('keeps only cacheable segments in OpenAI Responses instructions', () => {
    const prompt = __openAiResponsesPromptTest.resolveSystemPrompt([
      { content: '# Identity\nYou are JDC CODE.', cacheable: true },
      { content: '<jdc-context-engine>项目上下文</jdc-context-engine>', cacheable: false },
    ])

    expect(prompt).toContain('You are JDC CODE')
    expect(prompt).not.toContain('<jdc-context-engine>')
  })

  it('keeps cached JDC Context Engine prompt segments outside Anthropic cache_control breakpoints', () => {
    const cachedContext = '<jdc-context-engine bundle="ctx_cached">cached project context</jdc-context-engine>'
    const segments: PromptSegment[] = [
      { content: '# Identity\nYou are JDC CODE.', cacheable: true },
      { content: cachedContext, cacheable: false },
    ]

    const blocks = __anthropicPromptTest.resolveStreamSystemPrompt(segments, 'x-anthropic-billing-header: cc_version=test;')
    const contextBlock = blocks.find((block: any) => block.text.includes('ctx_cached'))

    expect(contextBlock).toBeDefined()
    expect(contextBlock?.cache_control).toBeUndefined()
    expect(blocks.filter((block: any) => block.cache_control).length).toBe(1)
  })
})
