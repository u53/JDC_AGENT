import { z } from 'zod'
import type { ContentBlock, Message, ModelConfig, ToolDefinition } from '../../types.js'
import type { DistillerOutput, HarvestCandidate, HarvestModelBinding } from '../types.js'
import { validateDistillerOutput } from '../schemas.js'

export interface DistillerModelRequest {
  distiller: string
  candidate: HarvestCandidate
  binding: HarvestModelBinding
  maxOutputTokens?: number
  signal?: AbortSignal
}

export interface DistillerModelClient {
  completeAnthropicMessages(request: DistillerModelRequest): Promise<string>
  completeOpenAIChatCompletions(request: DistillerModelRequest): Promise<string>
  completeOpenAIResponses(request: DistillerModelRequest): Promise<string>
}

const TextBlockSchema = z.object({ type: z.literal('text'), text: z.string() })

export function createProviderDistillerModelClient(provider: {
  chat(messages: Message[], tools: ToolDefinition[], config: ModelConfig, signal?: AbortSignal): Promise<{ content: ContentBlock[] }>
}, signal?: AbortSignal): DistillerModelClient {
  const complete = async (request: DistillerModelRequest) => {
    const response = await provider.chat(
      [
        {
          id: `distill_${request.candidate.runLoopId}`,
          role: 'user',
          content: [{ type: 'text', text: buildDistillerPrompt(request) }],
          timestamp: request.candidate.createdAt,
        },
      ],
      [],
      {
        ...request.binding.modelConfig,
        model: request.binding.modelId,
        maxTokens: request.maxOutputTokens ?? request.binding.modelConfig.maxTokens,
        systemPrompt: DISTILLER_SYSTEM_PROMPT,
        cacheKey: `harvest-distiller:${request.distiller}`,
        cacheUser: request.binding.sessionId,
      },
      request.signal ?? signal,
    )
    return response.content
      .map((block) => TextBlockSchema.safeParse(block))
      .filter((parsed): parsed is z.SafeParseSuccess<z.infer<typeof TextBlockSchema>> => parsed.success)
      .map((parsed) => parsed.data.text)
      .join('\n')
  }

  return {
    completeAnthropicMessages: complete,
    completeOpenAIChatCompletions: complete,
    completeOpenAIResponses: complete,
  }
}

export async function completeDistillerEnvelopeWithModel(request: DistillerModelRequest, client: DistillerModelClient): Promise<DistillerOutput> {
  const raw = await completeForProtocol(request, client)
  return parseDistillerOutputText(raw)
}

async function completeForProtocol(request: DistillerModelRequest, client: DistillerModelClient): Promise<string> {
  switch (request.binding.providerProtocol) {
    case 'anthropic':
      return client.completeAnthropicMessages(request)
    case 'openai-chat':
      return client.completeOpenAIChatCompletions(request)
    case 'openai-responses':
      return client.completeOpenAIResponses(request)
  }
}

export function parseDistillerEnvelopeText(raw: string): DistillerOutput {
  return parseDistillerOutputText(raw)
}

export function parseDistillerOutputText(raw: string): DistillerOutput {
  const jsonText = extractJsonObject(raw)
  const parsed = validateDistillerOutput(JSON.parse(jsonText))
  if (!parsed.success) throw new Error(`Model distiller output schema invalid: ${parsed.error.message}`)
  return parsed.data
}

function extractJsonObject(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] ?? raw
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('Model distiller output did not contain a JSON object')
  return candidate.slice(start, end + 1)
}

function buildDistillerPrompt(request: DistillerModelRequest): string {
  return JSON.stringify({
    task: `Return one strict JSON object for ${request.distiller}.`,
    requirements: [
      'schemaVersion must be 1 and distiller must equal the requested distiller name.',
      'If there is no durable, reusable, citation-backed project context worth storing, return {"schemaVersion":1,"distiller":"<name>","action":"skip","reason":"model_noop","confidence":0.9}.',
      'For durable output, return a DistillerEnvelope with confidence > 0 and <= 1, citations, and payload.',
      'Durable citations must cite only provided candidate message/tool/file references.',
      'Durable payload must match the requested distiller payload schema.',
      'Do not include raw thinking, reasoning, hidden chain-of-thought, secrets, markdown, or extra keys.',
    ],
    citationRefs: {
      userMessage: `${request.candidate.runLoopId}:user`,
      assistantMessages: request.candidate.assistantMessages.map((message) => message.id),
      toolEvents: request.candidate.toolEvents.map((event) => event.id),
      changedFiles: request.candidate.changedFiles,
    },
    candidate: request.candidate,
  })
}

const DISTILLER_SYSTEM_PROMPT = 'You produce durable JDC Context Engine structured summaries. Return JSON only. Never reveal or include raw hidden reasoning/thinking.'
