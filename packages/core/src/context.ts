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
  skills?: { name: string; description: string; argumentHint?: string }[]
  language?: string
  customInstructions?: string
}

export async function loadProjectMd(cwd: string): Promise<string | null> {
  const candidates = [
    path.join(cwd, 'JDCAGNET.md'),
    path.join(cwd, '.jdcagnet', 'JDCAGNET.md'),
    path.join(cwd, 'CLAUDE.md'),
    path.join(cwd, '.claude', 'CLAUDE.md'),
  ]
  for (const p of candidates) {
    try { return await readFile(p, 'utf-8') } catch {}
  }
  return null
}

export async function loadGlobalMd(): Promise<string | null> {
  try { return await readFile(path.join(CONFIG_DIR, 'JDCAGNET.md'), 'utf-8') } catch { return null }
}

export async function loadProjectRules(cwd: string): Promise<string[]> {
  const rulesDir = path.join(cwd, '.jdcagnet', 'rules')
  try {
    const files = await readdir(rulesDir)
    const mds = files.filter(f => f.endsWith('.md')).sort()
    const contents: string[] = []
    for (const f of mds) {
      const content = await readFile(path.join(rulesDir, f), 'utf-8')
      contents.push(`# ${f}\n${content}`)
    }
    return contents
  } catch { return [] }
}

export function getMemoryDir(cwd: string): string {
  const sanitized = cwd.replace(/\//g, '-').replace(/^-/, '')
  return path.join(CONFIG_DIR, 'projects', sanitized, 'memory')
}

export async function loadMemoryIndex(cwd: string): Promise<string | null> {
  const memDir = getMemoryDir(cwd)
  try {
    const content = await readFile(path.join(memDir, 'MEMORY.md'), 'utf-8')
    const lines = content.split('\n').slice(0, 200)
    return lines.join('\n')
  } catch { return null }
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
    shell: process.env.SHELL || 'bash',
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
      return `- /${s.name}: ${s.description}${hint}`
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

  // Memory
  const memoryIndex = await loadMemoryIndex(opts.cwd)
  const memDir = getMemoryDir(opts.cwd)
  segments.push({ content: getMemoryPrompt(memDir, memoryIndex), cacheable: true })

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

function getMemoryPrompt(memDir: string, memoryIndex: string | null): string {
  const indexContent = memoryIndex
    ? `\n\nCurrent memory index (MEMORY.md):\n${memoryIndex}`
    : ''

  return `# Memory

You have a persistent, file-based memory system at \`${memDir}/\`. This directory persists across conversations — anything saved here is available in future sessions.

If the user explicitly asks you to remember something, save it immediately. If they ask you to forget something, find and remove the relevant entry.

## Types of memory

<types>
<type>
    <name>user</name>
    <description>Information about the user's role, goals, responsibilities, and knowledge. Great user memories help you tailor future behavior to the user's preferences and perspective. You should collaborate with a senior engineer differently than a first-time coder. Avoid writing memories that could be viewed as negative judgements or that are irrelevant to the work.</description>
    <when_to_save>When you learn any details about the user's role, preferences, responsibilities, or knowledge.</when_to_save>
    <how_to_use>When your work should be informed by the user's profile. For example, tailor explanations to their expertise level, or frame concepts in terms of domains they already know.</how_to_use>
    <examples>
    user: I'm a data scientist investigating what logging we have in place
    assistant: [saves user memory: user is a data scientist, currently focused on observability/logging]

    user: I've been writing Go for ten years but this is my first time touching the React side of this repo
    assistant: [saves user memory: deep Go expertise, new to React — frame frontend explanations in terms of backend analogues]
    </examples>
</type>
<type>
    <name>feedback</name>
    <description>Guidance the user has given about how to approach work — both what to avoid and what to keep doing. These are the MOST IMPORTANT memories because they prevent repeating mistakes and preserve validated approaches. Record from failure AND success: if you only save corrections, you'll avoid past mistakes but drift away from approaches the user already validated.</description>
    <when_to_save>Any time the user corrects your approach ("no not that", "don't", "stop doing X") OR confirms a non-obvious approach worked ("yes exactly", "perfect, keep doing that", accepting an unusual choice without pushback). Corrections are easy to notice; confirmations are quieter — watch for them. Include WHY so you can judge edge cases later.</when_to_save>
    <how_to_use>Let these memories guide your behavior so the user does not need to offer the same guidance twice.</how_to_use>
    <body_structure>Lead with the rule itself, then a **Why:** line (the reason — often a past incident or strong preference) and a **How to apply:** line (when/where this guidance kicks in). Knowing why lets you judge edge cases instead of blindly following the rule.</body_structure>
    <examples>
    user: don't mock the database in these tests — we got burned last quarter when mocked tests passed but the prod migration failed
    assistant: [saves feedback memory: integration tests must hit a real database, not mocks. Why: prior incident where mock/prod divergence masked a broken migration]

    user: stop summarizing what you just did at the end of every response, I can read the diff
    assistant: [saves feedback memory: user wants terse responses with no trailing summaries]

    user: yeah the single bundled PR was the right call here, splitting this one would've just been churn
    assistant: [saves feedback memory: for refactors in this area, user prefers one bundled PR over many small ones. Confirmed after I chose this approach — a validated judgment call]
    </examples>
</type>
<type>
    <name>project</name>
    <description>Information about ongoing work, goals, initiatives, bugs, or incidents that is NOT derivable from the code or git history. Project memories help you understand the broader context and motivation behind the user's requests.</description>
    <when_to_save>When you learn who is doing what, why, or by when. These states change quickly — keep your understanding up to date. Always convert relative dates to absolute dates when saving (e.g., "Thursday" → "2026-03-05") so the memory remains interpretable later.</when_to_save>
    <how_to_use>Use these to understand the nuance behind requests and make better informed suggestions.</how_to_use>
    <body_structure>Lead with the fact or decision, then a **Why:** line (the motivation — constraint, deadline, or stakeholder ask) and a **How to apply:** line (how this should shape suggestions). Project memories decay fast, so the why helps future-you judge whether the memory is still relevant.</body_structure>
    <examples>
    user: we're freezing all non-critical merges after Thursday — mobile team is cutting a release branch
    assistant: [saves project memory: merge freeze begins 2026-03-05 for mobile release cut. Flag any non-critical PR work scheduled after that date]

    user: the reason we're ripping out the old auth middleware is that legal flagged it for storing session tokens in a way that doesn't meet the new compliance requirements
    assistant: [saves project memory: auth middleware rewrite driven by legal/compliance requirements around session token storage — scope decisions should favor compliance over ergonomics]
    </examples>
</type>
<type>
    <name>reference</name>
    <description>Pointers to where information can be found in external systems. These let you remember where to look for up-to-date information outside the project directory.</description>
    <when_to_save>When you learn about resources in external systems and their purpose.</when_to_save>
    <how_to_use>When the user references an external system or asks about information that may live outside the codebase.</how_to_use>
    <examples>
    user: check the Linear project "INGEST" if you want context on these tickets, that's where we track all pipeline bugs
    assistant: [saves reference memory: pipeline bugs tracked in Linear project "INGEST"]

    user: the Grafana board at grafana.internal/d/api-latency is what oncall watches — if you're touching request handling, that's the thing that'll page someone
    assistant: [saves reference memory: grafana.internal/d/api-latency is the oncall latency dashboard — check when editing request-path code]
    </examples>
</type>
</types>

## What NOT to save

- Code patterns, conventions, architecture, file paths, or project structure — derivable by reading the current project state
- Git history, recent changes, or who-changed-what — \`git log\` / \`git blame\` are authoritative
- Debugging solutions or fix recipes — the fix is in the code; the commit message has the context
- Anything already documented in JDCAGNET.md or project rules
- Ephemeral task details: in-progress work, temporary state, current conversation context

These exclusions apply even when the user explicitly asks you to save. If they ask you to save a PR list or activity summary, ask what was *surprising* or *non-obvious* about it — that is the part worth keeping.

## How to save memories

Two-step process:

**Step 1** — Write the memory file (e.g., \`${memDir}/topic-name.md\`):

\`\`\`markdown
---
name: topic-name
description: One-line summary — used to decide relevance in future conversations, so be specific
type: user|feedback|project|reference
---

Memory content here. For feedback/project types, structure as:
Rule or fact.
**Why:** the reason.
**How to apply:** when/where this kicks in.
\`\`\`

**Step 2** — Add a one-line pointer to \`${memDir}/MEMORY.md\`:
\`- [Title](topic-name.md) — one-line hook\`

Rules:
- MEMORY.md is always loaded into context — keep it under 200 lines
- Organize semantically by topic, not chronologically
- Update or remove memories that are wrong or outdated
- Do not write duplicates — check existing memories first and update if one exists
- Keep names as kebab-case slugs

## When to save (proactively)

Save immediately when you notice:
- User explicitly asks you to remember something
- User corrects your approach or confirms a non-obvious choice
- User shares project context not derivable from code (deadlines, decisions, who's doing what)
- User reveals their role, expertise, or preferences
- You learn about external systems or resources

Do NOT wait to be asked. If the signal is clear, save it now.

## When to access memories

IMPORTANT: Before starting any task or answering a question, SCAN the memory index above. If any entry's description matches the topic at hand, read that memory file FIRST — before exploring the codebase or running commands. Memories contain distilled knowledge from prior conversations that saves you from re-discovering things.

Specifically, check memories when:
- The user asks about a process, workflow, or "how do we do X" — likely already documented
- The user asks about project context, decisions, or constraints
- You're about to make a recommendation that prior feedback might contradict
- The user references something from a previous conversation

You MUST access memory when the user explicitly asks you to check, recall, or remember.

If the user says to *ignore* or *not use* memory: do not apply, cite, compare against, or mention memory content.

## Before recommending from memory

A memory that names a specific function, file, or flag is a claim that it existed *when the memory was written*. It may have been renamed, removed, or never merged. Before recommending it:

- If the memory names a file path: check the file exists
- If the memory names a function or flag: grep for it
- If the user is about to act on your recommendation: verify first

"The memory says X exists" is not the same as "X exists now."

A memory that summarizes repo state is frozen in time. If the user asks about *recent* or *current* state, prefer \`git log\` or reading the code over recalling the snapshot.${indexContent}`
}
