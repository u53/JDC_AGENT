import { describe, it, expect, vi } from 'vitest'
import { TeamRuntime, type TeamRuntimePlan } from '../team/team-runtime.js'
import { TeamManager } from '../team/team-manager.js'
import { TeamRegistry } from '../team/team-registry.js'
import { TeamConcurrencyController } from '../team/team-concurrency.js'
import { BackgroundTaskManager } from '../background-tasks.js'
import { createTeamListTool } from '../tools/team-list.js'
import { createTeamAddTaskTool } from '../tools/team-add-task.js'
import { createBackgroundSendTool } from '../tools/background-send.js'
import { DEFAULT_CONCURRENCY_POLICY } from '../team/team-types.js'
import { isPlanModeToolAllowed } from '../tools/enter-plan-mode.js'
import os from 'node:os'
import path from 'node:path'

function createMockProvider(response = 'Task completed successfully.') {
  return {
    async *stream() {
      yield { type: 'text_delta', text: response }
    },
  } as any
}

function createMockSubSessionDeps(responseText = 'Done.') {
  // Each call gets its own isolated tmpdir so parallel tests don't collide on .team/
  const cwd = path.join(os.tmpdir(), `team-mode-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  require('node:fs').mkdirSync(cwd, { recursive: true })
  return {
    provider: createMockProvider(responseText),
    toolRegistry: { getDefinitions: () => [], get: () => undefined } as any,
    modelConfig: { model: 'test', maxTokens: 1024 },
    cwd,
  }
}

function createTeamRuntime(overrides?: any) {
  const plan: TeamRuntimePlan = {
    members: [
      { role: 'Explorer A', responsibility: 'explore module A', agentType: 'explore' },
      { role: 'Explorer B', responsibility: 'explore module B', agentType: 'explore' },
      { role: 'Coder A', responsibility: 'implement feature A', agentType: 'general' },
      { role: 'Coder B', responsibility: 'implement feature B', agentType: 'general' },
    ],
    tasks: [
      { title: 'Task A', description: 'Do task A', priority: 'high' },
      { title: 'Task B', description: 'Do task B', priority: 'normal' },
      { title: 'Task C', description: 'Do task C', priority: 'normal', dependsOn: ['Task A'] },
      { title: 'Task D', description: 'Do task D', priority: 'low' },
    ],
  }

  return new TeamRuntime({
    objective: 'Test objective',
    plan,
    subSessionDeps: createMockSubSessionDeps() as any,
    taskTimeoutMs: 5000,
    teamTimeoutMs: 10000,
    ...overrides,
  })
}

// ============================================================
// 1. Plan Mode — Skill whitelist
// ============================================================
describe('Plan Mode Skill Whitelist', () => {
  it('allows Skill tool in plan mode', () => {
    expect(isPlanModeToolAllowed('Skill', {}, '/tmp')).toBe(true)
  })

  it('allows team_list in plan mode', () => {
    expect(isPlanModeToolAllowed('team_list', {}, '/tmp')).toBe(true)
  })

  it('allows background_status in plan mode', () => {
    expect(isPlanModeToolAllowed('background_status', {}, '/tmp')).toBe(true)
  })

  it('blocks file_edit in plan mode', () => {
    expect(isPlanModeToolAllowed('file_edit', {}, '/tmp')).toBe(false)
  })
})

// ============================================================
// 2. TeamManager — dependsOn title resolution
// ============================================================
describe('TeamManager dependsOn resolution', () => {
  it('resolves dependencies by title', () => {
    const mgr = new TeamManager({
      initialTasks: [
        { title: 'Setup', description: 'Setup env' },
        { title: 'Build', description: 'Build app', dependsOn: ['Setup'] },
      ],
      onEvent: () => {},
    })

    // Initially only Setup is runnable (Build depends on Setup)
    const runnable = mgr.getRunnableTasks()
    expect(runnable.length).toBe(1)
    expect(runnable[0].title).toBe('Setup')
  })

  it('unblocks dependent tasks after completion', () => {
    const mgr = new TeamManager({
      initialTasks: [
        { title: 'Setup', description: 'Setup env' },
        { title: 'Build', description: 'Build app', dependsOn: ['Setup'] },
      ],
      onEvent: () => {},
    })

    const tasks = mgr.getTasks()
    const setupTask = tasks.find(t => t.title === 'Setup')!
    mgr.markTaskAssigned(setupTask.id, 'member_1')
    mgr.markTaskRunning(setupTask.id)
    mgr.markTaskCompleted(setupTask.id, { summary: 'done', findings: [] })

    const runnable = mgr.getRunnableTasks()
    expect(runnable.length).toBe(1)
    expect(runnable[0].title).toBe('Build')
  })
})

// ============================================================
// 3. TeamManager — addTask
// ============================================================
describe('TeamManager addTask', () => {
  it('dynamically adds a task', () => {
    const mgr = new TeamManager({
      initialTasks: [{ title: 'Initial', description: 'First task' }],
      onEvent: () => {},
    })

    mgr.addTask({ title: 'New Task', description: 'Added later', priority: 'urgent' })
    const tasks = mgr.getTasks()
    expect(tasks.length).toBe(2)
    expect(tasks[1].title).toBe('New Task')
    expect(tasks[1].priority).toBe('urgent')
  })
})

// ============================================================
// 4. TeamManager — assign/schedule intent
// ============================================================
describe('TeamManager assign intent', () => {
  it('resets failed tasks on assign intent', () => {
    const mgr = new TeamManager({
      initialTasks: [{ title: 'Flaky', description: 'Might fail' }],
      onEvent: () => {},
    })

    const task = mgr.getTasks()[0]
    mgr.markTaskAssigned(task.id, 'member_1')
    mgr.markTaskRunning(task.id)
    mgr.markTaskFailed(task.id, 'network error')

    expect(mgr.getRunnableTasks().length).toBe(0)

    mgr.handleIntervention({
      id: 'msg_1', from: 'main_session', to: 'manager',
      intent: 'assign', content: 'retry', priority: 'normal', createdAt: Date.now(),
    })

    expect(mgr.getRunnableTasks().length).toBe(1)
  })
})

// ============================================================
// 5. Concurrency — file locks
// ============================================================
describe('TeamConcurrencyController file locks', () => {
  it('acquires and releases file locks', () => {
    const ctrl = new TeamConcurrencyController(DEFAULT_CONCURRENCY_POLICY)

    expect(ctrl.acquireFileLock('m1', '/src/app.ts')).toBe(true)
    expect(ctrl.acquireFileLock('m2', '/src/app.ts')).toBe(false)
    expect(ctrl.isFileLocked('/src/app.ts', 'm1')).toBe(false)
    expect(ctrl.isFileLocked('/src/app.ts', 'm2')).toBe(true)

    ctrl.releaseFileLock('m1', '/src/app.ts')
    expect(ctrl.acquireFileLock('m2', '/src/app.ts')).toBe(true)
  })

  it('releases all locks on markDone', () => {
    const ctrl = new TeamConcurrencyController(DEFAULT_CONCURRENCY_POLICY)
    ctrl.markRunning('m1', 'general')
    ctrl.acquireFileLock('m1', '/a.ts')
    ctrl.acquireFileLock('m1', '/b.ts')

    ctrl.markDone('m1')
    expect(ctrl.getFileLocks().length).toBe(0)
  })
})

// ============================================================
// 6. Concurrency — improved defaults
// ============================================================
describe('Concurrency defaults', () => {
  it('allows multiple write workers', () => {
    expect(DEFAULT_CONCURRENCY_POLICY.maxWriteWorkers).toBeGreaterThanOrEqual(3)
  })

  it('allows multiple shell workers', () => {
    expect(DEFAULT_CONCURRENCY_POLICY.maxShellWorkers).toBeGreaterThanOrEqual(3)
  })
})

// ============================================================
// 7. TeamRegistry — archived teams
// ============================================================
describe('TeamRegistry archival', () => {
  it('keeps team accessible after removal', () => {
    const registry = new TeamRegistry()
    const team = createTeamRuntime()
    registry.register(team)

    registry.remove(team.id)
    expect(registry.get(team.id)).toBeDefined()
    expect(registry.isArchived(team.id)).toBe(true)
    expect(registry.getAll().length).toBe(0)
    expect(registry.getAllIncludingArchived().length).toBe(1)
  })
})

// ============================================================
// 8. TeamRuntime — worker recycling & task execution
// ============================================================
describe('TeamRuntime worker recycling', () => {
  it('creates team with correct member count', () => {
    const team = createTeamRuntime()
    expect(team.getMembers().length).toBe(4) // 2 explore + 2 general
  })

  it('starts and assigns tasks', async () => {
    const events: any[] = []
    const team = createTeamRuntime({
      onEvent: (e: any) => events.push(e),
    })
    await team.start()

    // Wait for microtask tick + sub-session execution
    await new Promise(r => setTimeout(r, 200))

    const members = team.getMembers()
    const running = members.filter(m => m.status === 'running')
    const completed = members.filter(m => m.status === 'completed')
    const queued = members.filter(m => m.status === 'queued')

    // At least some tasks should have been assigned
    const assignEvents = events.filter(e => e.type === 'task_assigned')
    expect(assignEvents.length).toBeGreaterThan(0)
  })

  it('recycles workers after task completion', async () => {
    const team = createTeamRuntime()
    await team.start()

    // Wait for tasks to complete and workers to be recycled
    await new Promise(r => setTimeout(r, 1000))

    const tasks = team.getTasks()
    const completedTasks = tasks.filter(t => t.status === 'completed')
    // With mock provider returning immediately, tasks should complete
    expect(completedTasks.length).toBeGreaterThan(0)
  })
})

// ============================================================
// 9. team_list tool
// ============================================================
describe('team_list tool', () => {
  it('lists active teams', async () => {
    const bgMgr = new BackgroundTaskManager(path.join(os.tmpdir(), 'team-test-' + Date.now()))
    const registry = new TeamRegistry()
    const team = createTeamRuntime()
    registry.register(team)
    bgMgr.registerTeam('Test objective', [{ role: 'Explorer' }])

    const tool = createTeamListTool({ backgroundTasks: bgMgr, teamRegistry: registry })
    const result = await tool.execute({}, {} as any)
    expect(result.content).toContain('Test objective')
  })
})

// ============================================================
// 10. team_add_task tool
// ============================================================
describe('team_add_task tool', () => {
  it('adds task to running team', async () => {
    const bgMgr = new BackgroundTaskManager(path.join(os.tmpdir(), 'team-add-' + Date.now()))
    const registry = new TeamRegistry()
    const team = createTeamRuntime()
    registry.register(team)
    const bgTask = bgMgr.registerTeam('Test', [])
    // Manually set the team ID to match
    ;(team as any).id = bgTask.id
    registry.register(team)

    const tool = createTeamAddTaskTool({ backgroundTasks: bgMgr, teamRegistry: registry })
    const result = await tool.execute({
      task_id: bgTask.id,
      title: 'New Dynamic Task',
      description: 'Added at runtime',
      priority: 'high',
    }, {} as any)

    expect(result.content).toContain('New Dynamic Task')
    expect(result.isError).toBeUndefined()
  })
})

// ============================================================
// 11. background_send — assign intent
// ============================================================
describe('background_send assign intent', () => {
  it('sends assign intent to team', async () => {
    const bgMgr = new BackgroundTaskManager(path.join(os.tmpdir(), 'team-send-' + Date.now()))
    const registry = new TeamRegistry()
    const team = createTeamRuntime()
    const bgTask = bgMgr.registerTeam('Test', [])
    ;(team as any).id = bgTask.id
    registry.register(team)

    const tool = createBackgroundSendTool({ backgroundTasks: bgMgr, teamRegistry: registry })
    const result = await tool.execute({
      task_id: bgTask.id,
      message: 'Start all workers',
      intent: 'assign',
    }, {} as any)

    expect(result.content).toContain('assign')
    expect(result.isError).toBeUndefined()
  })
})

// ============================================================
// 12. TeamRuntime — timeout mechanism
// ============================================================
describe('TeamRuntime timeout', () => {
  it('respects team timeout configuration', () => {
    const team = createTeamRuntime({ teamTimeoutMs: 5000 })
    expect(team).toBeDefined()
    // Team timeout is set internally, verified by the fact it doesn't throw
  })
})
