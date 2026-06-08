import { describe, expect, it } from 'vitest'
import { selectTeamIdsToPoll } from './GlobalTeamPoller'
import type { BackgroundTaskItem } from '../stores/background-task-store'
import type { TeamStatusUI } from '../stores/team-store'

describe('selectTeamIdsToPoll', () => {
  it('polls a finalized terminal team again when the UI status snapshot is missing', () => {
    const tasks: BackgroundTaskItem[] = [{
      id: 'team-1',
      type: 'team',
      status: 'completed',
      startedAt: 1,
    }]

    expect(selectTeamIdsToPoll(tasks, new Set(['team-1']), {})).toEqual(['team-1'])
  })

  it('skips a finalized terminal team when its UI status snapshot is still available', () => {
    const tasks: BackgroundTaskItem[] = [{
      id: 'team-1',
      type: 'team',
      status: 'completed',
      startedAt: 1,
    }]
    const snapshots: Record<string, TeamStatusUI> = {
      'team-1': {
        type: 'team',
        id: 'team-1',
        objective: 'Done team',
        status: 'completed',
        manager: { id: 'pm', name: 'PM', status: 'completed' },
        members: [],
        tasks: [],
        taskStats: { total: 0, completed: 0, running: 0, blocked: 0, cancelled: 0, todo: 0, failed: 0 },
        finished: true,
      },
    }

    expect(selectTeamIdsToPoll(tasks, new Set(['team-1']), snapshots)).toEqual([])
  })
})
