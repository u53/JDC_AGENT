// packages/core/src/context.ts
import { readFile, readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import { getBasePrompt } from './base-prompt.js'

const execFileAsync = promisify(execFile)
const CONFIG_DIR = path.join(os.homedir(), '.jdcagnet')

export interface ContextOptions {
  cwd: string
  toolNames: string[]
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

async function getGitInfo(cwd: string): Promise<{ branch?: string; status?: string }> {
  try {
    const { stdout: branch } = await execFileAsync('git', ['branch', '--show-current'], { cwd })
    const { stdout: status } = await execFileAsync('git', ['status', '--short'], { cwd })
    const { stdout: log } = await execFileAsync('git', ['log', '--oneline', '-5'], { cwd })
    const statusText = status.trim() || '(clean)'
    return {
      branch: branch.trim(),
      status: `Branch: ${branch.trim()}\nStatus:\n${statusText}\nRecent commits:\n${log.trim()}`,
    }
  } catch {
    return {}
  }
}

export async function assembleSystemPrompt(opts: ContextOptions): Promise<string> {
  const git = await getGitInfo(opts.cwd)
  const env = {
    os: `${os.platform()} ${os.release()}`,
    cwd: opts.cwd,
    shell: process.env.SHELL || 'bash',
    gitBranch: git.branch,
  }
  const parts: string[] = [getBasePrompt(opts.toolNames, env)]

  const globalMd = await loadGlobalMd()
  if (globalMd) parts.push(`# Global Instructions\n${globalMd}`)

  const projectMd = await loadProjectMd(opts.cwd)
  if (projectMd) parts.push(`# Project Instructions\n${projectMd}`)

  const rules = await loadProjectRules(opts.cwd)
  if (rules.length > 0) parts.push(`# Project Rules\n${rules.join('\n\n')}`)

  if (git.status) parts.push(`# Git Status\n${git.status}`)

  const date = new Date().toISOString().split('T')[0]
  parts.push(`# Current Date\n${date}`)

  return parts.join('\n\n---\n\n')
}
