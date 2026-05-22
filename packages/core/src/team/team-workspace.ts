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
  ContractFrontmatter,
  ContractSummary,
  IssueFrontmatter,
  IssueStatus,
  TaskStatus,
} from './team-types.js'

export interface TeamWorkspaceOptions {
  rootDir: string                 // workspace cwd
  teamId: string
  archiveDir?: string             // defaults to <rootDir>/.team-archive
}

/** Strip undefined values so gray-matter (js-yaml) doesn't choke on them. */
function clean<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out as T
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
    if (existsSync(this.teamDir)) {
      await this.archiveStale()
    }
    await fs.mkdir(path.join(this.teamDir, 'contracts'), { recursive: true })
    await fs.mkdir(path.join(this.teamDir, 'issues'), { recursive: true })
    await fs.mkdir(path.join(this.teamDir, 'tasks'), { recursive: true })

    const now = new Date().toISOString()
    await fs.writeFile(
      path.join(this.teamDir, 'objective.md'),
      `# Team Objective\n\n${objective}\n\n_Created: ${now}_\n`,
      'utf8',
    )
    await fs.writeFile(
      path.join(this.teamDir, 'README.md'),
      `# Team Workspace (${this.teamId})\n\nObjective: ${objective}\n\nDirectory layout:\n` +
        `- contracts/ — locked contracts (Phase 2+)\n` +
        `- issues/    — QA-found issues (Phase 3+)\n` +
        `- tasks/T*/  — per-task workspace\n` +
        `- log.md     — append-only activity log\n` +
        `- objective.md — top-level goal\n`,
      'utf8',
    )
    await fs.writeFile(this.logFile(), `# Team Log (${this.teamId})\n\n`, 'utf8')
    await this.appendLog(`team_init "${objective.slice(0, 80)}"`)
  }

  private async archiveStale(): Promise<void> {
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const archivePath = path.join(this.archiveBase, `stale-${ts}`)
    await fs.mkdir(this.archiveBase, { recursive: true })
    try {
      await fs.rename(this.teamDir, archivePath)
    } catch (err: any) {
      // Tolerate races: another caller may have moved/removed it first
      if (err?.code !== 'ENOENT') throw err
    }
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

  // ── Read / write tasks ──────────────────────────────────────────────
  async writeTask(taskId: string, fm: TaskFrontmatter, body: string): Promise<void> {
    await fs.mkdir(this.taskDir(taskId), { recursive: true })
    await this.lock.run(this.taskFile(taskId), async () => {
      const content = matter.stringify(body, clean(fm) as any)
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
      const content = matter.stringify(parsed.content, clean(fm) as any)
      await fs.writeFile(this.taskFile(taskId), content, 'utf8')
    })
  }

  // ── Result ──────────────────────────────────────────────────────────
  async writeResult(taskId: string, fm: ResultFrontmatter, body: string): Promise<void> {
    await fs.mkdir(this.taskDir(taskId), { recursive: true })
    await this.lock.run(this.resultFile(taskId), async () => {
      const content = matter.stringify(body, clean(fm) as any)
      await fs.writeFile(this.resultFile(taskId), content, 'utf8')
    })
  }

  // ── Artifacts ───────────────────────────────────────────────────────
  async writeArtifact(
    taskId: string,
    artifactId: string,
    fm: ArtifactFrontmatter,
    body: string,
  ): Promise<void> {
    await fs.mkdir(this.artifactDir(taskId), { recursive: true })
    if (!fm.summary || fm.summary.trim().length === 0) {
      throw new Error(`Artifact ${artifactId} missing required 'summary' frontmatter`)
    }
    await this.lock.run(this.artifactFile(taskId, artifactId), async () => {
      const content = matter.stringify(body, clean(fm) as any)
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
        // skip unreadable files
      }
    }
    return out
  }

  // ── Contracts ───────────────────────────────────────────────────────
  async writeContract(name: string, fm: ContractFrontmatter, body: string): Promise<void> {
    const file = this.contractFile(name)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await this.lock.run(file, async () => {
      const content = matter.stringify(body, clean(fm) as any)
      await fs.writeFile(file, content, 'utf8')
    })
  }

  async readContract(name: string): Promise<{ frontmatter: ContractFrontmatter; body: string } | null> {
    const file = this.contractFile(name)
    if (!existsSync(file)) return null
    const raw = await fs.readFile(file, 'utf8')
    const parsed = matter(raw)
    return { frontmatter: parsed.data as ContractFrontmatter, body: parsed.content }
  }

  async readContractRaw(name: string): Promise<string | null> {
    const file = this.contractFile(name)
    if (!existsSync(file)) return null
    return fs.readFile(file, 'utf8')
  }

  async listContracts(): Promise<ContractSummary[]> {
    const dir = path.join(this.teamDir, 'contracts')
    if (!existsSync(dir)) return []
    const files = await fs.readdir(dir)
    const out: ContractSummary[] = []
    for (const f of files) {
      if (!f.endsWith('.md')) continue
      try {
        const raw = await fs.readFile(path.join(dir, f), 'utf8')
        const parsed = matter(raw)
        const fm = parsed.data as ContractFrontmatter
        out.push({
          name: fm.name ?? f.replace(/\.md$/, ''),
          version: fm.version ?? 1,
          filePath: path.posix.join('contracts', f),
        })
      } catch {
        // skip
      }
    }
    return out
  }

  // ── Issues ──────────────────────────────────────────────────────────
  async writeIssue(issueId: string, fm: IssueFrontmatter, body: string): Promise<void> {
    const file = this.issueFile(issueId)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await this.lock.run(file, async () => {
      const content = matter.stringify(body, clean(fm) as any)
      await fs.writeFile(file, content, 'utf8')
    })
  }

  async readIssue(issueId: string): Promise<{ frontmatter: IssueFrontmatter; body: string } | null> {
    const file = this.issueFile(issueId)
    if (!existsSync(file)) return null
    const raw = await fs.readFile(file, 'utf8')
    const parsed = matter(raw)
    return { frontmatter: parsed.data as IssueFrontmatter, body: parsed.content }
  }

  async listIssues(filter?: { status?: IssueStatus; on_task?: string }): Promise<IssueFrontmatter[]> {
    const dir = path.join(this.teamDir, 'issues')
    if (!existsSync(dir)) return []
    const files = await fs.readdir(dir)
    const out: IssueFrontmatter[] = []
    for (const f of files) {
      if (!f.endsWith('.md')) continue
      try {
        const raw = await fs.readFile(path.join(dir, f), 'utf8')
        const parsed = matter(raw)
        const fm = parsed.data as IssueFrontmatter
        if (filter?.status && fm.status !== filter.status) continue
        if (filter?.on_task && fm.on_task !== filter.on_task) continue
        out.push(fm)
      } catch {
        // skip
      }
    }
    return out
  }

  /** Auto-allocate the next ISSUE-N id by scanning the issues dir. */
  async nextIssueId(): Promise<string> {
    const dir = path.join(this.teamDir, 'issues')
    if (!existsSync(dir)) return 'ISSUE-001'
    const files = await fs.readdir(dir)
    let max = 0
    for (const f of files) {
      const m = f.match(/^ISSUE-(\d+)\.md$/)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
    return `ISSUE-${String(max + 1).padStart(3, '0')}`
  }

  async updateIssueStatus(issueId: string, status: IssueStatus, resolution?: string): Promise<void> {
    const file = this.issueFile(issueId)
    await this.lock.run(file, async () => {
      const raw = await fs.readFile(file, 'utf8')
      const parsed = matter(raw)
      const fm = parsed.data as IssueFrontmatter
      fm.status = status
      if (status === 'resolved') fm.resolved_at = new Date().toISOString()
      let body = parsed.content
      if (resolution && resolution.trim().length > 0) {
        body += `\n\n## Resolution (${new Date().toISOString()})\n\n${resolution.trim()}\n`
      }
      const content = matter.stringify(body, clean(fm) as any)
      await fs.writeFile(file, content, 'utf8')
    })
  }
}
