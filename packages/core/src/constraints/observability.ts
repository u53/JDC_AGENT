import type { ModelCapabilityProfile } from '../model-profile.js'
import type { ContextInspectPayload } from '../tools/context-inspect.js'
import type { PolicyEvent } from './policy-events.js'
import type { ConstraintPolicyRuntime } from './policy-runtime.js'
import type { ChangedFileRecord, VerificationCommandRecord, VerificationRequirementRecord } from './verification-ledger.js'

export type ConstraintObservabilityStatus =
  | 'idle'
  | 'checking'
  | 'blocked'
  | 'needs_evidence'
  | 'needs_verification'
  | 'verified'
  | 'failed'
  | 'unavailable'

export interface ConstraintEvidenceSummary {
  status: 'not_required' | 'satisfied' | 'missing'
  missing: Array<{ kind: string; reason: string }>
}

export interface ConstraintVerificationSummary {
  status: 'not_required' | 'pending' | 'passed' | 'failed' | 'unavailable'
  changedFiles: ChangedFileRecord[]
  requirements: VerificationRequirementRecord[]
  commands: VerificationCommandRecord[]
}

export interface ConstraintContextHealthSummary {
  status: ContextInspectPayload['status'] | 'not_reported'
  latestBundleId?: string
  providerCount: number
  unhealthyProviderCount: number
  diagnostics: ContextInspectPayload['diagnostics']
}

export interface ConstraintModelProfileSummary {
  id: string
  label?: string
  evidenceStrictness?: string
  maxParallelToolCalls?: number
}

export interface ConstraintObservabilitySnapshot {
  status: ConstraintObservabilityStatus
  inspectedAt: number
  cwd: string
  intent?: string
  objective?: string
  modelProfile?: ConstraintModelProfileSummary
  summary: { primary: string; secondary: string }
  evidence: ConstraintEvidenceSummary
  blockedActions: PolicyEvent[]
  verification: ConstraintVerificationSummary
  contextHealth: ConstraintContextHealthSummary
  policyEvents: PolicyEvent[]
}

export interface BuildConstraintObservabilitySnapshotInput {
  runtime: ConstraintPolicyRuntime
  cwd: string
  inspectedAt?: number
  context?: ContextInspectPayload | null
  modelProfile?: ModelCapabilityProfile
}

interface ExtractedAgentContract {
  intent?: string
  objective?: string
  modelProfileId?: string
  evidenceStrictness?: string
  missing: Array<{ kind: string; reason: string }>
}

export function buildConstraintObservabilitySnapshot(input: BuildConstraintObservabilitySnapshotInput): ConstraintObservabilitySnapshot {
  const inspectedAt = input.inspectedAt ?? Date.now()
  const policyEvents = input.runtime.policyEvents.list()
  const blockedActions = activeBlockedActions(policyEvents)
  const changedFiles = input.runtime.verificationLedger.getChangedFiles()
  const requirements = input.runtime.verificationLedger.getRequirements()
  const commands = input.runtime.verificationLedger.getCommands()
  const contract = extractAgentContract(input.context)
  const evidence = evidenceSummary(contract)
  const verification = verificationSummary(changedFiles, requirements, commands)
  const contextHealth = contextHealthSummary(input.context)
  const modelProfile = modelProfileSummary(input.modelProfile, contract)
  const status = deriveStatus({ blockedActions, evidence, verification, contextHealth })

  return {
    status,
    inspectedAt,
    cwd: input.cwd,
    intent: contract.intent,
    objective: contract.objective,
    modelProfile,
    summary: statusSummary(status, evidence, verification, contextHealth),
    evidence,
    blockedActions,
    verification,
    contextHealth,
    policyEvents,
  }
}

function activeBlockedActions(policyEvents: PolicyEvent[]): PolicyEvent[] {
  const blocked: PolicyEvent[] = []
  for (let index = policyEvents.length - 1; index >= 0; index -= 1) {
    const event = policyEvents[index]
    if (event.decision !== 'block') break
    blocked.unshift(event)
  }
  return blocked
}

function deriveStatus(input: {
  blockedActions: PolicyEvent[]
  evidence: ConstraintEvidenceSummary
  verification: ConstraintVerificationSummary
  contextHealth: ConstraintContextHealthSummary
}): ConstraintObservabilityStatus {
  if (input.blockedActions.length > 0) return 'blocked'
  if (input.evidence.status === 'missing') return 'needs_evidence'
  if (input.verification.status === 'failed') return 'failed'
  if (input.verification.status === 'pending') return 'needs_verification'
  if (input.verification.status === 'passed') return 'verified'
  if (input.contextHealth.status === 'unavailable') return 'unavailable'
  return 'idle'
}

function verificationSummary(
  changedFiles: ChangedFileRecord[],
  requirements: VerificationRequirementRecord[],
  commands: VerificationCommandRecord[],
): ConstraintVerificationSummary {
  if (requirements.some((requirement) => requirement.status === 'failed') || changedFiles.some((file) => file.status === 'failed')) {
    return { status: 'failed', changedFiles, requirements, commands }
  }
  if (requirements.some((requirement) => requirement.status === 'pending' || requirement.status === 'unavailable') || changedFiles.some((file) => file.status === 'pending')) {
    return { status: 'pending', changedFiles, requirements, commands }
  }
  if (changedFiles.length > 0 || requirements.length > 0) return { status: 'passed', changedFiles, requirements, commands }
  return { status: 'not_required', changedFiles, requirements, commands }
}

function extractAgentContract(context?: ContextInspectPayload | null): ExtractedAgentContract {
  const section = context?.bundle?.sections.find((item) => item.kind === 'agent_contract')
  if (!section) return { missing: [] }

  const lines = section.content.split('\n')
  const missing: Array<{ kind: string; reason: string }> = []
  for (const line of lines) {
    const missingMatch = line.match(/^- ([^:]+):\s*(.+)$/)
    if (missingMatch) missing.push({ kind: missingMatch[1], reason: missingMatch[2] })
  }

  return {
    intent: valueAfterPrefix(lines, 'Intent: '),
    objective: valueAfterPrefix(lines, 'Objective: '),
    modelProfileId: valueAfterPrefix(lines, 'Model profile: '),
    evidenceStrictness: valueAfterPrefix(lines, 'Evidence strictness: '),
    missing,
  }
}

function valueAfterPrefix(lines: string[], prefix: string): string | undefined {
  const line = lines.find((item) => item.startsWith(prefix))
  return line ? line.slice(prefix.length).trim() : undefined
}

function evidenceSummary(contract: ExtractedAgentContract): ConstraintEvidenceSummary {
  if (contract.missing.length > 0) return { status: 'missing', missing: contract.missing }
  return { status: 'not_required', missing: [] }
}

function contextHealthSummary(context?: ContextInspectPayload | null): ConstraintContextHealthSummary {
  if (!context) return { status: 'not_reported', providerCount: 0, unhealthyProviderCount: 0, diagnostics: [] }
  const unhealthy = context.providerHealth.filter((provider) => (
    provider.status === 'failed' ||
    provider.status === 'timeout' ||
    provider.status === 'rate_limited' ||
    provider.status === 'stale' ||
    provider.status === 'not_indexed'
  ))

  return {
    status: context.status,
    latestBundleId: context.bundle?.id,
    providerCount: context.providerHealth.length,
    unhealthyProviderCount: unhealthy.length,
    diagnostics: context.diagnostics,
  }
}

function modelProfileSummary(
  profile: ModelCapabilityProfile | undefined,
  contract: ExtractedAgentContract,
): ConstraintModelProfileSummary | undefined {
  if (profile) {
    return {
      id: profile.id,
      label: profile.label,
      evidenceStrictness: profile.evidenceStrictness,
      maxParallelToolCalls: profile.maxParallelToolCalls,
    }
  }
  if (!contract.modelProfileId) return undefined
  return {
    id: contract.modelProfileId,
    evidenceStrictness: contract.evidenceStrictness,
  }
}

function statusSummary(
  status: ConstraintObservabilityStatus,
  evidence: ConstraintEvidenceSummary,
  verification: ConstraintVerificationSummary,
  contextHealth: ConstraintContextHealthSummary,
): ConstraintObservabilitySnapshot['summary'] {
  if (status === 'blocked') return { primary: '有操作被约束拦截', secondary: '模型需要先补齐文件证据或调整工具调用。' }
  if (status === 'needs_evidence') return { primary: '还缺少行动证据', secondary: `${evidence.missing.length} 项证据仍需补齐。` }
  if (status === 'needs_verification') return { primary: '修改等待验证', secondary: `${verification.changedFiles.length} 个文件需要验证。` }
  if (status === 'failed') return { primary: '验证失败', secondary: '最近的验证命令失败，需要修复或说明。' }
  if (status === 'verified') return { primary: '修改已验证', secondary: '当前已记录覆盖修改的验证。' }
  if (status === 'unavailable') return { primary: '约束状态暂不可用', secondary: contextHealth.diagnostics[0]?.message ?? '无法读取上下文状态。' }
  return { primary: '约束状态正常', secondary: '没有未处理的阻塞、证据缺口或验证缺口。' }
}
