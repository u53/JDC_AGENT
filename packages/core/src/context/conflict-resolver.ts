import type { ContextDiagnostic, ContextRequest, ContextSection } from './types.js'
import { diagnostic } from './providers/shared.js'

export interface SuppressedContextSection {
  id: string
  reason: string
}

export interface ContextConflictResolution {
  sections: ContextSection[]
  suppressed: SuppressedContextSection[]
  diagnostics: ContextDiagnostic[]
}

export function resolveContextConflicts(request: ContextRequest, sections: ContextSection[]): ContextConflictResolution {
  const kept: ContextSection[] = []
  const suppressed: SuppressedContextSection[] = []

  for (const section of sections) {
    const reason = conflictReason(request, section)
    if (reason) {
      suppressed.push({ id: section.id, reason })
      continue
    }
    kept.push(section)
  }

  return {
    sections: kept,
    suppressed,
    diagnostics: suppressed.map((item) => {
      const section = sections.find((candidate) => candidate.id === item.id)
      const label = section ? `${section.kind} "${section.title}"` : item.id
      return {
        ...diagnostic('ContextConflictResolver', 'info', `Suppressed context section ${item.id} (${label}): ${item.reason}.`, request.createdAt),
        visibleInPrimaryUi: false,
      }
    }),
  }
}

function conflictReason(request: ContextRequest, section: ContextSection): string | null {
  if (
    request.transcriptAlreadyInModel === true &&
    section.ownership?.topic === 'conversation' &&
    section.ownership.conflictPolicy === 'suppress_if_carried' &&
    section.sourceProvider === 'ConversationSignalProvider' &&
    section.title === 'Conversation state'
  ) {
    return 'transcript_already_in_model_messages'
  }

  if (
    request.carriedContext?.gitStatusInSystemPrompt === true &&
    section.ownership?.topic === 'git' &&
    section.ownership.conflictPolicy === 'suppress_if_carried'
  ) {
    return 'git_state_already_in_system_prompt'
  }

  return null
}
