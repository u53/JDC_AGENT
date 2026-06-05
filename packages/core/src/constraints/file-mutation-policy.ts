import { existsSync } from 'node:fs'
import path from 'node:path'
import type { FileReadStateCache } from '../file-read-state.js'

export type FileMutationPolicyDecision = { decision: 'allow' } | { decision: 'block'; reason: string }

export interface FileMutationPolicyInput {
  toolName: string
  input: unknown
  cwd: string
  fileReadState?: FileReadStateCache
}

const MUTATION_TOOLS = new Set(['Edit', 'MultiEdit', 'Write'])

export function evaluateFileMutationPolicy(policyInput: FileMutationPolicyInput): FileMutationPolicyDecision {
  if (!MUTATION_TOOLS.has(policyInput.toolName)) return allow()
  if (!policyInput.fileReadState) return allow()

  const filePath = getFilePath(policyInput.input)
  if (!filePath) return allow()

  const resolvedFilePath = path.isAbsolute(filePath) ? filePath : path.resolve(policyInput.cwd, filePath)

  if (policyInput.toolName === 'Write' && !existsSync(resolvedFilePath)) {
    return allow()
  }

  if (policyInput.toolName === 'Edit') {
    return checkFreshRead(policyInput.fileReadState, resolvedFilePath, getRequiredText(policyInput.input, 'old_string'))
  }

  if (policyInput.toolName === 'MultiEdit') {
    const edits = getEdits(policyInput.input)
    if (!edits) return allow()

    for (const edit of edits) {
      const decision = checkFreshRead(policyInput.fileReadState, resolvedFilePath, getRequiredText(edit, 'old_string'))
      if (decision.decision === 'block') return decision
    }

    return allow()
  }

  if (policyInput.toolName === 'Write') {
    return checkFreshRead(policyInput.fileReadState, resolvedFilePath, undefined, true)
  }

  return checkFreshRead(policyInput.fileReadState, resolvedFilePath)
}

function checkFreshRead(
  fileReadState: FileReadStateCache,
  filePath: string,
  requiredText?: string,
  requireFullFile = false
): FileMutationPolicyDecision {
  const result = fileReadState.checkFreshRead(filePath, { requiredText, requireFullFile })
  if (result.ok) return allow()
  return { decision: 'block', reason: result.message }
}

function getFilePath(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  return typeof input.file_path === 'string' && input.file_path.length > 0 ? input.file_path : undefined
}

function getRequiredText(input: unknown, key: string): string | undefined {
  if (!isRecord(input)) return undefined
  return typeof input[key] === 'string' ? input[key] : undefined
}

function getEdits(input: unknown): unknown[] | undefined {
  if (!isRecord(input)) return undefined
  return Array.isArray(input.edits) ? input.edits : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function allow(): FileMutationPolicyDecision {
  return { decision: 'allow' }
}
