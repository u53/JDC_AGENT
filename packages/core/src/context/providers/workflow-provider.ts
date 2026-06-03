import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ContextDiagnostic, ContextRequest, RawEvidence } from '../types.js'
import {
  citationFor,
  diagnostic,
  disabledProviderResult,
  failedProviderResult,
  hashContent,
  nowFromRequest,
  providerHealth,
  rawEvidence,
  section,
} from './shared.js'

const SOURCE = 'WorkflowSignalProvider'

export interface WorkflowProviderOptions {
  enabled?: boolean
}

interface WorkflowSignal {
  file: string
  source: 'github_workflow' | 'package_scripts'
  workflowType: 'release' | 'build' | 'test' | 'package' | 'ci'
  commands: string[]
  content: string
}

export async function collectWorkflowContext(request: ContextRequest, options: WorkflowProviderOptions = {}) {
  if (options.enabled === false) return disabledProviderResult('workflow', SOURCE, request)

  try {
    const capturedAt = nowFromRequest(request)
    const diagnostics: ContextDiagnostic[] = []
    const signals = await collectSignals(request.cwd, capturedAt, diagnostics)
    if (!signals.length) {
      const diag = diagnostic(SOURCE, 'warning', 'No workflow or package script files were found; workflow provider returned degraded context.', capturedAt)
      return {
        evidence: [] as RawEvidence[],
        sections: [],
        diagnostics: [diag, ...diagnostics],
        health: providerHealth('workflow', 'stale', capturedAt, diag),
      }
    }

    const evidence = signals.map((signal) => rawEvidence(request, SOURCE, 'file', signal.content, {
      file: signal.file,
      ref: signal.file,
      workflowType: signal.workflowType,
      commands: signal.commands,
      source: signal.source,
    }, capturedAt))
    const citations = evidence.map((item) => ({ ...citationFor(item, String(item.metadata.file ?? item.id)), hash: item.hash }))
    const content = renderWorkflowSignals(signals)

    return {
      evidence,
      sections: [section([request.sessionId, SOURCE, content], 'project_profile', 'Project workflows', content, citations, 74, 0.9, 'recent', SOURCE)],
      diagnostics,
      health: providerHealth('workflow', 'enabled', capturedAt),
    }
  } catch (error) {
    return failedProviderResult('workflow', SOURCE, request, error)
  }
}

async function collectSignals(cwd: string, capturedAt: number, diagnostics: ContextDiagnostic[]): Promise<WorkflowSignal[]> {
  const signals: WorkflowSignal[] = []
  signals.push(...await collectGithubWorkflowSignals(cwd))
  const rootPackage = await packageSignal(cwd, 'package.json', capturedAt, diagnostics)
  if (rootPackage) signals.push(rootPackage)
  signals.push(...await collectWorkspacePackageSignals(cwd, capturedAt, diagnostics))
  return signals
}

async function collectGithubWorkflowSignals(cwd: string): Promise<WorkflowSignal[]> {
  const dir = join(cwd, '.github', 'workflows')
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }

  const signals: WorkflowSignal[] = []
  for (const entry of entries.filter((name) => /\.ya?ml$/i.test(name)).sort()) {
    const file = `.github/workflows/${entry}`
    const content = await readOptional(join(cwd, file))
    if (content === null) continue
    const commands = workflowRunCommands(content)
    if (!commands.length) continue
    signals.push({
      file,
      source: 'github_workflow',
      workflowType: inferWorkflowType(`${file}\n${commands.join('\n')}`),
      commands,
      content: workflowEvidenceContent(file, commands, content),
    })
  }
  return signals
}

async function collectWorkspacePackageSignals(cwd: string, capturedAt: number, diagnostics: ContextDiagnostic[]): Promise<WorkflowSignal[]> {
  const packagesDir = join(cwd, 'packages')
  let entries: Array<{ name: string; isDirectory(): boolean }>
  try {
    entries = await readdir(packagesDir, { withFileTypes: true })
  } catch {
    return []
  }

  const signals: WorkflowSignal[] = []
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = `packages/${entry.name}/package.json`
    const signal = await packageSignal(cwd, relativePath, capturedAt, diagnostics)
    if (signal) signals.push(signal)
  }
  return signals
}

async function packageSignal(cwd: string, relativePath: string, capturedAt: number, diagnostics: ContextDiagnostic[]): Promise<WorkflowSignal | null> {
  const content = await readOptional(join(cwd, relativePath))
  if (content === null) return null
  let parsed: { scripts?: Record<string, unknown> }
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    diagnostics.push(diagnostic(SOURCE, 'warning', `Invalid package JSON in ${relativePath}: ${error instanceof Error ? error.message : String(error)}`, capturedAt))
    return null
  }

  const scripts = parsed.scripts && typeof parsed.scripts === 'object' ? parsed.scripts : {}
  const commands = Object.entries(scripts)
    .filter(([name, command]) => typeof command === 'string' && isWorkflowScript(name, command))
    .map(([name, command]) => `${name}: ${String(command)}`)
  if (!commands.length) return null

  return {
    file: relativePath,
    source: 'package_scripts',
    workflowType: inferWorkflowType(`${relativePath}\n${commands.join('\n')}`),
    commands,
    content: workflowEvidenceContent(relativePath, commands, content),
  }
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

function workflowRunCommands(content: string): string[] {
  const lines = content.split(/\r?\n/)
  const commands: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const inline = line.match(/^\s*run:\s*(.+?)\s*$/)
    if (inline && inline[1] !== '|') {
      commands.push(stripYamlQuotes(inline[1]))
      continue
    }
    if (/^\s*run:\s*\|\s*$/.test(line)) {
      const baseIndent = indentOf(line)
      for (index += 1; index < lines.length; index += 1) {
        const nested = lines[index] ?? ''
        if (!nested.trim()) continue
        if (indentOf(nested) <= baseIndent) {
          index -= 1
          break
        }
        commands.push(nested.trim())
      }
    }
  }
  return commands.filter(isWorkflowCommand)
}

function isWorkflowScript(name: string, command: unknown): boolean {
  const text = `${name} ${String(command)}`.toLowerCase()
  return /\b(build|test|package|pack|release|publish|ci|vsce|electron-builder|buildplugin)\b/.test(text)
}

function isWorkflowCommand(command: string): boolean {
  return /\b(pnpm|npm|yarn|bun|node|gradle|vsce|electron-builder|build|test|package|publish)\b/i.test(command)
}

function inferWorkflowType(text: string): WorkflowSignal['workflowType'] {
  const normalized = text.toLowerCase()
  if (/release|publish|tag|发布/.test(normalized)) return 'release'
  if (/package|pack|electron-builder|vsce/.test(normalized)) return 'package'
  if (/test|vitest|jest|playwright/.test(normalized)) return 'test'
  if (/build|tsc|gradle/.test(normalized)) return 'build'
  return 'ci'
}

function workflowEvidenceContent(file: string, commands: string[], rawContent: string): string {
  return [
    `file: ${file}`,
    `hash: ${hashContent(rawContent)}`,
    'commands:',
    ...commands.map((command) => `- ${command}`),
  ].join('\n')
}

function renderWorkflowSignals(signals: WorkflowSignal[]): string {
  return signals.map((signal) => [
    `${signal.file} (${signal.workflowType})`,
    ...signal.commands.map((command) => `- ${command}`),
  ].join('\n')).join('\n\n')
}

function stripYamlQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, '')
}

function indentOf(line: string): number {
  return line.match(/^\s*/)?.[0].length ?? 0
}
