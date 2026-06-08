import { z } from 'zod'
import type { ContentBlock, Message, ModelConfig, ToolDefinition } from '../../types.js'
import type { RepoWikiEvidenceBundle } from './evidence.js'

export interface RepoWikiModelRequest {
  cwd: string
  evidence: RepoWikiEvidenceBundle
  modelConfig: ModelConfig
  modelId: string
  cacheUser: string
  signal?: AbortSignal
}

export interface RepoWikiModelClient {
  completeRepoWiki(request: RepoWikiModelRequest): Promise<string>
}

const TextBlockSchema = z.object({ type: z.literal('text'), text: z.string() })

export function createProviderRepoWikiModelClient(provider: {
  chat(messages: Message[], tools: ToolDefinition[], config: ModelConfig, signal?: AbortSignal): Promise<{ content: ContentBlock[] }>
}, signal?: AbortSignal): RepoWikiModelClient {
  return {
    async completeRepoWiki(request) {
      const response = await provider.chat(
        [{
          id: `repo_wiki_${request.evidence.evidenceHash.slice(0, 16)}`,
          role: 'user',
          content: [{ type: 'text', text: buildRepoWikiPrompt(request) }],
          timestamp: request.evidence.createdAt,
        }],
        [],
        {
          ...request.modelConfig,
          model: request.modelId,
          systemPrompt: REPO_WIKI_SYSTEM_PROMPT,
          cacheKey: 'repo-wiki-generator:v1',
          cacheUser: request.cacheUser,
        },
        request.signal ?? signal,
      )
      return response.content
        .map((block) => TextBlockSchema.safeParse(block))
        .filter((parsed): parsed is z.SafeParseSuccess<z.infer<typeof TextBlockSchema>> => parsed.success)
        .map((parsed) => parsed.data.text)
        .join('\n')
    },
  }
}

export function buildRepoWikiPrompt(request: RepoWikiModelRequest): string {
  return JSON.stringify({
    task: 'Generate a JDC Repo Wiki as one strict JSON object.',
    schema: {
      schemaVersion: 1,
      action: 'save or skip',
      reason: 'string only when skipping',
      sections: [{
        kind: 'architecture | module_boundary | entrypoint | workflow | testing | convention | release | constraint',
        title: 'short title',
        content: 'concise, factual summary backed by cited packets',
        citationPacketIds: ['packet id strings from evidence.packets'],
        relatedFiles: ['file paths from cited packets'],
        relatedSymbols: ['symbols from evidence packets'],
        confidence: 'number > 0 and <= 1',
      }],
    },
    rules: [
      'Return JSON only.',
      'Every saved section must cite at least one hashed file or repository-document evidence packet id.',
      'The code-index packet is orientation context only; do not include it in citationPacketIds.',
      'Do not cite packet ids that are not in evidence.packets.',
      'Do not include hidden reasoning, chain of thought, secrets, markdown fences, or extra keys.',
      'Prefer sections that help future coding, review, debugging, testing, and planning tasks.',
      'If evidence is too small or contradictory, return {"schemaVersion":1,"action":"skip","reason":"insufficient_evidence","sections":[]}.',
    ],
    evidence: request.evidence,
  })
}

const REPO_WIKI_SYSTEM_PROMPT = 'You generate citation-backed repository Wiki JSON for JDC Context Engine. Use only provided evidence packet ids. Return JSON only. Do not include raw hidden reasoning.'
