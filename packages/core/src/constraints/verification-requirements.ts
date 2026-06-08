import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { VerificationKind } from './verification-ledger.js'

export type VerificationRequirementKind = VerificationKind | 'diff_check'
export type VerificationRequirementStatus = 'pending' | 'passed' | 'failed' | 'skipped' | 'unavailable'

export interface VerificationRequirement {
  id: string
  kind: VerificationRequirementKind
  command: string
  status: VerificationRequirementStatus
  files: string[]
  reason: string
}

export interface VerificationRequirementPlan {
  cwd: string
  changedFiles: string[]
  requirements: VerificationRequirement[]
}

export async function deriveVerificationRequirements(input: {
  cwd: string
  changedFiles: string[]
  userMessage: string
}): Promise<VerificationRequirementPlan> {
  const changedFiles = unique(input.changedFiles.map(normalizePath).filter(Boolean))
  if (changedFiles.length === 0) return { cwd: input.cwd, changedFiles, requirements: [] }

  const packageInfo = await readRootPackageInfo(input.cwd)
  const packageManager = detectPackageManager(input.cwd)
  const requirements: VerificationRequirement[] = []

  if (isDocsOnly(changedFiles)) {
    requirements.push({
      id: 'verify_diff_check',
      kind: 'diff_check',
      command: 'git diff --check',
      status: 'pending',
      files: changedFiles,
      reason: 'Documentation-only changes require whitespace/conflict-marker verification.',
    })
    return { cwd: input.cwd, changedFiles, requirements }
  }

  if (hasCodeChange(changedFiles)) {
    pushIfDefined(requirements, scriptRequirement({
      id: 'verify_test',
      kind: 'test',
      scriptName: 'test',
      packageManager,
      scripts: packageInfo.scripts,
      files: changedFiles,
    }))
    pushIfDefined(requirements, scriptRequirement({
      id: 'verify_build',
      kind: 'build',
      scriptName: 'build',
      packageManager,
      scripts: packageInfo.scripts,
      files: changedFiles,
    }))
  }

  if (hasTypeScriptChange(changedFiles) && packageInfo.scripts.typecheck) {
    pushIfDefined(requirements, scriptRequirement({
      id: 'verify_typecheck',
      kind: 'typecheck',
      scriptName: 'typecheck',
      packageManager,
      scripts: packageInfo.scripts,
      files: changedFiles,
    }))
  }

  if (changesPackageOrConfig(changedFiles) && packageInfo.scripts.build && !requirements.some((requirement) => requirement.kind === 'build')) {
    pushIfDefined(requirements, scriptRequirement({
      id: 'verify_build',
      kind: 'build',
      scriptName: 'build',
      packageManager,
      scripts: packageInfo.scripts,
      files: changedFiles,
    }))
  }

  return { cwd: input.cwd, changedFiles, requirements: dedupeRequirements(requirements) }
}

function scriptRequirement(input: {
  id: string
  kind: VerificationRequirementKind
  scriptName: string
  packageManager: string
  scripts: Record<string, string>
  files: string[]
}): VerificationRequirement | undefined {
  const hasScript = typeof input.scripts[input.scriptName] === 'string' && input.scripts[input.scriptName].trim().length > 0
  if (!hasScript) return undefined
  return {
    id: input.id,
    kind: input.kind,
    command: scriptCommand(input.packageManager, input.scriptName),
    status: 'pending',
    files: input.files,
    reason: `${input.scriptName} script covers changed files.`,
  }
}

function pushIfDefined<T>(items: T[], item: T | undefined): void {
  if (item) items.push(item)
}

function scriptCommand(packageManager: string, scriptName: string): string {
  if (packageManager === 'npm' && !['test', 'start', 'stop', 'restart'].includes(scriptName)) {
    return `npm run ${scriptName}`
  }
  if (packageManager === 'bun') return `bun run ${scriptName}`
  return `${packageManager} ${scriptName}`
}

async function readRootPackageInfo(cwd: string): Promise<{ scripts: Record<string, string> }> {
  try {
    const raw = await readFile(path.join(cwd, 'package.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> }
    const scripts: Record<string, string> = {}
    for (const [name, command] of Object.entries(parsed.scripts ?? {})) {
      if (typeof command === 'string') scripts[name] = command
    }
    return { scripts }
  } catch {
    return { scripts: {} }
  }
}

function detectPackageManager(cwd: string): 'pnpm' | 'yarn' | 'bun' | 'npm' {
  if (existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn'
  if (existsSync(path.join(cwd, 'bun.lockb')) || existsSync(path.join(cwd, 'bun.lock'))) return 'bun'
  return 'npm'
}

function hasCodeChange(files: string[]): boolean {
  return files.some((file) => /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|rs|go|java|kt|swift|css|scss|vue|svelte)$/i.test(file))
}

function hasTypeScriptChange(files: string[]): boolean {
  return files.some((file) => /\.(ts|tsx|mts|cts)$/i.test(file))
}

function changesPackageOrConfig(files: string[]): boolean {
  return files.some((file) => /(^|\/)(package\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+|vitest\.config\.[^/]+|eslint\.config\.[^/]+)$/i.test(file))
}

function isDocsOnly(files: string[]): boolean {
  return files.length > 0 && files.every((file) => /\.(md|mdx|txt|rst|adoc)$/i.test(file) || file.startsWith('docs/'))
}

function normalizePath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '')
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function dedupeRequirements(requirements: VerificationRequirement[]): VerificationRequirement[] {
  const seen = new Set<string>()
  const out: VerificationRequirement[] = []
  for (const requirement of requirements) {
    const key = `${requirement.kind}:${requirement.command}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(requirement)
  }
  return out
}
