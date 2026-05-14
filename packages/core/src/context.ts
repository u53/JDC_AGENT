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
  mcpServers?: { name: string; toolCount: number; tools?: string[] }[]
  permissionMode?: string
  skills?: { name: string; description: string }[]
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
    const skillList = opts.skills.map(s => `- ${s.name}: ${s.description}`).join('\n')
    segments.push({
      content: `# Available Skills\n\nThe following skills can be invoked using the Skill tool:\n\n${skillList}\n\nWhen the user's request matches a skill, invoke it using the Skill tool with the skill name. Skills are reusable instruction templates that guide you through specific workflows.`,
      cacheable: true,
    })
  }

  // Memory
  const memoryIndex = await loadMemoryIndex(opts.cwd)
  const memDir = getMemoryDir(opts.cwd)
  segments.push({ content: getMemoryPrompt(memDir, memoryIndex), cacheable: true })

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

You have a persistent, file-based memory system at \`${memDir}/\`. Use the file_write tool to create memory files and update the index.

## How to save memories

When you learn something worth remembering across conversations (user preferences, project context, feedback on your approach), save it:

1. Write a memory file (e.g., \`${memDir}/topic-name.md\`) with this format:

\`\`\`markdown
---
name: topic-name
description: One-line summary
type: user|feedback|project|reference
---

Memory content here.
\`\`\`

2. Add a one-line pointer to \`${memDir}/MEMORY.md\`:
\`- [Title](topic-name.md) — one-line summary\`

## Memory types

- **user**: User's role, preferences, expertise level
- **feedback**: Corrections or confirmations about how to work (what to avoid, what works well)
- **project**: Ongoing work context not derivable from code (deadlines, decisions, who's doing what)
- **reference**: Pointers to external systems (where bugs are tracked, which dashboard to check)

## When to save

- User explicitly asks you to remember something
- You learn user preferences or corrections
- Important project context is shared

## When to access

- When memories seem relevant to the current task
- When the user asks you to recall something
- Read memory files with file_read when you need the full content

## What NOT to save

- Code patterns (derivable from reading the code)
- Git history (use git log)
- Anything already in JDCAGNET.md or project rules${indexContent}`
}
