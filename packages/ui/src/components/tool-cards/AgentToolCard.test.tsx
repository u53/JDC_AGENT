import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentStore, type AgentState } from '../../stores/agent-store'
import { AgentToolCard } from './AgentToolCard'

const agent: AgentState = {
  agentToolUseId: 'agent-tool-1',
  prompt: 'Review the UI shell.',
  modelId: 'gpt-5.5',
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
    expect(html).toContain('gpt-5.5')
    expect(html).toContain('2 tools')
    expect(html).not.toContain('[ABORT]')
  })
})
