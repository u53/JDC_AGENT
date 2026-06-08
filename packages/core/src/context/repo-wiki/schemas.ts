import { z } from 'zod'
import { ContextCitationSchema, ContextFreshnessSchema } from '../schemas.js'
import type { RepoWikiEntry, RepoWikiModelOutput } from './types.js'

export const RepoWikiEntryKindSchema = z.enum(['architecture', 'module_boundary', 'entrypoint', 'workflow', 'testing', 'convention', 'release', 'constraint'])
export const RepoWikiEntryStatusSchema = z.enum(['active', 'stale', 'archived', 'rejected'])

export const RepoWikiGeneratedBySchema = z.object({
  providerProtocol: z.string().min(1),
  modelId: z.string().min(1),
  modelProfileId: z.string().min(1).optional(),
})

export const RepoWikiEntrySchema = z.object({
  id: z.string().min(1),
  projectKey: z.string().min(1),
  kind: RepoWikiEntryKindSchema,
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(4_000),
  citations: z.array(ContextCitationSchema).min(1),
  relatedFiles: z.array(z.string().min(1)),
  relatedSymbols: z.array(z.string().min(1)),
  confidence: z.number().finite().gt(0).lte(1),
  freshness: ContextFreshnessSchema,
  generatedBy: RepoWikiGeneratedBySchema,
  evidenceHash: z.string().min(1),
  status: RepoWikiEntryStatusSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  archivedAt: z.number().int().nonnegative().optional(),
  lifecycleReason: z.string().min(1).optional(),
}) satisfies z.ZodType<RepoWikiEntry>

export const RepoWikiModelOutputSchema = z.object({
  schemaVersion: z.literal(1),
  action: z.enum(['save', 'skip']),
  reason: z.string().optional(),
  sections: z.array(z.object({
    kind: RepoWikiEntryKindSchema,
    title: z.string().min(1).max(160),
    content: z.string().min(1).max(4_000),
    citationPacketIds: z.array(z.string().min(1)).min(1),
    relatedFiles: z.array(z.string().min(1)),
    relatedSymbols: z.array(z.string().min(1)),
    confidence: z.number().finite().gt(0).lte(1),
  })).max(24),
}).refine((output) => output.action === 'skip' || output.sections.length > 0, 'save output requires at least one section') satisfies z.ZodType<RepoWikiModelOutput>
