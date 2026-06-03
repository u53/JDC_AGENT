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

export async function loadProjectMd(cwd: string): Promise<string | null> {
  // Support multiple conventions: JDCAGNET.md, CLAUDE.md, AGENTS.md, .cursorrules
  const candidates = [
    path.join(cwd, 'JDCAGNET.md'),
    path.join(cwd, '.jdcagnet', 'JDCAGNET.md'),
    path.join(cwd, 'CLAUDE.md'),
    path.join(cwd, '.claude', 'CLAUDE.md'),
    path.join(cwd, 'AGENTS.md'),
    path.join(cwd, '.github', 'copilot-instructions.md'),
    path.join(cwd, '.cursorrules'),
  ]
  for (const p of candidates) {
    try { return await readFile(p, 'utf-8') } catch {}
  }
  return null
}

export async function loadGlobalMd(): Promise<string | null> {
  // Support both ~/.jdcagnet/JDCAGNET.md and ~/.claude/CLAUDE.md
  const candidates = [
    path.join(CONFIG_DIR, 'JDCAGNET.md'),
    path.join(os.homedir(), '.claude', 'CLAUDE.md'),
  ]
  for (const p of candidates) {
    try { return await readFile(p, 'utf-8') } catch {}
  }
  return null
}

export async function loadProjectRules(cwd: string): Promise<string[]> {
  // Support both .jdcagnet/rules/ and .claude/rules/
  const rulesDirs = [
    path.join(cwd, '.jdcagnet', 'rules'),
    path.join(cwd, '.claude', 'rules'),
  ]
  const contents: string[] = []
  for (const rulesDir of rulesDirs) {
    try {
      const files = await readdir(rulesDir)
      const mds = files.filter(f => f.endsWith('.md')).sort()
      for (const f of mds) {
        const content = await readFile(path.join(rulesDir, f), 'utf-8')
        contents.push(`# ${f}\n${content}`)
      }
    } catch {}
  }
  return contents
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

  // Instructions (globalMd + projectMd + rules combined)
  const instructionParts: string[] = []
  const globalMd = await loadGlobalMd()
  if (globalMd) instructionParts.push(`# Global Instructions\n${globalMd}`)
  const projectMd = await loadProjectMd(opts.cwd)
  if (projectMd) instructionParts.push(`# Project Instructions\n${projectMd}`)
  const rules = await loadProjectRules(opts.cwd)
  if (rules.length > 0) instructionParts.push(`# Project Rules\n${rules.join('\n\n')}`)
  if (instructionParts.length > 0) {
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

  // Dynamic section (git status + date)
  const dynamicParts: string[] = []
  if (git.status) dynamicParts.push(`# Git Status\n${git.status}`)
  const date = new Date().toISOString().split('T')[0]
  dynamicParts.push(`# Current Date\n${date}`)
  segments.push({ content: dynamicParts.join('\n\n'), cacheable: false })

  return segments
}
