import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentStore, type AgentState } from '../stores/agent-store'
import { useModelStore } from '../stores/model-store'
import { AgentDetailPanel } from './AgentDetailPanel'

const agent: AgentState = {
  agentToolUseId: 'agent-1',
  prompt: 'Audit the context renderer and report concrete findings.',
  modelId: 'group-uuid-1:deepseek-v4-flash',
  status: 'running',
  toolEvents: [{
    toolName: 'Read',
    status: 'complete',
    input: { file: 'packages/ui/src/components/AgentDetailPanel.tsx' },
    result: { content: 'Read complete' },
  }],
  textOutput: '### Findings\n- Keep `scope` tight',
  toolCount: 1,
  startTime: Date.now() - 12_000,
}

describe('AgentDetailPanel', () => {
  beforeEach(() => {
    const state = {
      agents: { 'agent-1': agent },
      activeAgentId: 'agent-1',
    }
    useAgentStore.setState(state)
    Object.assign(useAgentStore.getInitialState(), state)
    const modelState = {
      activeModelId: 'model-entry-1',
      groups: [{
        id: 'group-uuid-1',
        name: '公司DS',
        protocol: 'openai-responses' as const,
        baseUrl: 'https://api.example.com/v1',
        apiKey: '',
        models: [{
          id: 'model-entry-1',
          name: 'DeepSeek V4 Flash',
          modelId: 'deepseek-v4-flash',
          contextWindow: 200000,
          maxTokens: 32000,
          compressAt: 0.9,
        }],
      }],
    }
    useModelStore.setState(modelState)
    Object.assign(useModelStore.getInitialState(), modelState)
  })

  it('renders subagent details in the JDC dark inspection layout', () => {
    const html = renderToStaticMarkup(<AgentDetailPanel />)

    expect(html).toContain('agent-detail-shell')
    expect(html).toContain('agent-detail-metrics')
    expect(html).toContain('agent-tool-timeline')
    expect(html).toContain('agent-output-panel')
    expect(html).toContain('公司DS:DeepSeek V4 Flash')
    expect(html).not.toContain('group-uuid-1:deepseek-v4-flash')
    expect(html).toContain('<h3')
    expect(html).toContain('scope')
    expect(html).not.toContain('[BG]')
  })

  it('renders long subagent prompts in a bounded readable prompt panel', () => {
    const longPrompt = [
      '你是实现子代理，执行计划 Task 1。',
      '路径：/Users/chenmingxu/gts/project/olympus/olympus-biz/src/main/java/com/servyou/olympus/biz/service/file/impl/sbb/FdSyncSbbFileServiceImpl.java',
      '验证：mvn -pl olympus-biz -DskipTests compile',
    ].join('\n')
    const state = {
      agents: {
        'agent-1': {
          ...agent,
          prompt: longPrompt,
        },
      },
      activeAgentId: 'agent-1',
    }
    useAgentStore.setState(state)
    Object.assign(useAgentStore.getInitialState(), state)

    const html = renderToStaticMarkup(<AgentDetailPanel />)

    expect(html).toContain('agent-prompt-panel')
    expect(html).toContain('max-h-[220px]')
    expect(html).toContain('overflow-y-auto')
    expect(html).toContain('overflow-x-auto')
    expect(html).toContain('whitespace-pre-wrap')
    expect(html).toContain('/Users/chenmingxu/gts/project/olympus')
  })
})
