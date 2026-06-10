import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentStore, type AgentState } from '../../stores/agent-store'
import { useModelStore } from '../../stores/model-store'
import { AgentToolCard } from './AgentToolCard'

const agent: AgentState = {
  agentToolUseId: 'agent-tool-1',
  prompt: 'Review the UI shell.',
  modelId: 'group-uuid-1:deepseek-v4-flash',
  status: 'running',
  toolEvents: [
    { toolName: 'Read', status: 'complete', input: { file: 'src/a.ts' }, result: { content: 'ok' } },
    { toolName: 'Edit', status: 'start', input: { file: 'src/a.ts' } },
  ],
  textOutput: '',
  toolCount: 2,
  startTime: Date.now() - 4_000,
}

describe('AgentToolCard', () => {
  beforeEach(() => {
    const state = {
      agents: { 'agent-tool-1': agent },
      activeAgentId: null,
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

  it('renders running subagent cards with compact JDC dark metadata', () => {
    const html = renderToStaticMarkup(
      <AgentToolCard
        event={{
          type: 'progress',
          toolName: 'Agent',
          toolUseId: 'agent-tool-1',
          input: { prompt: agent.prompt, modelId: agent.modelId },
        } as any}
      />,
    )

    expect(html).toContain('agent-launch-control')
    expect(html).toContain('agent-launch-metrics')
    expect(html).toContain('agent-mini-timeline')
    expect(html).toContain('公司DS:DeepSeek V4 Flash')
    expect(html).not.toContain('group-uuid-1:deepseek-v4-flash')
    expect(html).toContain('2 tools')
    expect(html).not.toContain('[ABORT]')
  })
})
