import type { ModelProvider } from './model-provider.js'
import type { ModelConfig } from './types.js'

export interface ConfiguredModelGroup {
  id: string
  name?: string
  protocol?: string
  baseUrl?: string
  baseURL?: string
  apiKey?: string
  models?: ConfiguredModelEntry[]
}

export interface ConfiguredModelEntry {
  id: string
  modelId: string
  name?: string
  maxTokens?: number
  contextWindow?: number
  compressAt?: number
}

export interface ResolvedConfiguredModel {
  group: ConfiguredModelGroup
  groupId: string
  groupName?: string
  protocol?: string
  baseUrl?: string
  modelEntryId: string
  modelId: string
  name?: string
  maxTokens: number
  contextWindow: number
  compressAt: number
}

export type ConfiguredModelResolution =
  | { status: 'resolved'; model: ResolvedConfiguredModel; message?: string }
  | { status: 'not_found'; message: string; matches: [] }
  | { status: 'ambiguous'; message: string; matches: ResolvedConfiguredModel[] }

export type RuntimeModelResolution =
  | { status: 'resolved'; provider: ModelProvider; modelConfig: ModelConfig; warning?: string }
  | { status: 'failed'; warning: string }

export function resolveConfiguredModel(groups: ConfiguredModelGroup[] | undefined, request: string): ConfiguredModelResolution {
  const requested = request.trim()
  if (!requested || !Array.isArray(groups)) {
    return { status: 'not_found', message: `Configured model "${request}" was not found.`, matches: [] }
  }

  const composite = resolveComposite(groups, requested)
  if (composite) return composite

  const byUuid = collect(groups, model => model.id === requested)
  if (byUuid.length === 1) return { status: 'resolved', model: byUuid[0] }
  if (byUuid.length > 1) return ambiguous(requested, byUuid)

  const byApiModelId = collect(groups, model => model.modelId === requested)
  if (byApiModelId.length === 1) return { status: 'resolved', model: byApiModelId[0] }
  if (byApiModelId.length > 1) return ambiguous(requested, byApiModelId)

  const byDisplayName = collect(groups, model => model.name === requested)
  if (byDisplayName.length === 1) return { status: 'resolved', model: byDisplayName[0] }
  if (byDisplayName.length > 1) return ambiguous(requested, byDisplayName)

  return { status: 'not_found', message: `Configured model "${requested}" was not found.`, matches: [] }
}

function resolveComposite(groups: ConfiguredModelGroup[], requested: string): ConfiguredModelResolution | null {
  const colon = requested.indexOf(':')
  if (colon <= 0) return null
  const groupId = requested.slice(0, colon)
  const modelId = requested.slice(colon + 1)
  const group = groups.find(g => g.id === groupId)
  if (!group) return { status: 'not_found', message: `Configured model group "${groupId}" was not found for "${requested}".`, matches: [] }
  const model = group.models?.find(m => m.modelId === modelId || m.id === modelId || m.name === modelId)
  if (!model) return { status: 'not_found', message: `Configured model "${modelId}" was not found in group "${groupId}".`, matches: [] }
  return { status: 'resolved', model: toResolved(group, model) }
}

function collect(groups: ConfiguredModelGroup[], predicate: (model: ConfiguredModelEntry, group: ConfiguredModelGroup) => boolean): ResolvedConfiguredModel[] {
  const matches: ResolvedConfiguredModel[] = []
  for (const group of groups) {
    for (const model of group.models ?? []) {
      if (predicate(model, group)) matches.push(toResolved(group, model))
    }
  }
  return matches
}

function toResolved(group: ConfiguredModelGroup, model: ConfiguredModelEntry): ResolvedConfiguredModel {
  return {
    group,
    groupId: group.id,
    groupName: group.name,
    protocol: group.protocol,
    baseUrl: group.baseUrl ?? group.baseURL,
    modelEntryId: model.id,
    modelId: model.modelId,
    name: model.name,
    maxTokens: model.maxTokens || 32000,
    contextWindow: model.contextWindow || 200000,
    compressAt: model.compressAt || 0.9,
  }
}

function ambiguous(requested: string, matches: ResolvedConfiguredModel[]): ConfiguredModelResolution {
  const choices = matches.map(m => `${m.groupId}:${m.modelId}`).join(', ')
  return {
    status: 'ambiguous',
    message: `Configured model "${requested}" is ambiguous. Use one of: ${choices}.`,
    matches,
  }
}
