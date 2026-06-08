import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAgentStore, type AgentState } from '../stores/agent-store'
import { AgentDetailPanel } from './AgentDetailPanel'

const agent: AgentState = {
  agentToolUseId: 'agent-1',
  prompt: 'Audit the context renderer and report concrete findings.',
  modelId: 'gpt-5.5',
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
  })

  it('renders subagent details in the JDC dark inspection layout', () => {
    const html = renderToStaticMarkup(<AgentDetailPanel />)

    expect(html).toContain('agent-detail-shell')
    expect(html).toContain('agent-detail-metrics')
    expect(html).toContain('agent-tool-timeline')
    expect(html).toContain('agent-output-panel')
    expect(html).toContain('<h3')
    expect(html).toContain('scope')
    expect(html).not.toContain('[BG]')
  })
})
