import { v4 as uuid } from 'uuid'
import type { ModelProvider } from '../model-provider.js'
import type { ModelConfig, Message } from '../types.js'
import type { SkillDefinition } from '../skills/index.js'

/**
 * SkillRouter — looks at the team's objective and the user's installed skills,
 * picks at most ONE skill for the PM (dialogue/process methodology) and at
 * most ONE skill for workers (execution methodology). Returns null fields
 * when no skill is a clear fit.
 *
 * Design constraints (why this is "safe"):
 *   - Only the skill `name` and `description` are sent to the router model
 *     (NOT the skill content). Output is constrained to a tiny JSON shape.
 *   - The router only nominates skills. Whether/how the content is injected
 *     is decided by the caller — and the injection target (PM prompt /
 *     worker task description) is plain TEXT, not an executable bridge.
 *   - On any error we return {pmSkill: null, workerSkill: null} — failing
 *     open is fine because the team can still run without skill guidance.
 */

export interface SkillRouterDecision {
  pmSkill: string | null
  workerSkill: string | null
  reasoning?: string
}

export interface SkillRouterDeps {
  provider: ModelProvider
  modelConfig: ModelConfig
  /** Optional sink for the one LLM turn this router makes. */
  onUsage?: (usage: { inputTokens: number; outputTokens: number; cacheCreationInputTokens?: number; cacheReadInputTokens?: number }) => void
}

const ROUTER_SYSTEM = `You are a skill router for a multi-agent coding assistant.

You are shown:
- The user's objective for a multi-agent team that is about to start.
- A catalog of installed skills (name + one-line description each).

Your job: pick AT MOST ONE skill for each of two slots:

1. **PM slot** — a "dialogue / process / methodology" skill that should guide how the project manager *thinks and talks to the user*. Good fits: brainstorming, debugging methodology, planning, requirements gathering. Skills meant for executing work (writing code, designing UI) DO NOT belong here.

2. **Worker slot** — an "execution methodology" skill that should guide how individual workers *do the work*. Good fits: frontend-design, writing-plans, refactoring guides, code-review checklists, pattern libraries. Meta/recursive skills (e.g. "find more skills", "use superpowers", "spawn subagents") DO NOT belong here.

Most teams need NEITHER. Only nominate a skill when its description CLEARLY matches the user's objective. When unsure, return null.

# Output protocol

Return EXACTLY one JSON object on a single line, no prose, no code fences:

{"pmSkill": "<name or null>", "workerSkill": "<name or null>", "reasoning": "<one short sentence>"}

Both fields default to null. Only nominate a skill that exists in the catalog. Do not invent names.`

function buildUserMessage(objective: string, skills: SkillDefinition[]): string {
  const catalog = skills
    .map(s => `- ${s.name}: ${(s.description || '').slice(0, 240)}`)
    .join('\n')
  return `# Team objective\n\n${objective}\n\n# Installed skills\n\n${catalog || '(none)'}\n\n# Decide`
}

function parseRouterOutput(raw: string, valid: Set<string>): SkillRouterDecision {
  const text = raw.trim()
  // Find first {...} block; tolerate code fences if a model adds them.
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return { pmSkill: null, workerSkill: null }
  let parsed: any
  try { parsed = JSON.parse(match[0]) } catch { return { pmSkill: null, workerSkill: null } }
  const pm = typeof parsed.pmSkill === 'string' && valid.has(parsed.pmSkill) ? parsed.pmSkill : null
  const worker = typeof parsed.workerSkill === 'string' && valid.has(parsed.workerSkill) ? parsed.workerSkill : null
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined
  return { pmSkill: pm, workerSkill: worker, reasoning }
}

export async function routeSkills(
  objective: string,
  skills: SkillDefinition[],
  deps: SkillRouterDeps,
  signal?: AbortSignal,
): Promise<SkillRouterDecision> {
  if (skills.length === 0) return { pmSkill: null, workerSkill: null }

  const valid = new Set(skills.map(s => s.name))
  const messages: Message[] = [
    {
      id: uuid(),
      role: 'user',
      content: [{ type: 'text', text: buildUserMessage(objective, skills) }],
      timestamp: Date.now(),
    },
  ]

  const config: ModelConfig = {
    ...deps.modelConfig,
    systemPrompt: [{ content: ROUTER_SYSTEM, cacheable: true }],
    cacheKey: deps.modelConfig.cacheKey ?? 'skill-router',
    maxTokens: 256,
  }

  try {
    let responseText = ''
    const stream = deps.provider.stream(messages, [], config, signal)
    for await (const chunk of stream) {
      if (chunk.type === 'text_delta' && chunk.text) responseText += chunk.text
      else if (chunk.type === 'message_end' && chunk.usage) deps.onUsage?.(chunk.usage)
    }
    return parseRouterOutput(responseText, valid)
  } catch {
    // Failing open: team runs without skill injection.
    return { pmSkill: null, workerSkill: null }
  }
}
