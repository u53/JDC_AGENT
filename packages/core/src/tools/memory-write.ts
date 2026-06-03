import { createHash } from 'node:crypto'
import path from 'node:path'
import { z } from 'zod'
import type { ToolContext, ToolHandler, ToolResult } from '../tool-registry.js'
import { ContextCitationSchema, ContextDiagnosticSchema, EvidenceKindSchema, MemoryRecordKindSchema, MemoryRecordSchema } from '../context/schemas.js'
import { openContextStore, type ContextStore } from '../context/store.js'
import { containsRawReasoningData } from '../context/redaction.js'
import type { ContextCitation, ContextDiagnostic, ContextFact, MemoryRecord, RawEvidence } from '../context/types.js'
import { contextFactKindFromMemoryKind, memoryRecordFromFact } from './memory-search.js'

const DurableMemoryWriteScopeSchema = z.enum(['global', 'project', 'repo'])

const MemoryWriteInputSchema = z.preprocess(normalizeMemoryWriteInput, z.object({
  id: z.string().optional(),
  kind: MemoryRecordKindSchema,
  scope: DurableMemoryWriteScopeSchema.default('project'),
  content: z.string().min(1),
  citations: z.preprocess(normalizeCitationInput, z.array(ContextCitationSchema).min(1)),
  confidence: z.coerce.number().finite().gt(0).lte(1),
  expiresAt: z.number().int().nonnegative().optional(),
}))

export type MemoryWriteInput = z.infer<typeof MemoryWriteInputSchema>
export type MemoryWritePayload = {
  status: 'accepted' | 'rejected' | 'unavailable'
  writtenAt: number
  record: MemoryRecord | null
  diagnostics: ContextDiagnostic[]
}

export const MemoryWritePayloadSchema: z.ZodType<MemoryWritePayload> = z.object({
  status: z.enum(['accepted', 'rejected', 'unavailable']),
  writtenAt: z.number(),
  record: MemoryRecordSchema.nullable(),
  diagnostics: z.array(ContextDiagnosticSchema),
})

export interface MemoryWriteOptions {
  store?: ContextStore
  cwd?: string
  now?: () => number
}

export async function writeMemoryRecord(input: unknown, options: MemoryWriteOptions = {}): Promise<MemoryWritePayload> {
  const now = options.now ?? Date.now
  const parsed = MemoryWriteInputSchema.safeParse(input)
  if (!parsed.success) return rejectedPayload(now(), [diagnostic(`Memory write rejected: ${parsed.error.message}`, 'warning', now)])
  if (containsRawReasoningData(parsed.data)) return rejectedPayload(now(), [diagnostic('Memory write rejected: raw thinking/reasoning data cannot become durable memory.', 'warning', now)])

  const writtenAt = now()
  const fact = factFromMemoryInput(parsed.data, writtenAt, options.cwd)
  try {
    const store = options.store ?? await openContextStore({ cwd: options.cwd })
    const syntheticEvidence = syntheticEvidenceFromInput(input, parsed.data.citations, options.cwd, writtenAt)
    for (const evidence of syntheticEvidence) {
      const savedEvidence = await store.saveRawEvidence(evidence)
      if (!savedEvidence.ok) return MemoryWritePayloadSchema.parse({ status: 'rejected', writtenAt, record: null, diagnostics: savedEvidence.diagnostics })
    }
    const saved = await store.saveFact(fact)
    if (!saved.ok) return MemoryWritePayloadSchema.parse({ status: 'rejected', writtenAt, record: null, diagnostics: saved.diagnostics })
    return MemoryWritePayloadSchema.parse({ status: 'accepted', writtenAt, record: memoryRecordFromFact(fact), diagnostics: saved.diagnostics })
  } catch (error) {
    return MemoryWritePayloadSchema.parse({ status: 'unavailable', writtenAt, record: null, diagnostics: [diagnostic(error instanceof Error ? error.message : String(error), 'error', now)] })
  }
}

export function createMemoryWriteTool(options: MemoryWriteOptions = {}): ToolHandler {
  return {
    definition: {
      name: 'JdcMemoryWrite',
      description: [
        'Write an accepted, citation-backed JDC Context Engine memory fact into the current project store.',
        'Use only when the user explicitly asks to remember/save a durable project rule, workflow convention, architecture decision, known issue, or preference.',
        'Default scope is project for project conventions and repo-specific workflow rules.',
        'Do not write greetings, guesses, uncited summaries, secrets, raw thinking/reasoning, or transient one-turn state.',
        'Requires citations with id/type/ref, optional line/range/timestamp/hash, or a citation string shortcut. Data persists under <project>/.jdcagnet/context-engine/context.db.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          kind: { type: 'string', enum: MemoryRecordKindSchema.options },
          scope: { type: 'string', enum: DurableMemoryWriteScopeSchema.options, default: 'project', description: 'Durable memory scope. Defaults to project.' },
          content: { type: 'string' },
          citations: {
            oneOf: [
              {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    type: { type: 'string', enum: EvidenceKindSchema.options },
                    ref: { type: 'string' },
                    line: { type: 'number' },
                    range: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
                    timestamp: { type: 'number' },
                    hash: { type: 'string' },
                  },
                  required: ['id', 'type', 'ref'],
                },
              },
              {
                type: 'string',
                description: 'Shortcut for the user message or tool evidence that supports this fact; converted to a message citation.',
              },
            ],
            description: 'Required evidence citation objects, or a citation string shortcut.',
          },
          confidence: { oneOf: [{ type: 'number' }, { type: 'string' }], description: 'Confidence in (0, 1]; strings are coerced.' },
          expiresAt: { type: 'number' },
        },
        required: ['kind', 'content', 'citations', 'confidence'],
      },
    },
    async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
      const payload = await writeMemoryRecord(input, { ...options, cwd: context.cwd })
      return { content: JSON.stringify(payload, null, 2), isError: payload.status !== 'accepted' }
    },
  }
}

function factFromMemoryInput(input: MemoryWriteInput, now: number, cwd: string | undefined): ContextFact {
  return {
    id: input.id ?? `memory_${hashMemoryInput(input).slice(0, 16)}`,
    kind: contextFactKindFromMemoryKind(input.kind),
    scope: input.scope,
    content: input.content,
    citations: input.citations,
    confidence: input.confidence,
    freshness: 'recent',
    sourceProvider: 'JdcMemoryWrite',
    createdAt: now,
    updatedAt: now,
    expiresAt: input.expiresAt,
    origin: memoryWriteOrigin(input, cwd),
  }
}

function memoryWriteOrigin(input: MemoryWriteInput, cwd: string | undefined): ContextFact['origin'] {
  const actor = input.citations.some((citation) => citation.type === 'message') ? 'user' : 'main_session'
  return {
    projectKey: path.resolve(cwd ?? process.cwd()),
    actor,
  }
}

function normalizeMemoryWriteInput(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const record = input as Record<string, unknown>
  if (record.citations !== undefined || record.citation === undefined) return input
  return { ...record, citations: record.citation }
}

function normalizeCitationInput(input: unknown): unknown {
  if (typeof input === 'string') return [citationFromText(input)]
  if (input && typeof input === 'object' && !Array.isArray(input)) return [input]
  return input
}

function citationFromText(text: string): ContextCitation {
  const hash = hashText(text).slice(0, 16)
  return {
    id: `cit_memory_write_${hash}`,
    type: 'message',
    ref: `memory_write:${hash}`,
  }
}

function syntheticEvidenceFromInput(input: unknown, citations: ContextCitation[], cwd: string | undefined, capturedAt: number): RawEvidence[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return []
  const record = input as Record<string, unknown>
  const citationText = typeof record.citations === 'string'
    ? record.citations
    : typeof record.citation === 'string'
      ? record.citation
      : ''
  if (!citationText) return []
  return citations
    .filter((citation) => citation.type === 'message' && citation.ref.startsWith('memory_write:'))
    .map((citation) => ({
      id: `evidence_${citation.id}`,
      sessionId: 'memory_write',
      cwd: cwd ?? process.cwd(),
      sourceProvider: 'JdcMemoryWrite',
      kind: 'message',
      content: citationText,
      metadata: { messageId: citation.ref, synthetic: true },
      capturedAt,
      hash: hashText(citationText),
    }))
}

function hashMemoryInput(input: MemoryWriteInput): string {
  return createHash('sha256').update(JSON.stringify({ kind: input.kind, scope: input.scope, content: input.content, citations: input.citations })).digest('hex')
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function rejectedPayload(writtenAt: number, diagnostics: ContextDiagnostic[]): MemoryWritePayload {
  return MemoryWritePayloadSchema.parse({ status: 'rejected', writtenAt, record: null, diagnostics })
}

function diagnostic(message: string, level: ContextDiagnostic['level'], now: () => number): ContextDiagnostic {
  return { id: `diag_memory_write_${now()}_${Math.random().toString(36).slice(2)}`, level, source: 'JdcMemoryWrite', message, createdAt: now() }
}

export type { MemoryRecord }
