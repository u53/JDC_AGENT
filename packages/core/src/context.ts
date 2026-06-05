// packages/core/src/context.ts
import { readFile, readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import { getBasePrompt } from './base-prompt.js'
import type { ToolDefinition, PromptSegment } from './types.js'

const execFileAsync = promisify(execFile)
const CONFIG_DIR = path.join(os.homedir(), '.jdcagnet')

export interface ContextOptions {
  cwd: string
  toolDefs: ToolDefinition[]
  toolNames: string[]
  mcpServers?: { name: string; toolCount: number; tools?: string[]; instructions?: string }[]
  permissionMode?: string
  skills?: { name: string; description: string; argumentHint?: string; trigger?: string }[]
  language?: string
  customInstructions?: string
}

export interface InstructionSource {
  ref: string
  content: string
  scope: 'global' | 'project' | 'rule'
}

async function readInstructionCandidate(candidate: { ref: string; fullPath: string; scope: InstructionSource['scope'] }): Promise<InstructionSource | null> {
  try {
    return { ref: candidate.ref, content: await readFile(candidate.fullPath, 'utf-8'), scope: candidate.scope }
  } catch {
    return null
  }
}

export async function loadInstructionSources(cwd: string): Promise<InstructionSource[]> {
  const sources: InstructionSource[] = []

  for (const candidate of [
    { ref: '~/.jdcagnet/JDCAGNET.md', fullPath: path.join(CONFIG_DIR, 'JDCAGNET.md'), scope: 'global' as const },
    { ref: '~/.claude/CLAUDE.md', fullPath: path.join(os.homedir(), '.claude', 'CLAUDE.md'), scope: 'global' as const },
  ]) {
    const source = await readInstructionCandidate(candidate)
    if (source) {
      sources.push(source)
      break
    }
  }

  for (const candidate of [
    { ref: 'JDCAGNET.md', fullPath: path.join(cwd, 'JDCAGNET.md'), scope: 'project' as const },
    { ref: '.jdcagnet/JDCAGNET.md', fullPath: path.join(cwd, '.jdcagnet', 'JDCAGNET.md'), scope: 'project' as const },
    { ref: 'CLAUDE.md', fullPath: path.join(cwd, 'CLAUDE.md'), scope: 'project' as const },
    { ref: '.claude/CLAUDE.md', fullPath: path.join(cwd, '.claude', 'CLAUDE.md'), scope: 'project' as const },
    { ref: 'AGENTS.md', fullPath: path.join(cwd, 'AGENTS.md'), scope: 'project' as const },
    { ref: '.github/copilot-instructions.md', fullPath: path.join(cwd, '.github', 'copilot-instructions.md'), scope: 'project' as const },
    { ref: '.cursorrules', fullPath: path.join(cwd, '.cursorrules'), scope: 'project' as const },
  ]) {
    const source = await readInstructionCandidate(candidate)
    if (source) {
      sources.push(source)
      break
    }
  }

  for (const dir of [
    { prefix: '.jdcagnet/rules', fullPath: path.join(cwd, '.jdcagnet', 'rules') },
    { prefix: '.claude/rules', fullPath: path.join(cwd, '.claude', 'rules') },
  ]) {
    try {
      const files = (await readdir(dir.fullPath)).filter((file) => file.endsWith('.md')).sort()
      for (const file of files) {
        sources.push({
          ref: `${dir.prefix}/${file}`,
          content: `# ${file}\n${await readFile(path.join(dir.fullPath, file), 'utf-8')}`,
          scope: 'rule',
        })
      }
    } catch {}
  }

  return sources
}

export async function loadProjectMd(cwd: string): Promise<string | null> {
  return (await loadInstructionSources(cwd)).find((source) => source.scope === 'project')?.content ?? null
}

export async function loadGlobalMd(): Promise<string | null> {
  return (await loadInstructionSources(process.cwd())).find((source) => source.scope === 'global')?.content ?? null
}

export async function loadProjectRules(cwd: string): Promise<string[]> {
  return (await loadInstructionSources(cwd)).filter((source) => source.scope === 'rule').map((source) => source.content)
}

export async function loadActivePlan(cwd: string): Promise<{ fileName: string; content: string; ageMs: number } | null> {
  const planDir = path.join(cwd, '.jdcagnet', 'plans')
  const RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000
  try {
    const files = await readdir(planDir)
    const mdFiles = files.filter(f => f.endsWith('.md'))
    // Pick the most-recently-modified non-COMPLETED plan, but only if it
    // was touched within the recency window. Older plans are stale — the
    // user has likely moved on, so we don't shove them back into context.
    const stat = await import('node:fs/promises').then(m => m.stat)
    let best: { fileName: string; content: string; mtimeMs: number } | null = null
    for (const f of mdFiles) {
      const full = path.join(planDir, f)
      const s = await stat(full)
      const content = await readFile(full, 'utf-8')
      if (content.trimStart().startsWith('<!-- COMPLETED -->')) continue
      if (!best || s.mtimeMs > best.mtimeMs) {
        best = { fileName: f, content, mtimeMs: s.mtimeMs }
      }
    }
    if (!best) return null
    const ageMs = Date.now() - best.mtimeMs
    if (ageMs > RECENCY_WINDOW_MS) return null
    return { fileName: best.fileName, content: best.content, ageMs }
  } catch { return null }
}

async function getGitInfo(cwd: string): Promise<{ branch?: string; status?: string; user?: string }> {
  try {
    const { stdout: branch } = await execFileAsync('git', ['branch', '--show-current'], { cwd })
    const { stdout: status } = await execFileAsync('git', ['status', '--short'], { cwd })
    const { stdout: log } = await execFileAsync('git', ['log', '--oneline', '-5'], { cwd })
    let user: string | undefined
    try {
      const { stdout: u } = await execFileAsync('git', ['config', 'user.name'], { cwd })
      user = u.trim()
    } catch {}
    const statusText = status.trim() || '(clean)'
    return {
      branch: branch.trim(),
      status: `Branch: ${branch.trim()}\nStatus:\n${statusText}\nRecent commits:\n${log.trim()}`,
      user,
    }
  } catch {
    return {}
  }
}

export function joinSegments(segments: PromptSegment[]): string {
  return segments.map(s => s.content).join('\n\n---\n\n')
}

export async function assembleSystemPrompt(opts: ContextOptions): Promise<PromptSegment[]> {
  const git = await getGitInfo(opts.cwd)
  const env = {
    os: `${os.platform()} ${os.release()}`,
    cwd: opts.cwd,
    shell: process.platform === 'win32'
      ? (process.env.COMSPEC || 'powershell')
      : (process.env.SHELL || '/bin/bash'),
    gitBranch: git.branch,
    gitUser: git.user,
    hostname: os.hostname(),
    arch: os.arch(),
  }

  const segments: PromptSegment[] = []

  // Base prompt
  segments.push({
    content: getBasePrompt({
      toolDefs: opts.toolDefs,
      environment: env,
      mcpServers: opts.mcpServers,
      permissionMode: opts.permissionMode,
    }),
    cacheable: true,
  })

  // Skills listing
  if (opts.skills && opts.skills.length > 0) {
    const skillList = opts.skills.map(s => {
      const hint = s.argumentHint ? ` — usage: /${s.name} ${s.argumentHint}` : ''
      const trigger = s.trigger ? `\n  TRIGGER: ${s.trigger}` : ''
      return `- /${s.name}: ${s.description}${hint}${trigger}`
    }).join('\n')
    segments.push({
      content: `# Available Skills\n\nThe following skills can be invoked using the Skill tool:\n\n${skillList}\n\nWhen the user types \`/<skill-name>\` or their request matches a skill, invoke it using the Skill tool with the skill name. If the skill has an argument hint, the user may provide arguments after the skill name.`,
      cacheable: true,
    })
  }

  // Background tasks capability
  segments.push({
    content: `# Background Tasks

You can run tasks in the background:

**Background Agents:** Use the Agent tool with \`run_in_background: true\` to dispatch sub-agents that run independently. You can continue the conversation while they work.

**Background Shell:** Use the bash tool with \`run_in_background: true\` for long-running commands.

**Notifications:** When a background task completes, you will receive a \`<task-notification>\` message. Respond naturally — summarize what happened and suggest next steps if needed.

**When to use background:**
- Long-running tasks (builds, large refactors, multi-file changes)
- Independent subtasks that don't block the current conversation
- Parallel work (dispatch multiple agents for different parts)

**When NOT to use background:**
- Tasks where you need the result immediately to continue
- Simple, fast operations (< 30 seconds)

You can check running tasks with \`task_output\` tool, or wait for the notification.`,
    cacheable: true,
  })

  // Active plan — recently-touched, not-yet-marked-complete plan from
  // .jdcagnet/plans/. We attach it as REFERENCE ONLY: the model must not
  // resume work on it unless the user's CURRENT message clearly asks for
  // that plan (by name or "continue last plan" / "继续上次的方案"). A new
  // unrelated request must be answered as a new request.
  const activePlan = await loadActivePlan(opts.cwd)
  if (activePlan) {
    const ageHours = Math.max(1, Math.round(activePlan.ageMs / (60 * 60 * 1000)))
    segments.push({
      content: `<recent-plan>\nA plan file was edited in this project ~${ageHours}h ago. It is attached for context only.\n\nFile: .jdcagnet/plans/${activePlan.fileName}\n\n${activePlan.content}\n\n</recent-plan>\n\n# How to use <recent-plan>\n\n- This plan is REFERENCE ONLY. It is NOT an open task list for the current conversation.\n- Do NOT continue, resume, or execute steps from this plan unless the user's current message clearly references it (e.g. "continue the plan", "继续上次那个方案", names the plan / topic, or asks "where were we").\n- For any new, unrelated request from the user, ignore this plan entirely and treat the request on its own merits — do not "remember" it, do not propose it, do not surface it.\n- If you're unsure whether the user's request relates to this plan, ASK rather than assume. Pre-emptively jumping back into an old plan is worse than asking one clarifying question.`,
      cacheable: true,
    })
  }

  // Instructions loaded into the system prompt are tracked as carried context.
  const instructionSources = await loadInstructionSources(opts.cwd)
  if (instructionSources.length > 0) {
    const instructionParts: string[] = []
    const global = instructionSources.filter((source) => source.scope === 'global')
    const project = instructionSources.filter((source) => source.scope === 'project')
    const rules = instructionSources.filter((source) => source.scope === 'rule')
    if (global.length) instructionParts.push(`# Global Instructions\n${global.map((source) => source.content).join('\n\n')}`)
    if (project.length) instructionParts.push(`# Project Instructions\n${project.map((source) => source.content).join('\n\n')}`)
    if (rules.length) instructionParts.push(`# Project Rules\n${rules.map((source) => source.content).join('\n\n')}`)
    segments.push({ content: instructionParts.join('\n\n'), cacheable: true })
  }

  // User preferences
  if (opts.language || opts.customInstructions) {
    const prefParts: string[] = ['# User Preferences']
    if (opts.language) {
      const labels: Record<string, string> = { 'zh-CN': '中文', 'en': 'English', 'ja': '日本語', 'ko': '한국어' }
      prefParts.push(`Language: ${labels[opts.language] || opts.language}`)
    }
    if (opts.customInstructions) {
      prefParts.push(`\nCustom Instructions:\n${opts.customInstructions}`)
    }
    segments.push({ content: prefParts.join('\n'), cacheable: true })
  }

  // Dynamic section
  const date = new Date().toISOString().split('T')[0]
  segments.push({ content: `# Current Date\n${date}`, cacheable: false })

  return segments
}
