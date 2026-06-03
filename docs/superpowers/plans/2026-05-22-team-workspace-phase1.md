# Team Workspace Phase 1 — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Spec:** `docs/superpowers/specs/2026-05-22-team-workspace-design.md`

**Phase 1 Goal:** Establish `.team/` workspace foundation. Worker artifacts become structured + visible to downstream tasks. NO contracts, NO issues, NO QA — those land in Phase 2/3.

**Architecture:** A new `TeamWorkspace` class encapsulates all `.team/` IO with async file locking. A new `team_artifact` tool (with two actions: `create_artifact`, `update_status`) is injected into every worker's sub-session. `TeamRuntime.assignTask` becomes async to read upstream artifact summaries and inject them into `taskPrompt`. On team completion, the entire `.team/` directory is moved to `.team-archive/<team-id>-<ts>/`.

**Tech Stack:** TypeScript (Node), Vitest, fs/promises, gray-matter (frontmatter), no new external deps if avoidable.

---

## Out-of-Scope for Phase 1 (Important)

- ❌ `contracts/` directory — exists but NEVER written to (Phase 2)
- ❌ `issues/` directory — exists but NEVER written to (Phase 3)
- ❌ `team_artifact` actions `create_contract` / `create_issue` — return error if invoked
- ❌ PM contract-judgment / QA-judgment prompt sections (Phase 2 / 3)
- ❌ Reopened task semantics (Phase 3)
- ❌ README.md auto-regeneration on every status change (write once at init, regenerate at archive)

✅ In Phase 1: workspace skeleton, `create_artifact` + `update_status` only, async file lock, archive on complete, `assignTask` injects upstream artifact summaries.

---

## File Structure

### New Files
- `packages/core/src/team/team-workspace.ts` — `.team/` IO + frontmatter helpers
- `packages/core/src/team/async-lock.ts` — Tiny async mutex (per-key)
- `packages/core/src/tools/team-artifact.ts` — New tool, only `create_artifact` + `update_status`
- `packages/core/src/__tests__/team-workspace.test.ts`
- `packages/core/src/__tests__/team-artifact-tool.test.ts`
- `packages/core/src/__tests__/async-lock.test.ts`

### Modified Files
- `packages/core/src/team/team-types.ts` — Add `TaskFrontmatter`, `ArtifactFrontmatter`, `ResultFrontmatter`, `TaskStatus` extension (no schema break)
- `packages/core/src/team/team-runtime.ts` — Construct `TeamWorkspace`, `assignTask` becomes async, archive on complete, propagate `archivePath` option
- `packages/core/src/team/team-member.ts` — Accept optional `workspace` + `taskId`, inject `team_artifact` tool, prepend workspace hint to `taskPrompt`
- `packages/core/src/tools/team.ts` — Accept optional `archive_path` input, forward to runtime
- `packages/core/package.json` — Add `gray-matter` dep (lightweight frontmatter parser)

### Unchanged but Worth Reading
- `packages/core/src/team/team-concurrency.ts` — Existing sync `acquireFileLock` is kept untouched; new code uses `AsyncLock` (different concern: async fs serialization)
- `packages/core/src/team/team-manager.ts` / `team-manager-ai.ts` — Phase 1 doesn't change manager prompts

---

## Implementation Order

Tasks are ordered so each task ends with a green test suite. Build bottom-up: lock → workspace → tool → runtime integration → end-to-end.

1. **Async Lock** (utility, no deps)
2. **TeamWorkspace** (depends on lock)
3. **team_artifact Tool** (depends on workspace)
4. **TeamRuntime + TeamMember Integration** (depends on all above)
5. **Tools layer & archive_path** (final wiring)
6. **End-to-End Manual Verification**

---

### Task 1: Async Lock Utility

**Files:**
- Create: `packages/core/src/team/async-lock.ts`
- Create: `packages/core/src/__tests__/async-lock.test.ts`

**Why:** Multiple workers may write `.team/log.md` or `.team/contracts/X.md` (Phase 2) concurrently. The existing `TeamConcurrencyController.acquireFileLock` is sync (returns true/false immediately) — fine for tool-level write checks, but here we want callers to *await* until the lock is free. Different concern, different primitive.

- [ ] **Step 1: Write test**

```typescript
// packages/core/src/__tests__/async-lock.test.ts
import { describe, it, expect } from 'vitest'
import { AsyncLock } from '../team/async-lock.js'

describe('AsyncLock', () => {
  it('serializes operations on the same key', async () => {
    const lock = new AsyncLock()
    const order: number[] = []
    const op = (id: number, delay: number) =>
      lock.run('k', async () => {
        await new Promise(r => setTimeout(r, delay))
        order.push(id)
      })
    await Promise.all([op(1, 30), op(2, 10), op(3, 5)])
    expect(order).toEqual([1, 2, 3])
  })

  it('runs different keys in parallel', async () => {
    const lock = new AsyncLock()
    const start = Date.now()
    await Promise.all([
      lock.run('a', () => new Promise(r => setTimeout(r, 30))),
      lock.run('b', () => new Promise(r => setTimeout(r, 30))),
    ])
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(55)  // ~30ms parallel, not 60ms serial
  })

  it('releases the lock when the function throws', async () => {
    const lock = new AsyncLock()
    await expect(lock.run('k', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    let ran = false
    await lock.run('k', async () => { ran = true })
    expect(ran).toBe(true)
  })
})
```

- [ ] **Step 2: Implement**

```typescript
// packages/core/src/team/async-lock.ts
export class AsyncLock {
  private chains = new Map<string, Promise<unknown>>()

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve()
    let resolveNext!: () => void
    const next = new Promise<void>(r => { resolveNext = r })
    this.chains.set(key, prev.then(() => next))
    try {
      await prev
      return await fn()
    } finally {
      resolveNext()
      // Clean up if we're the tail
      if (this.chains.get(key) === prev.then(() => next)) {
        this.chains.delete(key)
      }
    }
  }
}
```

- [ ] **Step 3: Run tests**

```bash
cd packages/core && npx vitest run src/__tests__/async-lock.test.ts
```

All three tests must pass.

---

### Task 2: TeamWorkspace — Skeleton & Init

**Files:**
- Create: `packages/core/src/team/team-workspace.ts`
- Modify: `packages/core/src/team/team-types.ts`
- Create: `packages/core/src/__tests__/team-workspace.test.ts`
- Modify: `packages/core/package.json`

- [ ] **Step 1: Add `gray-matter` dependency**

```bash
cd packages/core && pnpm add gray-matter@^4.0.3
```

- [ ] **Step 2: Add frontmatter type definitions to `team-types.ts`**

Append to `packages/core/src/team/team-types.ts`:

```typescript
// ── Workspace frontmatter types ─────────────────────────────────────────

export interface TaskFrontmatter {
  id: string
  title: string
  status: TaskStatus
  assignee?: string
  depends_on?: string[]
  contracts?: string[]            // Phase 2 — populated only by Phase 2 code
  issues_open?: string[]          // Phase 3 — populated only by Phase 3 code
  created_at: string              // ISO 8601
  updated_at: string
}

export interface ResultFrontmatter {
  task_id: string
  completed_by: string
  completed_at: string
  summary: string
  artifacts: string[]
  contracts_produced?: string[]   // Phase 2
}

export interface ArtifactFrontmatter {
  id: string
  type: 'report' | 'code' | 'design' | 'decision' | 'data'
  created_by: string              // memberId
  on_task: string                 // taskId
  summary: string                 // REQUIRED — must be one sentence
  related_contracts?: string[]    // Phase 2
  created_at: string
}

export interface ArtifactSummary {
  id: string
  taskId: string
  type: string
  summary: string
  filePath: string                // relative to workspace root, e.g. tasks/T001/artifacts/M001-x.md
}
```

- [ ] **Step 3: Write test for `TeamWorkspace.init`**

```typescript
// packages/core/src/__tests__/team-workspace.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TeamWorkspace } from '../team/team-workspace.js'
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('TeamWorkspace', () => {
  let tmpDir: string
  let ws: TeamWorkspace

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `team-ws-test-${Date.now()}-${Math.random()}`)
    mkdirSync(tmpDir, { recursive: true })
    ws = new TeamWorkspace({ rootDir: tmpDir, teamId: 'team_abc' })
  })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('init creates the .team/ skeleton with objective.md, README.md, log.md', async () => {
    await ws.init('Build a chat app')
    expect(existsSync(path.join(tmpDir, '.team'))).toBe(true)
    expect(existsSync(path.join(tmpDir, '.team/contracts'))).toBe(true)
    expect(existsSync(path.join(tmpDir, '.team/issues'))).toBe(true)
    expect(existsSync(path.join(tmpDir, '.team/tasks'))).toBe(true)
    const objective = readFileSync(path.join(tmpDir, '.team/objective.md'), 'utf8')
    expect(objective).toContain('Build a chat app')
    expect(existsSync(path.join(tmpDir, '.team/README.md'))).toBe(true)
    expect(existsSync(path.join(tmpDir, '.team/log.md'))).toBe(true)
  })

  it('init archives a stale .team/ from a previous run before initializing', async () => {
    mkdirSync(path.join(tmpDir, '.team/tasks/T999'), { recursive: true })
    writeFileSync(path.join(tmpDir, '.team/tasks/T999/task.md'), 'stale')
    await ws.init('New objective')
    expect(existsSync(path.join(tmpDir, '.team/tasks/T999'))).toBe(false)
    // The stale .team/ should have been moved to .team-archive/<some-name>/
    const archives = require('node:fs').readdirSync(path.join(tmpDir, '.team-archive'))
    expect(archives.length).toBe(1)
    expect(existsSync(path.join(tmpDir, '.team-archive', archives[0], 'tasks/T999/task.md'))).toBe(true)
  })
})
```

- [ ] **Step 4: Implement `TeamWorkspace` skeleton (init only — write/read in Task 3)**

```typescript
// packages/core/src/team/team-workspace.ts
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { existsSync } from 'node:fs'
import matter from 'gray-matter'
import { AsyncLock } from './async-lock.js'
import type {
  TaskFrontmatter,
  ResultFrontmatter,
  ArtifactFrontmatter,
  ArtifactSummary,
  TaskStatus,
} from './team-types.js'

export interface TeamWorkspaceOptions {
  rootDir: string                 // workspace cwd
  teamId: string
  archiveDir?: string             // defaults to <rootDir>/.team-archive
}

export class TeamWorkspace {
  private rootDir: string
  private teamId: string
  private archiveBase: string
  private lock = new AsyncLock()

  constructor(opts: TeamWorkspaceOptions) {
    this.rootDir = opts.rootDir
    this.teamId = opts.teamId
    this.archiveBase = opts.archiveDir ?? path.join(opts.rootDir, '.team-archive')
  }

  // ── Path helpers ────────────────────────────────────────────────────
  get teamDir(): string { return path.join(this.rootDir, '.team') }
  taskDir(taskId: string): string { return path.join(this.teamDir, 'tasks', taskId) }
  taskFile(taskId: string): string { return path.join(this.taskDir(taskId), 'task.md') }
  resultFile(taskId: string): string { return path.join(this.taskDir(taskId), 'result.md') }
  artifactDir(taskId: string): string { return path.join(this.taskDir(taskId), 'artifacts') }
  artifactFile(taskId: string, artifactId: string): string {
    return path.join(this.artifactDir(taskId), `${artifactId}.md`)
  }
  contractFile(name: string): string {
    const safe = name.endsWith('.md') ? name : `${name}.md`
    return path.join(this.teamDir, 'contracts', safe)
  }
  issueFile(issueId: string): string {
    return path.join(this.teamDir, 'issues', `${issueId}.md`)
  }
  logFile(): string { return path.join(this.teamDir, 'log.md') }

  // ── Init / archive ──────────────────────────────────────────────────
  async init(objective: string): Promise<void> {
    // 1. If a stale .team/ exists (interrupted previous team), archive it first
    if (existsSync(this.teamDir)) {
      await this.archiveStale()
    }
    // 2. Create skeleton
    await fs.mkdir(path.join(this.teamDir, 'contracts'), { recursive: true })
    await fs.mkdir(path.join(this.teamDir, 'issues'), { recursive: true })
    await fs.mkdir(path.join(this.teamDir, 'tasks'), { recursive: true })
    // 3. Write seed files
    const now = new Date().toISOString()
    await fs.writeFile(
      path.join(this.teamDir, 'objective.md'),
      `# Team Objective\n\n${objective}\n\n_Created: ${now}_\n`,
      'utf8'
    )
    await fs.writeFile(
      path.join(this.teamDir, 'README.md'),
      `# Team Workspace (${this.teamId})\n\nObjective: ${objective}\n\nDirectory layout:\n` +
      `- contracts/ — locked contracts (Phase 2+)\n` +
      `- issues/    — QA-found issues (Phase 3+)\n` +
      `- tasks/T*/  — per-task workspace\n` +
      `- log.md     — append-only activity log\n` +
      `- objective.md — top-level goal\n`,
      'utf8'
    )
    await fs.writeFile(this.logFile(), `# Team Log (${this.teamId})\n\n`, 'utf8')
    await this.appendLog(`team_init "${objective.slice(0, 80)}"`)
  }

  private async archiveStale(): Promise<void> {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const archivePath = path.join(this.archiveBase, `stale-${ts}`)
    await fs.mkdir(this.archiveBase, { recursive: true })
    await fs.rename(this.teamDir, archivePath)
  }

  /** Move .team/ to .team-archive/<teamId>-<ts>/ — returns the archive path. */
  async archive(): Promise<string> {
    if (!existsSync(this.teamDir)) return ''
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const archivePath = path.join(this.archiveBase, `${this.teamId}-${ts}`)
    await fs.mkdir(this.archiveBase, { recursive: true })
    await fs.rename(this.teamDir, archivePath)
    return archivePath
  }

  // ── Append log (lock-protected) ─────────────────────────────────────
  async appendLog(line: string): Promise<void> {
    const ts = new Date().toISOString()
    await this.lock.run(this.logFile(), async () => {
      await fs.appendFile(this.logFile(), `- [${ts}] ${line}\n`, 'utf8')
    })
  }

  // ── Read / write task / result / artifact (Task 3) ──────────────────
  // (filled in next task)
}
```

- [ ] **Step 5: Run tests**

```bash
cd packages/core && npx vitest run src/__tests__/team-workspace.test.ts
```

Both `init` tests should pass.

---

### Task 3: TeamWorkspace — Read/Write Tasks, Results, Artifacts

**Files:**
- Modify: `packages/core/src/team/team-workspace.ts`
- Modify: `packages/core/src/__tests__/team-workspace.test.ts`

- [ ] **Step 1: Extend tests**

Append to `packages/core/src/__tests__/team-workspace.test.ts`:

```typescript
describe('TeamWorkspace IO', () => {
  let tmpDir: string
  let ws: TeamWorkspace

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `team-ws-io-${Date.now()}-${Math.random()}`)
    mkdirSync(tmpDir, { recursive: true })
    ws = new TeamWorkspace({ rootDir: tmpDir, teamId: 'team_io' })
    await ws.init('Test objective')
  })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('writeTask + readTask round-trip', async () => {
    await ws.writeTask('T001', {
      id: 'T001', title: 'Investigate', status: 'todo',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, 'Look into the auth flow.')
    const r = await ws.readTask('T001')
    expect(r.frontmatter.id).toBe('T001')
    expect(r.frontmatter.title).toBe('Investigate')
    expect(r.body.trim()).toBe('Look into the auth flow.')
  })

  it('writeArtifact + readArtifactSummaries returns frontmatter summary', async () => {
    await ws.writeTask('T001', {
      id: 'T001', title: 't', status: 'running',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, 'desc')
    await ws.writeArtifact('T001', 'M001-design', {
      id: 'M001-design', type: 'design', created_by: 'm1', on_task: 'T001',
      summary: 'Designed the user list response shape.',
      created_at: new Date().toISOString(),
    }, '## Details\n...')
    const summaries = await ws.readArtifactSummaries('T001')
    expect(summaries).toHaveLength(1)
    expect(summaries[0].summary).toBe('Designed the user list response shape.')
    expect(summaries[0].filePath).toBe('tasks/T001/artifacts/M001-design.md')
  })

  it('updateTaskStatus updates frontmatter in place', async () => {
    await ws.writeTask('T001', {
      id: 'T001', title: 't', status: 'todo',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, 'desc')
    await ws.updateTaskStatus('T001', 'completed')
    const r = await ws.readTask('T001')
    expect(r.frontmatter.status).toBe('completed')
  })

  it('writeResult writes result.md with frontmatter', async () => {
    await ws.writeTask('T001', {
      id: 'T001', title: 't', status: 'completed',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, 'desc')
    await ws.writeResult('T001', {
      task_id: 'T001', completed_by: 'm1',
      completed_at: new Date().toISOString(),
      summary: 'Done.',
      artifacts: ['M001-design'],
    }, '## Result\n\nAll good.')
    const text = readFileSync(path.join(tmpDir, '.team/tasks/T001/result.md'), 'utf8')
    expect(text).toContain('summary: Done.')
    expect(text).toContain('All good.')
  })

  it('readArtifactSummaries returns [] when artifact dir does not exist', async () => {
    await ws.writeTask('T999', {
      id: 'T999', title: 't', status: 'todo',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, 'desc')
    const summaries = await ws.readArtifactSummaries('T999')
    expect(summaries).toEqual([])
  })
})
```

- [ ] **Step 2: Implement IO methods on `TeamWorkspace`**

Add to `packages/core/src/team/team-workspace.ts` (replace the "filled in next task" comment):

```typescript
  // ── Read / write tasks ──────────────────────────────────────────────
  async writeTask(taskId: string, fm: TaskFrontmatter, body: string): Promise<void> {
    await fs.mkdir(this.taskDir(taskId), { recursive: true })
    await this.lock.run(this.taskFile(taskId), async () => {
      const content = matter.stringify(body, fm as any)
      await fs.writeFile(this.taskFile(taskId), content, 'utf8')
    })
  }

  async readTask(taskId: string): Promise<{ frontmatter: TaskFrontmatter; body: string }> {
    const raw = await fs.readFile(this.taskFile(taskId), 'utf8')
    const parsed = matter(raw)
    return { frontmatter: parsed.data as TaskFrontmatter, body: parsed.content }
  }

  async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    await this.lock.run(this.taskFile(taskId), async () => {
      const raw = await fs.readFile(this.taskFile(taskId), 'utf8')
      const parsed = matter(raw)
      const fm = parsed.data as TaskFrontmatter
      fm.status = status
      fm.updated_at = new Date().toISOString()
      const content = matter.stringify(parsed.content, fm as any)
      await fs.writeFile(this.taskFile(taskId), content, 'utf8')
    })
  }

  // ── Result ──────────────────────────────────────────────────────────
  async writeResult(taskId: string, fm: ResultFrontmatter, body: string): Promise<void> {
    await fs.mkdir(this.taskDir(taskId), { recursive: true })
    await this.lock.run(this.resultFile(taskId), async () => {
      const content = matter.stringify(body, fm as any)
      await fs.writeFile(this.resultFile(taskId), content, 'utf8')
    })
  }

  // ── Artifacts ───────────────────────────────────────────────────────
  async writeArtifact(taskId: string, artifactId: string, fm: ArtifactFrontmatter, body: string): Promise<void> {
    await fs.mkdir(this.artifactDir(taskId), { recursive: true })
    if (!fm.summary || fm.summary.trim().length === 0) {
      throw new Error(`Artifact ${artifactId} missing required 'summary' frontmatter`)
    }
    await this.lock.run(this.artifactFile(taskId, artifactId), async () => {
      const content = matter.stringify(body, fm as any)
      await fs.writeFile(this.artifactFile(taskId, artifactId), content, 'utf8')
    })
  }

  async readArtifactSummaries(taskId: string): Promise<ArtifactSummary[]> {
    const dir = this.artifactDir(taskId)
    if (!existsSync(dir)) return []
    const files = await fs.readdir(dir)
    const out: ArtifactSummary[] = []
    for (const f of files) {
      if (!f.endsWith('.md')) continue
      try {
        const raw = await fs.readFile(path.join(dir, f), 'utf8')
        const parsed = matter(raw)
        const fm = parsed.data as ArtifactFrontmatter
        out.push({
          id: fm.id ?? f.replace(/\.md$/, ''),
          taskId,
          type: fm.type ?? 'report',
          summary: fm.summary ?? '(no summary)',
          filePath: path.posix.join('tasks', taskId, 'artifacts', f),
        })
      } catch {
        // Skip unreadable files
      }
    }
    return out
  }
```

- [ ] **Step 3: Run tests**

```bash
cd packages/core && npx vitest run src/__tests__/team-workspace.test.ts
```

All IO tests must pass.

---

### Task 4: `team_artifact` Tool

**Files:**
- Create: `packages/core/src/tools/team-artifact.ts`
- Create: `packages/core/src/__tests__/team-artifact-tool.test.ts`

- [ ] **Step 1: Write test**

```typescript
// packages/core/src/__tests__/team-artifact-tool.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { TeamWorkspace } from '../team/team-workspace.js'
import { createTeamArtifactTool } from '../tools/team-artifact.js'

describe('team_artifact tool', () => {
  let tmpDir: string
  let ws: TeamWorkspace
  let tool: ReturnType<typeof createTeamArtifactTool>

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `team-art-${Date.now()}-${Math.random()}`)
    mkdirSync(tmpDir, { recursive: true })
    ws = new TeamWorkspace({ rootDir: tmpDir, teamId: 'team_t' })
    await ws.init('obj')
    await ws.writeTask('T001', {
      id: 'T001', title: 't', status: 'running',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }, 'desc')
    tool = createTeamArtifactTool({
      memberId: 'member_x', taskId: 'T001', workspace: ws,
    })
  })
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

  it('create_artifact writes a file with frontmatter', async () => {
    const result = await tool.execute({
      action: 'create_artifact',
      type: 'report',
      summary: 'Found 3 issues with auth.',
      content: '## Findings\n- foo\n- bar',
    }, {} as any)
    expect(result.isError).toBeFalsy()
    const summaries = await ws.readArtifactSummaries('T001')
    expect(summaries).toHaveLength(1)
    expect(summaries[0].summary).toBe('Found 3 issues with auth.')
  })

  it('create_artifact rejects when summary is missing', async () => {
    const result = await tool.execute({
      action: 'create_artifact', type: 'report', content: 'x',
    }, {} as any)
    expect(result.isError).toBe(true)
    expect(result.content).toMatch(/summary/i)
  })

  it('update_status changes a task status and writes result.md', async () => {
    const r = await tool.execute({
      action: 'update_status',
      target_id: 'T001',
      new_status: 'completed',
      summary: 'All done.',
    }, {} as any)
    expect(r.isError).toBeFalsy()
    const t = await ws.readTask('T001')
    expect(t.frontmatter.status).toBe('completed')
    expect(existsSync(path.join(tmpDir, '.team/tasks/T001/result.md'))).toBe(true)
    const result = readFileSync(path.join(tmpDir, '.team/tasks/T001/result.md'), 'utf8')
    expect(result).toContain('summary: All done.')
  })

  it('rejects Phase 2/3 actions with a clear error', async () => {
    const r1 = await tool.execute({ action: 'create_contract' }, {} as any)
    expect(r1.isError).toBe(true)
    expect(r1.content).toMatch(/not yet/i)
    const r2 = await tool.execute({ action: 'create_issue' }, {} as any)
    expect(r2.isError).toBe(true)
  })
})
```

- [ ] **Step 2: Implement tool**

```typescript
// packages/core/src/tools/team-artifact.ts
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { TeamWorkspace } from '../team/team-workspace.js'
import type { ArtifactFrontmatter, ResultFrontmatter, TaskStatus } from '../team/team-types.js'

export interface TeamArtifactDeps {
  memberId: string
  taskId?: string
  workspace: TeamWorkspace
}

export function createTeamArtifactTool(deps: TeamArtifactDeps): ToolHandler {
  return {
    definition: {
      name: 'team_artifact',
      description:
        'Persist your work to the team workspace (.team/). ' +
        'Use create_artifact to save a finding/report/code snippet (summary REQUIRED — one sentence). ' +
        'Use update_status to mark your task completed and write the final result.md. ' +
        'Files are visible to downstream tasks via PM context injection.',
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['create_artifact', 'update_status', 'create_contract', 'create_issue'],
            description: 'Phase 1 supports create_artifact and update_status only.',
          },
          // create_artifact
          artifact_id: { type: 'string', description: 'Optional, defaults to <memberId>-<topic>' },
          type: { type: 'string', enum: ['report', 'code', 'design', 'decision', 'data'] },
          summary: { type: 'string', description: 'One-sentence summary (REQUIRED for create_artifact)' },
          content: { type: 'string', description: 'Markdown body' },
          // update_status
          target_id: { type: 'string', description: 'e.g. T001 — taskId to update' },
          new_status: { type: 'string', enum: ['todo', 'assigned', 'running', 'completed', 'failed', 'blocked', 'cancelled'] },
          // optional task_id override (defaults to deps.taskId)
          task_id: { type: 'string' },
        },
        required: ['action'],
      },
    },
    async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
      const action = input.action as string
      const taskId = (input.task_id as string) ?? deps.taskId

      try {
        switch (action) {
          case 'create_artifact': {
            if (!taskId) return { content: 'Error: no task_id available (worker not assigned to a task)', isError: true }
            const summary = (input.summary as string ?? '').trim()
            if (!summary) return { content: "Error: 'summary' is required for create_artifact (one sentence describing the artifact)", isError: true }
            const type = (input.type as ArtifactFrontmatter['type']) ?? 'report'
            const aid = (input.artifact_id as string) ?? `${deps.memberId}-${Date.now().toString(36)}`
            const fm: ArtifactFrontmatter = {
              id: aid, type, created_by: deps.memberId, on_task: taskId,
              summary, created_at: new Date().toISOString(),
            }
            await deps.workspace.writeArtifact(taskId, aid, fm, (input.content as string) ?? '')
            await deps.workspace.appendLog(`artifact ${aid} by ${deps.memberId} on ${taskId}: ${summary}`)
            return { content: `Artifact saved: tasks/${taskId}/artifacts/${aid}.md` }
          }

          case 'update_status': {
            const target = (input.target_id as string) ?? taskId
            const newStatus = input.new_status as TaskStatus
            if (!target || !newStatus) {
              return { content: 'Error: update_status requires target_id and new_status', isError: true }
            }
            await deps.workspace.updateTaskStatus(target, newStatus)
            // If completing, also write result.md
            if (newStatus === 'completed') {
              const summary = (input.summary as string ?? '').trim() || 'Task completed.'
              const summaries = await deps.workspace.readArtifactSummaries(target)
              const resultFm: ResultFrontmatter = {
                task_id: target, completed_by: deps.memberId,
                completed_at: new Date().toISOString(),
                summary, artifacts: summaries.map(s => s.id),
              }
              await deps.workspace.writeResult(target, resultFm, `## Result\n\n${summary}\n`)
            }
            await deps.workspace.appendLog(`status ${target} -> ${newStatus} by ${deps.memberId}`)
            return { content: `Status updated: ${target} -> ${newStatus}` }
          }

          case 'create_contract':
          case 'create_issue':
            return { content: `Error: action '${action}' is not yet supported (Phase 2/3 feature)`, isError: true }

          default:
            return { content: `Error: unknown action '${action}'`, isError: true }
        }
      } catch (err) {
        return { content: `team_artifact error: ${err instanceof Error ? err.message : String(err)}`, isError: true }
      }
    },
  }
}
```

- [ ] **Step 3: Run tests**

```bash
cd packages/core && npx vitest run src/__tests__/team-artifact-tool.test.ts
```

All four tests must pass.

---

### Task 5: TeamRuntime — Workspace Wiring & Async assignTask

**Files:**
- Modify: `packages/core/src/team/team-runtime.ts`
- Modify: `packages/core/src/team/team-member.ts`

**Goal:** Construct `TeamWorkspace` in TeamRuntime; init it before `start()`; archive on `completeTeam`; wire async `assignTask` to inject upstream artifact summaries; pass `workspace` + `taskId` to `TeamMember` so the tool can be injected.

- [ ] **Step 1: Add `workspace` + `taskId` options to TeamMember**

In `packages/core/src/team/team-member.ts`:

```typescript
import type { TeamWorkspace } from './team-workspace.js'
import { createTeamArtifactTool } from '../tools/team-artifact.js'

export interface TeamMemberOptions {
  // ...existing fields
  workspace?: TeamWorkspace            // ← NEW
  // taskId already exists
}
```

In `TeamMember.run()`, where `extraTools` is built, append:

```typescript
if (this.opts.workspace && this.opts.taskId) {
  const artifactTool = createTeamArtifactTool({
    memberId: this.id,
    taskId: this.opts.taskId,
    workspace: this.opts.workspace,
  })
  extraTools.push({
    definition: artifactTool.definition as any,
    execute: artifactTool.execute as any,
  })
}
```

- [ ] **Step 2: Wire `TeamWorkspace` into TeamRuntime constructor**

In `packages/core/src/team/team-runtime.ts`, top of file:

```typescript
import { TeamWorkspace } from './team-workspace.js'
```

Add to `TeamRuntimeOptions`:

```typescript
archivePath?: string
```

In the class:

```typescript
private workspace: TeamWorkspace
```

In the constructor, after `this.opts = opts`:

```typescript
this.workspace = new TeamWorkspace({
  rootDir: opts.subSessionDeps.cwd,
  teamId: this.id,
  archiveDir: opts.archivePath,
})
```

- [ ] **Step 3: Make `start()` async and init workspace + seed task files**

```typescript
async start(): Promise<void> {
  await this.workspace.init(this.objective)
  // Seed task.md for each initial task
  const tasks = this.manager.getTasks()
  for (const task of tasks) {
    await this.workspace.writeTask(task.id, {
      id: task.id,
      title: task.title,
      status: task.status,
      depends_on: task.dependsOn,
      created_at: new Date(task.createdAt).toISOString(),
      updated_at: new Date(task.updatedAt).toISOString(),
    }, task.description)
  }

  this.status = 'running'
  this.recordEvent({ type: 'team_started', teamId: this.id, timestamp: Date.now() })

  const teamTimeoutMs = this.opts.teamTimeoutMs ?? 30 * 60 * 1000
  this.teamTimeout = setTimeout(() => {
    if (!this.completed) {
      this.recordEvent({ type: 'team_failed', error: `Team timed out after ${teamTimeoutMs / 1000}s`, timestamp: Date.now() })
      this.stop()
      this.opts.onFail?.(`Team timed out after ${teamTimeoutMs / 1000}s`)
    }
  }, teamTimeoutMs)

  this.scheduleTick()
}
```

⚠️ Caller of `start()` (currently `team.ts` tool) needs update — see Task 6.

- [ ] **Step 4: Make `assignTask` async, inject upstream artifacts**

Replace the existing `private assignTask(taskId, memberId): void` with:

```typescript
private async assignTask(taskId: string, memberId: string): Promise<void> {
  const task = this.manager.getTask(taskId)
  const member = this.memberById.get(memberId)
  if (!task || !member) return

  this.manager.markTaskAssigned(taskId, memberId)
  this.manager.markTaskRunning(taskId)
  this.concurrency.markRunning(memberId, member.agentType)
  await this.workspace.updateTaskStatus(taskId, 'running').catch(() => {})

  // Collect upstream artifact summaries (from depends_on tasks)
  const upstream: Array<{ filePath: string; summary: string }> = []
  for (const upTaskId of task.dependsOn ?? []) {
    try {
      const summaries = await this.workspace.readArtifactSummaries(upTaskId)
      for (const s of summaries) {
        upstream.push({ filePath: s.filePath, summary: s.summary })
      }
      // also include result.md summary if present
      const resultPath = this.workspace.resultFile(upTaskId)
      const fs = await import('node:fs')
      if (fs.existsSync(resultPath)) {
        const matter = (await import('gray-matter')).default
        const raw = await fs.promises.readFile(resultPath, 'utf8')
        const parsed = matter(raw)
        const fm = parsed.data as { summary?: string }
        if (fm.summary) {
          upstream.push({
            filePath: `tasks/${upTaskId}/result.md`,
            summary: fm.summary,
          })
        }
      }
    } catch { /* tolerate missing */ }
  }

  const upstreamBlock = upstream.length > 0
    ? `\n\n📎 RELATED ARTIFACTS (上游产物 - 摘要,详情用 Read 查看):\n\n` +
      upstream.map(a => `- .team/${a.filePath}\n  Summary: ${a.summary}`).join('\n')
    : ''

  const memberSpec = { role: member.role, agentType: member.agentType, modelId: member.modelId }
  const taskPrompt =
    `TASK: ${task.id} - ${task.title}\n\n` +
    `DESCRIPTION:\n${task.description}` +
    upstreamBlock +
    `\n\n📂 OUTPUTS:\n` +
    `- Save your work to .team/tasks/${task.id}/artifacts/<id>.md via team_artifact action=create_artifact\n` +
    `- When done, call team_artifact action=update_status target_id=${task.id} new_status=completed summary=<one sentence>\n`

  const taskMember = new TeamMember({
    spec: memberSpec,
    taskPrompt,
    taskId,
    id: memberId,
    existingMailbox: member.getMailbox(),
    teamMailbox: { push: (msg: any) => this.sendMessage(msg) },
    workspace: this.workspace,
    subSessionDeps: this.opts.subSessionDeps,
    onEvent: (e) => this.recordEvent(e),
    onComplete: (_mId, result) => {
      this.clearTaskTimeout(taskId)
      this.manager.markTaskCompleted(taskId, result)
      this.concurrency.markDone(memberId)
      // Fallback: if worker didn't call update_status, write a minimal result.md
      this.fallbackWriteResult(taskId, memberId, result.summary).catch(() => {})
      this.recycleMember(memberId, memberSpec)
      this.triggerProactive('task_completed')
      this.scheduleTick()
    },
    onFail: (_mId, error) => {
      this.clearTaskTimeout(taskId)
      this.manager.markTaskFailed(taskId, error)
      this.concurrency.markDone(memberId)
      this.workspace.updateTaskStatus(taskId, 'failed').catch(() => {})
      this.recycleMember(memberId, memberSpec)
      this.triggerProactive('task_failed')
      this.scheduleTick()
    },
  })
  this.memberById.set(memberId, taskMember)
  const idx = this.members.findIndex(m => m.id === memberId)
  if (idx >= 0) this.members[idx] = taskMember

  const taskTimeoutMs = this.opts.taskTimeoutMs ?? 10 * 60 * 1000
  const timeout = setTimeout(() => {
    if (taskMember.getStatus() === 'running') {
      taskMember.abort()
      this.manager.markTaskFailed(taskId, `Task timed out after ${taskTimeoutMs / 1000}s`)
      this.concurrency.markDone(memberId)
      this.workspace.updateTaskStatus(taskId, 'failed').catch(() => {})
      this.recycleMember(memberId, memberSpec)
      this.recordEvent({ type: 'task_cancelled', taskId, reason: 'timeout', timestamp: Date.now() })
      this.scheduleTick()
    }
  }, taskTimeoutMs)
  this.taskTimeouts.set(taskId, timeout)

  taskMember.start().catch(() => {})
}

private async fallbackWriteResult(taskId: string, memberId: string, summary: string): Promise<void> {
  const fs = await import('node:fs')
  if (fs.existsSync(this.workspace.resultFile(taskId))) return  // worker already wrote it
  const summaries = await this.workspace.readArtifactSummaries(taskId).catch(() => [])
  await this.workspace.writeResult(taskId, {
    task_id: taskId,
    completed_by: memberId,
    completed_at: new Date().toISOString(),
    summary: (summary ?? '').slice(0, 500) || 'Task completed (no summary provided).',
    artifacts: summaries.map(s => s.id),
  }, `## Result\n\n${summary ?? '(no detail)'}\n`)
  await this.workspace.updateTaskStatus(taskId, 'completed').catch(() => {})
}
```

- [ ] **Step 5: Update `executeActions` to fire-and-forget assignTask**

In `executeActions`:

```typescript
case 'assign_task':
  if (action.taskId && action.memberId) {
    this.assignTask(action.taskId, action.memberId).catch(err => {
      this.recordEvent({
        type: 'manager_decision',
        text: `assignTask failed for ${action.taskId}: ${err instanceof Error ? err.message : String(err)}`,
        timestamp: Date.now(),
      })
    })
  }
  break
```

- [ ] **Step 6: Archive on `completeTeam`**

```typescript
private completeTeam(summary: string): void {
  if (this.completed) return
  this.completed = true
  if (this.teamTimeout) clearTimeout(this.teamTimeout)
  for (const [, timeout] of this.taskTimeouts) clearTimeout(timeout)
  this.taskTimeouts.clear()
  this.status = 'completed'
  this.recordEvent({ type: 'team_synthesizing', timestamp: Date.now() })
  // Archive workspace (don't block completion if archive fails)
  this.workspace.archive()
    .then(archivePath => {
      const finalSummary = archivePath ? `${summary}\n\nArchived to: ${archivePath}` : summary
      this.recordEvent({ type: 'team_completed', summary: finalSummary, timestamp: Date.now() })
      this.opts.onComplete?.(finalSummary)
    })
    .catch(err => {
      this.recordEvent({ type: 'team_completed', summary: `${summary}\n\n(archive failed: ${err.message})`, timestamp: Date.now() })
      this.opts.onComplete?.(summary)
    })
}
```

Also update the `team-failed` path in `start()`'s timeout to skip the archive step but log:

(Already handled — failure goes through `onFail` not `completeTeam`.)

- [ ] **Step 7: Type-check the package**

```bash
cd packages/core && npx tsc --noEmit
```

Expect zero errors. If `start()` callers complain about `Promise<void>`, that's expected — fixed in Task 6.

---

### Task 6: `team` Tool — Async Start & archive_path

**Files:**
- Modify: `packages/core/src/tools/team.ts`

- [ ] **Step 1: Add `archive_path` to input schema**

In the `inputSchema.properties`:

```typescript
archive_path: {
  type: 'string',
  description: 'Optional: where to put archived workspaces (default: <cwd>/.team-archive)',
},
```

- [ ] **Step 2: Forward to runtime, await start()**

In the `execute` function, replace `team.start()` with `await team.start()` and pass `archivePath`:

```typescript
const team = new TeamRuntime({
  id: bgTask.id,
  objective,
  plan,
  archivePath: input.archive_path as string | undefined,
  subSessionDeps: deps.buildSubSessionDeps(),
  // ...rest unchanged
})

deps.teamRegistry.register(team)
await team.start()  // ← was team.start()
```

The wrapping `execute` is already async, so this is safe.

- [ ] **Step 3: Type-check**

```bash
cd packages/core && npx tsc --noEmit
```

Zero errors.

---

### Task 7: End-to-End Smoke Test (Manual)

**Goal:** Spin up the desktop app, create a small 2-task team, verify the workspace files appear and downstream prompt receives upstream summary.

- [ ] **Step 1: Start dev server**

```bash
cd /Users/chenmingxu/Documents/jdcagnet && pnpm run dev
```

- [ ] **Step 2: Create a test team**

In the chat, send a Team prompt that creates a 2-task chain with `dependsOn`:

```
开个团队,做两件事:
- T001: 调研 packages/core/src/team/ 目录,产出一份"模块职责总结"报告。
- T002: 基于 T001 的报告,产出一份"潜在改进建议"清单。要 depends_on T001。
```

- [ ] **Step 3: Inspect `.team/` while running**

In another terminal:

```bash
ls -la /Users/chenmingxu/Documents/jdcagnet/.team/
cat /Users/chenmingxu/Documents/jdcagnet/.team/objective.md
cat /Users/chenmingxu/Documents/jdcagnet/.team/log.md
ls /Users/chenmingxu/Documents/jdcagnet/.team/tasks/
```

Expect:
- `.team/` exists with `contracts/`, `issues/`, `tasks/`, `README.md`, `objective.md`, `log.md`
- T001 (and possibly T002 once assigned) directories under `tasks/`
- `log.md` shows `team_init`, `status`, `artifact` lines

- [ ] **Step 4: Verify T001 produces an artifact**

When T001 worker finishes, check:

```bash
cat /Users/chenmingxu/Documents/jdcagnet/.team/tasks/T001/result.md
ls /Users/chenmingxu/Documents/jdcagnet/.team/tasks/T001/artifacts/
```

`result.md` should have frontmatter with `summary: ...`. There should be at least one artifact file (or the fallback result.md if the worker forgot to call create_artifact).

- [ ] **Step 5: Verify T002 prompt sees upstream summary**

In the JDC CODE Inspector → Team panel → Events tab, find T002's `member_progress` events. The first text chunk should reference T001's summary OR the team_artifact log should show it. Alternatively, instrument by reading the `event.toolName === 'Read'` calls — T002 should be Reading `.team/tasks/T001/result.md` if PM injected the path correctly.

The success criterion: T002 worker should NOT need to re-explore the codebase — it should consume T001's output via the prompt.

- [ ] **Step 6: Verify archive on completion**

After team completes:

```bash
ls /Users/chenmingxu/Documents/jdcagnet/.team/ 2>/dev/null
ls /Users/chenmingxu/Documents/jdcagnet/.team-archive/
```

`.team/` should be gone. `.team-archive/` should contain a directory `<team-id>-<ts>/` with the full structure inside.

- [ ] **Step 7: Verify .gitignore**

Check that `.team/` and `.team-archive/` are not tracked:

```bash
cd /Users/chenmingxu/Documents/jdcagnet && git status
```

If they appear, add to `.gitignore`:

```
.team/
.team-archive/
```

(Spec says these default to gitignored. If `.gitignore` already excludes broader patterns covering them, nothing to do.)

---

### Task 8: Vitest Regression

**Goal:** Make sure no existing test broke from the runtime/member changes.

- [ ] **Step 1: Run full core test suite**

```bash
cd packages/core && npx vitest run
```

All previously-green tests must still pass. If any team-related test fails because of the async `start()`, update the test to `await runtime.start()`.

- [ ] **Step 2: Build the whole monorepo**

```bash
cd /Users/chenmingxu/Documents/jdcagnet && pnpm -r build
```

Zero TypeScript errors expected.

---

## Acceptance for Phase 1

All of the following must be true to mark Phase 1 done:

1. ✅ All new tests pass (async-lock, team-workspace, team-artifact-tool)
2. ✅ Existing core tests still green
3. ✅ Manual smoke test (Task 7) succeeds: T002 prompt contains a `RELATED ARTIFACTS` block listing T001's summary
4. ✅ On team completion, `.team/` is moved into `.team-archive/<team-id>-<ts>/`
5. ✅ Stale `.team/` from a crashed run is auto-archived on next team `init`
6. ✅ `team_artifact` rejects `create_contract` and `create_issue` with a "Phase 2/3" error message
7. ✅ Worker that forgot to call `update_status` still gets a fallback `result.md` written by runtime

## Rollback

If Phase 1 introduces production issues, the rollback path is clean: `team_artifact` is opt-in (worker only sees it if `workspace` is passed); revert `assignTask` to sync version; remove `start()` await in `team.ts`. No DB or schema changes to undo.

## After Phase 1

Phase 2 (Contracts) plan should land at `docs/superpowers/plans/2026-XX-XX-team-workspace-phase2-contracts.md`.
