import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTeamStore, type TeamStatusUI } from '../stores/team-store'
import { TeamDetailPanel } from './TeamDetailPanel'

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom')
  return {
    ...actual,
    createPortal: (node: React.ReactNode, container: unknown) => React.createElement(
      'div',
      {
        className: 'team-member-portal-host',
        'data-container': container === (globalThis as any).document?.body ? 'body' : 'other',
      },
      node,
    ),
  }
})

const team: TeamStatusUI = {
  type: 'team',
  id: 'team-1',
  objective: 'Portal member modal',
  status: 'running',
  manager: { id: 'pm', name: 'Project Manager', status: 'running' },
  members: [{
    id: 'worker-1',
    name: 'Worker',
    role: 'Frontend Worker',
    responsibility: 'Inspect UI output.',
    agentType: 'worker',
    status: 'running',
    currentTaskId: 'task-1',
    toolCount: 2,
    lastActivityAt: 1_700_000_000_000,
  }],
  tasks: [{
    id: 'task-1',
    title: 'Render modal',
    description: 'Render modal outside Inspector bounds.',
    status: 'running',
    assigneeId: 'worker-1',
    priority: 'high',
  }],
  taskStats: { total: 1, completed: 0, running: 1, blocked: 0, cancelled: 0, todo: 0, failed: 0 },
}

describe('TeamDetailPanel portal behavior', () => {
  beforeEach(() => {
    ;(globalThis as any).document = { body: { nodeType: 1 } }
    useTeamStore.getState().reset()
    const state = {
      teams: { 'team-1': team },
      events: {},
      conversations: {},
      conversationKeys: {},
      activeTeamId: null,
      expandedMemberId: 'worker-1',
    }
    useTeamStore.setState(state)
    Object.assign(useTeamStore.getInitialState(), state)
  })

  it('portals member detail modal to document body', () => {
    const html = renderToStaticMarkup(<TeamDetailPanel sessionId="sess-1" taskId="team-1" />)

    expect(html).toContain('team-member-portal-host')
    expect(html).toContain('data-container="body"')
    expect(html).toContain('team-member-modal')
  })
})
