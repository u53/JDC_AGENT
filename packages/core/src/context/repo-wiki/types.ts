import type { ContextCitation, ContextFreshness, ContextProviderStatus } from '../types.js'

export type RepoWikiEntryKind = 'architecture' | 'module_boundary' | 'entrypoint' | 'workflow' | 'testing' | 'convention' | 'release' | 'constraint'
export type RepoWikiEntryStatus = 'active' | 'stale' | 'archived' | 'rejected'

export interface RepoWikiGeneratedBy {
  providerProtocol: string
  modelId: string
  modelProfileId?: string
}

export interface RepoWikiEntry {
  id: string
  projectKey: string
  kind: RepoWikiEntryKind
  title: string
  content: string
  citations: ContextCitation[]
  relatedFiles: string[]
  relatedSymbols: string[]
  confidence: number
  freshness: ContextFreshness
  generatedBy: RepoWikiGeneratedBy
  evidenceHash: string
  status: RepoWikiEntryStatus
  createdAt: number
  updatedAt: number
  archivedAt?: number
  lifecycleReason?: string
}

export interface RepoWikiEntryQuery {
  kinds?: RepoWikiEntryKind[]
  includeStale?: boolean
  includeArchived?: boolean
  relatedFile?: string
  relatedSymbol?: string
  limit?: number
}

export interface RepoWikiSummary {
  activeEntries: number
  staleEntries: number
  lastGeneratedAt?: number
  lastModelId?: string
  lastDiagnostic?: string
}

export interface RepoWikiInvalidationResult {
  invalidatedEntries: number
}

export interface RepoWikiEvidencePacket {
  id: string
  ref: string
  title: string
  content: string
  hash: string
  line?: number
  relatedSymbols: string[]
}

export interface RepoWikiModelSection {
  kind: RepoWikiEntryKind
  title: string
  content: string
  citationPacketIds: string[]
  relatedFiles: string[]
  relatedSymbols: string[]
  confidence: number
}

export interface RepoWikiModelOutput {
  schemaVersion: 1
  action: 'save' | 'skip'
  reason?: string
  sections: RepoWikiModelSection[]
}

export interface RepoWikiJobStatus {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  startedAt: number
  completedAt?: number
  error?: string
  cancelable: false
}

export interface RepoWikiProviderHealthMetadata {
  summary: RepoWikiSummary
  generationJob?: RepoWikiJobStatus
  providerStatus: ContextProviderStatus
}
