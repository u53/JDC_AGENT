import type {
  ContextDiagnostic,
  ContextProviderId,
  ContextProviderStatus,
  HarvestStatus,
  ProviderHealth,
  SkipReason,
} from './types.js'

export interface ContextDiagnosticsOptions {
  now?: () => number
}

export interface HarvestAcceptedDiagnosticInput {
  jobId: string
  factIds: string[]
  source: string
}

export interface HarvestSkippedDiagnosticInput {
  jobId: string
  reason: SkipReason
  source: string
}

export interface HarvestRejectedDiagnosticInput {
  jobId: string
  reason: string
  source: string
  validationErrors?: string[]
  candidate?: unknown
}

export interface HarvestFailedDiagnosticInput {
  jobId: string
  error: unknown
  source: string
}

export interface ProviderHealthInput {
  id: ContextProviderId
  status: ContextProviderStatus
  message?: string
}

export interface ContextDiagnostics {
  recordHarvestAccepted(input: HarvestAcceptedDiagnosticInput): ContextDiagnostic
  recordHarvestSkipped(input: HarvestSkippedDiagnosticInput): ContextDiagnostic
  recordHarvestRejected(input: HarvestRejectedDiagnosticInput): ContextDiagnostic
  recordHarvestFailed(input: HarvestFailedDiagnosticInput): ContextDiagnostic
  updateProviderHealth(input: ProviderHealthInput): ProviderHealth
  listDiagnostics(): ContextDiagnostic[]
  listProviderHealth(): ProviderHealth[]
}

export function createContextDiagnostics(options: ContextDiagnosticsOptions = {}): ContextDiagnostics {
  return new InMemoryContextDiagnostics(options.now ?? Date.now)
}

class InMemoryContextDiagnostics implements ContextDiagnostics {
  private diagnostics: ContextDiagnostic[] = []
  private providerHealth = new Map<ContextProviderId, ProviderHealth>()

  constructor(private readonly now: () => number) {}

  recordHarvestAccepted(input: HarvestAcceptedDiagnosticInput): ContextDiagnostic {
    return this.pushDiagnostic({
      id: this.harvestDiagnosticId(input.jobId, 'accepted'),
      level: 'info',
      source: input.source,
      message: `Harvest job ${input.jobId} accepted ${input.factIds.length} context fact(s).`,
      createdAt: this.now(),
    })
  }

  recordHarvestSkipped(input: HarvestSkippedDiagnosticInput): ContextDiagnostic {
    return this.pushDiagnostic({
      id: this.harvestDiagnosticId(input.jobId, 'skipped'),
      level: 'info',
      source: input.source,
      message: `Harvest job ${input.jobId} skipped: ${input.reason}.`,
      createdAt: this.now(),
    })
  }

  recordHarvestRejected(input: HarvestRejectedDiagnosticInput): ContextDiagnostic {
    const validation = input.validationErrors?.length ? ` Validation: ${input.validationErrors.join('; ')}.` : ''
    return this.pushDiagnostic({
      id: this.harvestDiagnosticId(input.jobId, 'rejected'),
      level: 'warning',
      source: input.source,
      message: `Harvest job ${input.jobId} rejected: ${sanitizeDiagnosticText(input.reason)}.${validation}`,
      createdAt: this.now(),
    })
  }

  recordHarvestFailed(input: HarvestFailedDiagnosticInput): ContextDiagnostic {
    return this.pushDiagnostic({
      id: this.harvestDiagnosticId(input.jobId, 'failed'),
      level: 'error',
      source: input.source,
      message: `Harvest job ${input.jobId} failed: ${sanitizeDiagnosticText(errorMessage(input.error))}.`,
      createdAt: this.now(),
    })
  }

  updateProviderHealth(input: ProviderHealthInput): ProviderHealth {
    const updatedAt = this.now()
    const diagnostic = this.createProviderDiagnostic(input, updatedAt)
    const health: ProviderHealth = diagnostic
      ? { id: input.id, status: input.status, updatedAt, diagnostic }
      : { id: input.id, status: input.status, updatedAt }
    this.providerHealth.set(input.id, health)
    if (diagnostic) this.pushDiagnostic(diagnostic)
    return health
  }

  listDiagnostics(): ContextDiagnostic[] {
    return [...this.diagnostics]
  }

  listProviderHealth(): ProviderHealth[] {
    return [...this.providerHealth.values()]
  }

  private createProviderDiagnostic(input: ProviderHealthInput, createdAt: number): ContextDiagnostic | undefined {
    if (input.status === 'enabled' || input.status === 'fresh') return undefined
    const level = input.status === 'failed' ? 'error' : input.status === 'disabled' ? 'info' : 'warning'
    const message = input.message ?? `Provider ${input.id} is ${input.status}.`
    return {
      id: `diagnostic_provider_${input.id}_${createdAt}`,
      level,
      source: `ProviderHealth:${input.id}`,
      message: sanitizeDiagnosticText(message),
      createdAt,
    }
  }

  private pushDiagnostic(diagnostic: ContextDiagnostic): ContextDiagnostic {
    this.diagnostics.push(diagnostic)
    return diagnostic
  }

  private harvestDiagnosticId(jobId: string, status: HarvestStatus): string {
    return `diagnostic_harvest_${jobId}_${status}_${this.now()}`
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sanitizeDiagnosticText(value: string): string {
  return value.replace(/(raw[_ -]?thinking|chain[-_ ]of[-_ ]thought|reasoning(?:_summary)?)/gi, '[redacted reasoning]')
}
