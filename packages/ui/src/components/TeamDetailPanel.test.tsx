import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { useTeamStore, type TeamStatusUI } from '../stores/team-store'
import { TeamDetailPanel } from './TeamDetailPanel'

const team: TeamStatusUI = {
  type: 'team',
  id: 'team-1',
  objective: 'Ship markdown team panel',
  status: 'running',
  manager: { id: 'pm', name: 'Project Manager', status: 'running' },
  members: [
    {
      id: 'worker-1',
      name: 'Worker',
      role: 'Frontend Worker',
      responsibility: 'Inspect UI output.',
      agentType: 'worker',
      status: 'running',
      currentTaskId: 'task-1',
      toolCount: 2,
      lastActivityAt: 1_700_000_000_000,
    },
  ],
  tasks: [
    {
      id: 'task-1',
      title: 'Render markdown',
      description: '## Worker runbook\n- Check `ContextPanel`\n\n```ts\nconst ok = true\n```',
      status: 'running',
      assigneeId: 'worker-1',
      priority: 'high',
    },
  ],
  taskStats: { total: 1, completed: 0, running: 1, blocked: 0, cancelled: 0, todo: 0, failed: 0 },
}

describe('TeamDetailPanel', () => {
  beforeEach(() => {
    useTeamStore.getState().reset()
    seedTeamStore()
  })

  it('renders team conversation markdown as rich markdown', () => {
    seedTeamStore({
      conversations: {
        'team-1': [{
      id: 'msg-1',
      direction: 'received',
      from: 'pm',
      intent: 'finding',
      content: '### PM update\n- Keep `scope` tight\n\n```md\n# shipped\n```',
      timestamp: 1_700_000_000_000,
        }],
      },
    })

    const html = renderToStaticMarkup(<TeamDetailPanel sessionId="sess-1" taskId="team-1" />)

    expect(html).toContain('<h3')
    expect(html).toContain('<ul')
    expect(html).toContain('markdown-code-block')
    expect(html).toContain('scope')
  })

  it('renders expanded member task descriptions as rich markdown', () => {
    seedTeamStore({ expandedMemberId: 'worker-1' })

    const html = renderToStaticMarkup(<TeamDetailPanel sessionId="sess-1" taskId="team-1" />)

    expect(html).toContain('<h2')
    expect(html).toContain('<ul')
    expect(html).toContain('markdown-code-block')
    expect(html).toContain('ContextPanel')
  })

  it('renders member events as a compact timeline instead of a raw log block', () => {
    seedTeamStore({
      expandedMemberId: 'worker-1',
      events: {
        'team-1': [
          '[09:41:12] [worker-1] tool_complete: Read',
          '[09:42:03] PM: assigning follow-up task',
        ],
      },
    })

    const html = renderToStaticMarkup(<TeamDetailPanel sessionId="sess-1" taskId="team-1" />)

    expect(html).toContain('team-event-timeline')
    expect(html).toContain('team-event-row')
    expect(html).toContain('09:41:12')
    expect(html).toContain('worker-1')
    expect(html).toContain('tool_complete')
    expect(html).not.toContain('<pre')
  })

  it('renders overview tasks as compact task cards with assignment metadata', () => {
    const html = renderToStaticMarkup(<TeamDetailPanel sessionId="sess-1" taskId="team-1" />)

    expect(html).toContain('team-task-board')
    expect(html).toContain('team-task-card')
    expect(html).toContain('Render markdown')
    expect(html).toContain('Frontend Worker')
    expect(html).toContain('high')
    expect(html).toContain('Worker runbook')
  })

  it('renders members as compact cards with current task context', () => {
    const html = renderToStaticMarkup(<TeamDetailPanel sessionId="sess-1" taskId="team-1" />)

    expect(html).toContain('team-member-board')
    expect(html).toContain('team-member-card')
    expect(html).toContain('Frontend Worker')
    expect(html).toContain('Inspect UI output.')
    expect(html).toContain('Render markdown')
    expect(html).toContain('2 tools')
  })

  it('renders project manager state as a rich overview card', () => {
    seedTeamStore({
      teams: {
        'team-1': {
          ...team,
          manager: {
            ...team.manager,
            currentDecision: '### PM decision\n- Keep `handoff` scoped',
          },
        },
      },
    })

    const html = renderToStaticMarkup(<TeamDetailPanel sessionId="sess-1" taskId="team-1" />)

    expect(html).toContain('team-manager-card')
    expect(html).toContain('<h3')
    expect(html).toContain('handoff')
    expect(html).toContain('Project Manager')
  })
})

function seedTeamStore(partial: Partial<ReturnType<typeof useTeamStore.getState>> = {}) {
  const next = {
    teams: { 'team-1': team },
    events: {},
    conversations: {},
    conversationKeys: {},
    activeTeamId: null,
    expandedMemberId: null,
    ...partial,
  }
  useTeamStore.setState(next)
  Object.assign(useTeamStore.getInitialState(), next)
}
