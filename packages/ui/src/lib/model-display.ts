import type { ModelGroup, ModelEntry } from '../stores/model-store'

export function formatModelReference(
  value: string | undefined | null,
  groups: ModelGroup[],
  fallback = 'default',
): string {
  const raw = value?.trim()
  if (!raw) return fallback

  const composite = resolveComposite(raw, groups)
  if (composite) return formatConfiguredModel(composite.group, composite.model)

  const matches = collectMatches(raw, groups)
  if (matches.length === 1) return formatConfiguredModel(matches[0].group, matches[0].model)

  return raw
}

function resolveComposite(raw: string, groups: ModelGroup[]): { group: ModelGroup; model: ModelEntry } | null {
  const colon = raw.indexOf(':')
  if (colon <= 0) return null

  const groupToken = raw.slice(0, colon)
  const modelToken = raw.slice(colon + 1)
  const group = groups.find((candidate) => same(candidate.id, groupToken) || same(candidate.name, groupToken))
  if (!group) return null
  const model = group.models.find((candidate) =>
    same(candidate.id, modelToken) ||
    same(candidate.modelId, modelToken) ||
    same(candidate.name, modelToken)
  )
  return model ? { group, model } : null
}

function collectMatches(raw: string, groups: ModelGroup[]): Array<{ group: ModelGroup; model: ModelEntry }> {
  const matches: Array<{ group: ModelGroup; model: ModelEntry }> = []
  for (const group of groups) {
    for (const model of group.models) {
      if (same(model.id, raw) || same(model.modelId, raw) || same(model.name, raw)) {
        matches.push({ group, model })
      }
    }
  }
  return matches
}

function formatConfiguredModel(group: ModelGroup, model: ModelEntry): string {
  return `${group.name}:${model.name || model.modelId}`
}

function same(a: string | undefined, b: string): boolean {
  return Boolean(a && (a === b || a.toLocaleLowerCase() === b.toLocaleLowerCase()))
}
