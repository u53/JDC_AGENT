import type { ChangedFileRecord, VerificationRequirementRecord } from './verification-ledger.js'

export type TurnEndGateDecision =
  | { action: 'allow' }
  | { action: 'append_disclosure'; severity: 'warning' | 'error'; disclosure: string }

export function evaluateTurnEndGate(input: {
  changedFiles: ChangedFileRecord[]
  requirements: VerificationRequirementRecord[]
  assistantText: string
}): TurnEndGateDecision {
  if (input.changedFiles.length === 0) return { action: 'allow' }

  const failed = input.requirements.filter((requirement) => requirement.status === 'failed')
  if (failed.length) {
    return {
      action: 'append_disclosure',
      severity: 'error',
      disclosure: disclosureBlock('Verification failed', failed.map(formatRequirement)),
    }
  }

  const unresolved = input.requirements.filter((requirement) => requirement.status === 'pending')
  if (unresolved.length) {
    return {
      action: 'append_disclosure',
      severity: 'warning',
      disclosure: disclosureBlock(disclosureTitle(unresolved), unresolved.map(formatRequirement)),
    }
  }

  const unresolvedFiles = input.changedFiles.filter((file) => file.status === 'pending' || file.status === 'failed')
  if (unresolvedFiles.length) {
    const hasFailedFile = unresolvedFiles.some((file) => file.status === 'failed')
    const hasOnlyNonActionableRequirements = input.requirements.length === 0 ||
      input.requirements.every((requirement) => requirement.status === 'unavailable' || requirement.status === 'skipped')
    if (hasOnlyNonActionableRequirements && !hasFailedFile) return { action: 'allow' }
    return {
      action: 'append_disclosure',
      severity: hasFailedFile ? 'error' : 'warning',
      disclosure: disclosureBlock(
        hasFailedFile ? 'Verification failed' : input.requirements.length === 0 ? 'Verification not derived' : 'Verification not completed',
        unresolvedFiles.map(formatChangedFile)
      ),
    }
  }

  return { action: 'allow' }
}

function disclosureTitle(requirements: VerificationRequirementRecord[]): string {
  if (requirements.some((requirement) => requirement.status === 'pending')) return 'Verification not completed'
  return 'Verification unavailable or skipped'
}

function disclosureBlock(title: string, lines: string[]): string {
  return [
    '',
    `Verification status: ${title}.`,
    ...lines,
  ].join('\n')
}

function formatChangedFile(file: ChangedFileRecord): string {
  const details = file.status === 'failed' && file.verificationFailure ? ` (${file.verificationFailure})` : ''
  return `- ${file.filePath}: ${file.status}${details}`
}

function formatRequirement(requirement: VerificationRequirementRecord): string {
  const details = requirement.status === 'failed'
    ? requirement.failure
    : requirement.status === 'unavailable' || requirement.status === 'skipped'
      ? requirement.reason
      : undefined
  const suffix = details ? ` (${details})` : ''
  return `- ${requirement.kind}: ${requirement.command} -> ${requirement.status}${suffix}`
}
