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

  it('moves the snapshot JDC Context Engine segment into the OpenAI stable prompt', () => {
    // Once the bundle is a stable snapshot (cacheable:true), it belongs in the
    // stable (cache-eligible) prefix for OpenAI too — not the <dynamic-context>
    // tail it used to land in when it was re-ranked every turn.
    const parts = __openAiChatPromptTest.resolvePromptParts([
      { content: '# Identity\nYou are JDC CODE.', cacheable: true },
      { content: 'Active task: ship it.', cacheable: false },
      { content: '<jdc-context-engine bundle="ctx_snap">snapshot context</jdc-context-engine>', cacheable: true, jdcContextEngine: true },
    ])

    expect(parts.stablePrompt).toContain('You are JDC CODE')
    expect(parts.stablePrompt).toContain('<jdc-context-engine bundle="ctx_snap">')
    expect(parts.dynamicPrompt ?? '').not.toContain('<jdc-context-engine')
    expect(parts.dynamicPrompt ?? '').toContain('Active task')
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

  it('merges the snapshot JDC Context Engine segment into the single cached system block', () => {
    // Relay shape contract: billing header (no cache) → ONE merged cacheable block
    // (base + engine snapshot) → optional dynamic tail. Exactly one cache breakpoint.
    const cachedContext = '<jdc-context-engine bundle="ctx_cached">cached project context</jdc-context-engine>'
    const segments: PromptSegment[] = [
      { content: '# Identity\nYou are JDC CODE.', cacheable: true },
      { content: 'Active task: build the thing.', cacheable: false },
      { content: cachedContext, cacheable: true, jdcContextEngine: true },
    ]

    const blocks = __anthropicPromptTest.resolveStreamSystemPrompt(segments, 'x-anthropic-billing-header: cc_version=test;')
    const cachedBlock = blocks.find((block: any) => block.cache_control)
    const dynamicBlock = blocks.find((block: any) => block.text.includes('Active task'))

    // Exactly one breakpoint, and it carries BOTH the base identity and the engine snapshot.
    expect(blocks.filter((block: any) => block.cache_control).length).toBe(1)
    expect(cachedBlock?.text).toContain('You are JDC CODE')
    expect(cachedBlock?.text).toContain('ctx_cached')
    // Base appears before the engine snapshot inside the merged block.
    expect(cachedBlock.text.indexOf('You are JDC CODE')).toBeLessThan(cachedBlock.text.indexOf('ctx_cached'))
    // Dynamic content stays out of the cached block.
    expect(dynamicBlock?.cache_control).toBeUndefined()
    expect(cachedBlock?.text).not.toContain('Active task')
  })

  it('keeps genuinely dynamic (unflagged, non-cacheable) segments outside breakpoints', () => {
    const segments: PromptSegment[] = [
      { content: '# Identity\nYou are JDC CODE.', cacheable: true },
      { content: '<jdc-context-engine bundle="ctx_dyn">uncached dynamic context</jdc-context-engine>', cacheable: false },
    ]

    const blocks = __anthropicPromptTest.resolveStreamSystemPrompt(segments, 'x-anthropic-billing-header: cc_version=test;')
    const contextBlock = blocks.find((block: any) => block.text.includes('ctx_dyn'))

    expect(contextBlock).toBeDefined()
    expect(contextBlock?.cache_control).toBeUndefined()
    expect(blocks.filter((block: any) => block.cache_control).length).toBe(1)
  })
})
