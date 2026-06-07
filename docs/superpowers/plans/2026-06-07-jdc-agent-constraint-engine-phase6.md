# JDC Agent Constraint Engine Phase 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add model capability profiles so JDC Agent Constraint Engine can tune prompt contracts, evidence strictness, and safe tool parallelism by provider/model without duplicating gate logic.

**Architecture:** Create a small model-profile resolver in `packages/core/src/model-profile.ts`, then thread the resolved profile into base prompt assembly, JDC Context Engine requests, agent contract sections, and session runtime parallelism. Phase 6 keeps existing Phase 1-5 gates as the source of truth; profiles only adjust strictness, verbosity, and execution shape.

**Tech Stack:** TypeScript, Vitest, existing `ModelConfig`, existing `Session`, existing `assembleSystemPrompt`, existing JDC Context Engine `ContextRequest`, existing `ParallelExecutor`, existing Phase 5 TurnEnd gate.

---

## Source Documents

- Design: `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`
- Phase 5 plan: `docs/superpowers/plans/2026-06-07-jdc-agent-constraint-engine-phase5.md`
- Latest Phase 5 hardening commit: `2a708f6 fix: infer cwd package scope for verification matching`

## Scope

This plan covers Phase 6 only:

- model profile registry;
- provider/model id matching;
- strict, standard, and relaxed profile behavior;
- profile-aware base prompt contract;
- profile-aware JDC Context Engine `agent_contract` section;
- profile-aware read-tool parallelism cap;
- product eval comparing strict and standard behavior;
- design document update.

This plan intentionally does not implement:

- UI observability panels;
- Repo Wiki;
- model-assisted final-claim checking;
- automatic hidden verification command execution;
- provider-specific API tuning beyond prompt/profile metadata;
- persistent user-facing profile management UI.

## Key Design Decision

Phase 6 is runtime adaptation, not vendor judgment. A profile is a deterministic product policy selected by provider/model id and optional config override. The same profile shape works for local models, hosted models, and future eval-derived defaults.

Profiles must not bypass existing gates:

```text
1. File mutation gates still enforce read-before-write.
2. Verification requirements still derive from changed files.
3. TurnEnd still appends disclosure for pending or failed verification.
4. Model profiles only tune prompt contract wording, evidence strictness labels, and safe parallelism.
```

## File Boundary Map

Create:

- `packages/core/src/model-profile.ts`
- `packages/core/src/model-profile.test.ts`

Modify:

- `packages/core/src/types.ts`
- `packages/core/src/context.ts`
- `packages/core/src/context-system-prompt.test.ts`
- `packages/core/src/base-prompt.ts`
- `packages/core/src/context/types.ts`
- `packages/core/src/context/schemas.ts`
- `packages/core/src/context/orchestrator.ts`
- `packages/core/src/context/context-orchestrator.test.ts`
- `packages/core/src/context/context-product-evals.test.ts`
- `packages/core/src/session.ts`
- `packages/core/src/session-context.test.ts`
- `packages/core/src/parallel-executor.ts`
- `packages/core/tests/parallel-executor.test.ts`
- `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`

## Global Acceptance Gates

Run these after the final task:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/model-profile.test.ts src/context-system-prompt.test.ts src/context/context-orchestrator.test.ts src/session-context.test.ts tests/parallel-executor.test.ts src/context/context-product-evals.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
pnpm --filter @jdcagnet/core test -- --run --no-file-parallelism
git diff --check
```

Expected final result: all commands pass.

---

## Task 1: Model Profile Registry And Resolver

**Goal:** Add deterministic model profile selection from provider id, model id, optional override, and optional configured profiles.

**Files:**

- Create: `packages/core/src/model-profile.ts`
- Create: `packages/core/src/model-profile.test.ts`

- [ ] **Step 1: Add failing resolver tests**

Create `packages/core/src/model-profile.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODEL_CAPABILITY_PROFILE_ID,
  resolveModelCapabilityProfile,
  strictToolGroundingProfile,
} from './model-profile.js'

describe('resolveModelCapabilityProfile', () => {
  it('returns the standard default profile for unknown models', () => {
    const profile = resolveModelCapabilityProfile({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-6',
    })

    expect(profile).toMatchObject({
      id: DEFAULT_MODEL_CAPABILITY_PROFILE_ID,
      evidenceStrictness: 'standard',
      contractVerbosity: 'normal',
      maxParallelToolCalls: 5,
    })
  })

  it('matches strict profiles by provider and model glob', () => {
    const profile = resolveModelCapabilityProfile({
      providerId: 'ollama',
      modelId: 'glm-4.5',
      profiles: [
        strictToolGroundingProfile({
          id: 'strict_local_glm',
          providerPattern: 'ollama',
          modelPattern: 'glm*',
        }),
      ],
    })

    expect(profile).toMatchObject({
      id: 'strict_local_glm',
      evidenceStrictness: 'strict',
      requiresCompactActionContracts: true,
      defaultPlanDepth: 'detailed',
      maxParallelToolCalls: 2,
    })
  })

  it('uses explicit override before pattern matching', () => {
    const profile = resolveModelCapabilityProfile({
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      overrideProfileId: 'strict_override',
      profiles: [
        strictToolGroundingProfile({
          id: 'strict_override',
          providerPattern: '*',
          modelPattern: '*',
        }),
      ],
    })

    expect(profile.id).toBe('strict_override')
    expect(profile.evidenceStrictness).toBe('strict')
  })

  it('falls back to default when override id is absent', () => {
    const profile = resolveModelCapabilityProfile({
      providerId: 'custom',
      modelId: 'unknown-model',
      overrideProfileId: 'missing_profile',
      profiles: [],
    })

    expect(profile.id).toBe(DEFAULT_MODEL_CAPABILITY_PROFILE_ID)
  })
})
```

- [ ] **Step 2: Run the resolver tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/model-profile.test.ts --no-file-parallelism
```

Expected: FAIL because `model-profile.ts` does not exist.

- [ ] **Step 3: Implement the profile resolver**

Create `packages/core/src/model-profile.ts`:

```ts
export type ModelProfileReliability = 'low' | 'medium' | 'high'
export type ModelEvidenceStrictness = 'strict' | 'standard' | 'relaxed'
export type ModelContractVerbosity = 'compact' | 'normal' | 'explicit'
export type ModelPlanDepth = 'brief' | 'normal' | 'detailed'

export interface ModelProfileMatch {
  providerPattern: string
  modelPattern: string
}

export interface ModelCapabilityProfile {
  id: string
  label: string
  match: ModelProfileMatch
  reasoningReliability: ModelProfileReliability
  toolDiscipline: ModelProfileReliability
  contextUseDiscipline: ModelProfileReliability
  evidenceStrictness: ModelEvidenceStrictness
  contractVerbosity: ModelContractVerbosity
  requiresCompactActionContracts: boolean
  defaultPlanDepth: ModelPlanDepth
  maxParallelToolCalls: number
  requireStepwiseVerification: boolean
}

export interface ResolveModelCapabilityProfileInput {
  providerId?: string
  modelId: string
  overrideProfileId?: string
  profiles?: ModelCapabilityProfile[]
}

export const DEFAULT_MODEL_CAPABILITY_PROFILE_ID = 'standard_default'

export const DEFAULT_MODEL_CAPABILITY_PROFILES: ModelCapabilityProfile[] = [
  {
    id: DEFAULT_MODEL_CAPABILITY_PROFILE_ID,
    label: 'Standard default',
    match: { providerPattern: '*', modelPattern: '*' },
    reasoningReliability: 'high',
    toolDiscipline: 'high',
    contextUseDiscipline: 'high',
    evidenceStrictness: 'standard',
    contractVerbosity: 'normal',
    requiresCompactActionContracts: false,
    defaultPlanDepth: 'normal',
    maxParallelToolCalls: 5,
    requireStepwiseVerification: false,
  },
]

export function strictToolGroundingProfile(input: {
  id: string
  providerPattern: string
  modelPattern: string
  label?: string
}): ModelCapabilityProfile {
  return {
    id: input.id,
    label: input.label ?? 'Strict tool grounding',
    match: { providerPattern: input.providerPattern, modelPattern: input.modelPattern },
    reasoningReliability: 'medium',
    toolDiscipline: 'medium',
    contextUseDiscipline: 'medium',
    evidenceStrictness: 'strict',
    contractVerbosity: 'explicit',
    requiresCompactActionContracts: true,
    defaultPlanDepth: 'detailed',
    maxParallelToolCalls: 2,
    requireStepwiseVerification: true,
  }
}

export function resolveModelCapabilityProfile(input: ResolveModelCapabilityProfileInput): ModelCapabilityProfile {
  const configured = sanitizeProfiles(input.profiles ?? [])
  const profiles = configured.length ? configured : DEFAULT_MODEL_CAPABILITY_PROFILES
  const fallback = profiles.find(profile => profile.id === DEFAULT_MODEL_CAPABILITY_PROFILE_ID) ?? DEFAULT_MODEL_CAPABILITY_PROFILES[0]

  if (input.overrideProfileId) {
    const override = profiles.find(profile => profile.id === input.overrideProfileId)
    if (override) return override
  }

  const providerId = normalizePatternInput(input.providerId ?? '')
  const modelId = normalizePatternInput(input.modelId)
  const matched = profiles.find(profile =>
    globMatches(profile.match.providerPattern, providerId) &&
    globMatches(profile.match.modelPattern, modelId)
  )
  return matched ?? fallback
}

function sanitizeProfiles(profiles: ModelCapabilityProfile[]): ModelCapabilityProfile[] {
  return profiles
    .filter(profile => profile.id && profile.match?.modelPattern)
    .map(profile => ({
      ...profile,
      maxParallelToolCalls: clampParallel(profile.maxParallelToolCalls),
    }))
}

function normalizePatternInput(value: string): string {
  return value.trim().toLowerCase()
}

function globMatches(pattern: string, value: string): boolean {
  const normalizedPattern = normalizePatternInput(pattern || '*')
  if (normalizedPattern === '*') return true
  const escaped = normalizedPattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(value)
}

function clampParallel(value: number): number {
  if (!Number.isFinite(value)) return 5
  return Math.max(1, Math.min(5, Math.floor(value)))
}
```

- [ ] **Step 4: Run focused resolver tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/model-profile.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/model-profile.ts packages/core/src/model-profile.test.ts
git commit -m "feat(core): add model capability profiles"
```

---

## Task 2: Profile-Aware Base Prompt Contract

**Goal:** Render a model profile section in the base prompt so the model sees strict, standard, or relaxed runtime expectations.

**Files:**

- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/context.ts`
- Modify: `packages/core/src/base-prompt.ts`
- Modify: `packages/core/src/context-system-prompt.test.ts`

- [ ] **Step 1: Add failing prompt tests**

Modify `packages/core/src/context-system-prompt.test.ts`:

```ts
import { assembleSystemPrompt, joinSegments, loadInstructionSources } from './context.js'
import { strictToolGroundingProfile } from './model-profile.js'
```

Add tests:

```ts
it('renders strict model profile adaptation in the system prompt', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-phase6-prompt-'))
  tmpDirs.push(cwd)
  const text = joinSegments(await assembleSystemPrompt({
    cwd,
    toolDefs: [],
    toolNames: [],
    modelProfile: strictToolGroundingProfile({
      id: 'strict_local',
      providerPattern: 'ollama',
      modelPattern: 'glm*',
    }),
  }))

  expect(text).toContain('# Model Profile Adaptation')
  expect(text).toContain('Profile: strict_local')
  expect(text).toContain('Evidence strictness: strict')
  expect(text).toContain('Use short, explicit, stepwise action contracts')
  expect(text).toContain('Prefer no more than 2 parallel read tool calls')
})

it('renders standard model profile adaptation without strict-only wording', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-phase6-prompt-'))
  tmpDirs.push(cwd)
  const text = joinSegments(await assembleSystemPrompt({
    cwd,
    toolDefs: [],
    toolNames: [],
    modelProfile: {
      id: 'standard_default',
      label: 'Standard default',
      match: { providerPattern: '*', modelPattern: '*' },
      reasoningReliability: 'high',
      toolDiscipline: 'high',
      contextUseDiscipline: 'high',
      evidenceStrictness: 'standard',
      contractVerbosity: 'normal',
      requiresCompactActionContracts: false,
      defaultPlanDepth: 'normal',
      maxParallelToolCalls: 5,
      requireStepwiseVerification: false,
    },
  }))

  expect(text).toContain('# Model Profile Adaptation')
  expect(text).toContain('Profile: standard_default')
  expect(text).toContain('Evidence strictness: standard')
  expect(text).not.toContain('Use short, explicit, stepwise action contracts')
})
```

The file already imports `mkdtempSync`, `tmpdir`, `path`, and maintains `tmpDirs`; reuse that existing cleanup pattern.

- [ ] **Step 2: Run prompt tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context-system-prompt.test.ts --no-file-parallelism
```

Expected: FAIL because `assembleSystemPrompt()` and `getBasePrompt()` do not accept or render `modelProfile`.

- [ ] **Step 3: Thread model profile through prompt types**

Modify `packages/core/src/types.ts`:

```ts
import type { ModelCapabilityProfile } from './model-profile.js'
```

Add to `ModelConfig`:

```ts
  modelProfile?: ModelCapabilityProfile
```

Modify `packages/core/src/context.ts`:

```ts
import type { ModelCapabilityProfile } from './model-profile.js'
```

Add to `ContextOptions`:

```ts
  modelProfile?: ModelCapabilityProfile
```

Pass the profile to `getBasePrompt()`:

```ts
    content: getBasePrompt({
      toolDefs: opts.toolDefs,
      environment: env,
      mcpServers: opts.mcpServers,
      permissionMode: opts.permissionMode,
      modelProfile: opts.modelProfile,
    }),
```

- [ ] **Step 4: Render model profile section**

Modify `packages/core/src/base-prompt.ts`:

```ts
import type { ModelCapabilityProfile } from './model-profile.js'
```

Add to `PromptOptions`:

```ts
  modelProfile?: ModelCapabilityProfile
```

Add this section after `getSystemSection(permissionMode)` in `getBasePrompt()`:

```ts
    getModelProfileSection(opts.modelProfile),
```

Add this function near `getSystemSection()`:

```ts
function getModelProfileSection(profile?: ModelCapabilityProfile): string {
  if (!profile) {
    return `# Model Profile Adaptation

Profile: standard_default
Evidence strictness: standard
Contract verbosity: normal
Parallel read tool preference: default

Use the normal JDC CODE operating contract. Existing runtime gates still enforce read-before-write and final verification disclosure.`
  }

  const lines = [
    '# Model Profile Adaptation',
    '',
    `Profile: ${profile.id}`,
    `Evidence strictness: ${profile.evidenceStrictness}`,
    `Contract verbosity: ${profile.contractVerbosity}`,
    `Default plan depth: ${profile.defaultPlanDepth}`,
    `Parallel read tool preference: no more than ${profile.maxParallelToolCalls} parallel read tool calls.`,
  ]

  if (profile.evidenceStrictness === 'strict') {
    lines.push(
      '',
      '- Use short, explicit, stepwise action contracts before edits.',
      '- Treat missing file or symbol evidence as blocking until a tool supplies it.',
      '- Prefer no more than 2 parallel read tool calls unless the task is pure discovery.',
      '- After mutation, run verification or clearly disclose why verification is pending.'
    )
  } else if (profile.evidenceStrictness === 'relaxed') {
    lines.push(
      '',
      '- You may use compact contracts when evidence is already present.',
      '- Runtime gates still control mutation and final verification disclosure.'
    )
  } else {
    lines.push(
      '',
      '- Use the normal JDC CODE operating contract.',
      '- Runtime gates still control mutation and final verification disclosure.'
    )
  }

  return lines.join('\n')
}
```

- [ ] **Step 5: Run focused prompt tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context-system-prompt.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/context.ts packages/core/src/base-prompt.ts packages/core/src/context-system-prompt.test.ts
git commit -m "feat(prompt): render model profile contracts"
```

---

## Task 3: Profile-Aware Agent Contract Section

**Goal:** Make JDC Context Engine `agent_contract` sections explicit for strict profiles and compact for standard or relaxed profiles.

**Files:**

- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/schemas.ts`
- Modify: `packages/core/src/context/orchestrator.ts`
- Modify: `packages/core/src/context/context-orchestrator.test.ts`

- [ ] **Step 1: Add failing agent contract tests**

Modify `packages/core/src/context/context-orchestrator.test.ts`:

```ts
import { strictToolGroundingProfile } from '../model-profile.js'
```

Add tests near the existing `renders an agent run contract when required evidence is missing` test:

```ts
it('renders explicit agent contract text for strict model profiles', async () => {
  const store = makeStore({ facts: [] })

  const result = await buildContextBundle({
    ...request,
    mode: 'code_edit',
    userMessage: '修复登录状态 bug',
    modelProfile: strictToolGroundingProfile({
      id: 'strict_local',
      providerPattern: 'ollama',
      modelPattern: 'glm*',
    }),
  }, {
    injectionEnabled: true,
    includeAgentContract: true,
    store,
    providers: [],
    now: () => 1_000,
    id: () => 'bundle_strict_agent_contract',
  })

  expect(result.renderedPrompt).toContain('Model profile: strict_local')
  expect(result.renderedPrompt).toContain('Evidence strictness: strict')
  expect(result.renderedPrompt).toContain('Strict profile instructions:')
  expect(result.renderedPrompt).toContain('Read target files before mutation.')
})

it('keeps standard agent contract compact', async () => {
  const store = makeStore({ facts: [] })

  const result = await buildContextBundle({
    ...request,
    mode: 'code_edit',
    userMessage: '修复登录状态 bug',
  }, {
    injectionEnabled: true,
    includeAgentContract: true,
    store,
    providers: [],
    now: () => 1_000,
    id: () => 'bundle_standard_agent_contract',
  })

  expect(result.renderedPrompt).toContain('Agent run contract')
  expect(result.renderedPrompt).not.toContain('Strict profile instructions:')
})
```

- [ ] **Step 2: Run orchestrator tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-orchestrator.test.ts --no-file-parallelism
```

Expected: FAIL because `ContextRequest` has no `modelProfile` and `agentContractSections()` does not render profile-specific content.

- [ ] **Step 3: Add profile metadata to context request types and schemas**

Modify `packages/core/src/context/types.ts`:

```ts
import type { ModelCapabilityProfile } from '../model-profile.js'
```

Add to `ContextRequest`:

```ts
  modelProfile?: ModelCapabilityProfile
```

Modify `packages/core/src/context/schemas.ts` near the request schema:

```ts
const ModelProfileSchema = z.object({
  id: nonEmptyStringSchema,
  label: z.string(),
  match: z.object({
    providerPattern: z.string(),
    modelPattern: z.string(),
  }),
  reasoningReliability: z.enum(['low', 'medium', 'high']),
  toolDiscipline: z.enum(['low', 'medium', 'high']),
  contextUseDiscipline: z.enum(['low', 'medium', 'high']),
  evidenceStrictness: z.enum(['strict', 'standard', 'relaxed']),
  contractVerbosity: z.enum(['compact', 'normal', 'explicit']),
  requiresCompactActionContracts: z.boolean(),
  defaultPlanDepth: z.enum(['brief', 'normal', 'detailed']),
  maxParallelToolCalls: z.number().int().min(1).max(5),
  requireStepwiseVerification: z.boolean(),
})
```

Add to `ContextRequestSchema`:

```ts
  modelProfile: ModelProfileSchema.optional(),
```

- [ ] **Step 4: Render profile-aware agent contract**

Modify `packages/core/src/context/orchestrator.ts`.

Change the call site:

```ts
      ...(includeAgentContract ? agentContractSections(plan, now(), requestWithRequirements.modelProfile) : []),
```

Change the function signature and content:

```ts
function agentContractSections(plan: ContextPlan, _createdAt: number, modelProfile?: ContextRequest['modelProfile']): ContextSection[] {
  if (!plan.missingEvidence.length) return []

  const content = [
    `Intent: ${plan.intent}`,
    `Objective: ${plan.objective}`,
    ...(modelProfile ? [
      `Model profile: ${modelProfile.id}`,
      `Evidence strictness: ${modelProfile.evidenceStrictness}`,
    ] : []),
    'Missing evidence:',
    ...plan.missingEvidence.map((missing) => `- ${missing.kind}: ${missing.reason}`),
    'Policy: Existing files must be read with fresh content before mutation.',
    ...agentContractProfileLines(modelProfile),
  ].join('\n')

  return [{
    id: `agent_contract_${plan.id}`,
    kind: 'agent_contract',
    title: 'Agent run contract',
    content,
    citations: [],
    priority: 100,
    confidence: 1,
    freshness: 'live',
    sourceProvider: 'JdcAgentConstraintEngine',
    tokenEstimate: Math.ceil(content.length / 4),
    ownership: { authority: 'system_instruction', topic: 'task', conflictPolicy: 'render' },
  }]
}

function agentContractProfileLines(modelProfile?: ContextRequest['modelProfile']): string[] {
  if (!modelProfile || modelProfile.evidenceStrictness !== 'strict') return []
  return [
    'Strict profile instructions:',
    '- Read target files before mutation.',
    '- Use one evidence-gathering step at a time when file targets are unclear.',
    '- Do not claim completion until verification has run or the final response discloses the gap.',
  ]
}
```

- [ ] **Step 5: Run focused orchestrator tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-orchestrator.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/context/types.ts packages/core/src/context/schemas.ts packages/core/src/context/orchestrator.ts packages/core/src/context/context-orchestrator.test.ts
git commit -m "feat(context): make agent contracts profile aware"
```

---

## Task 4: Session Profile Resolution And Prompt Wiring

**Goal:** Resolve the active model profile in `Session.sendMessage()` and pass it into system prompt assembly and context requests.

**Files:**

- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/session-context.test.ts`

- [ ] **Step 1: Add failing session tests**

Modify `packages/core/src/session-context.test.ts`.

Add a test inside `Session JDC Context Engine runtime integration`:

```ts
it('injects the resolved strict model profile into system and context prompts', async () => {
  let observedSystemPrompt = ''
  const session = await makeSession({
    provider: providerFromChunks([
      { type: 'text_delta', text: 'ok' },
      { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } },
    ], (_messages, config) => {
      observedSystemPrompt = textFromSystemPrompt(config.systemPrompt)
    }, 'ollama'),
    modelConfig: { model: 'glm-4.5', maxTokens: 1024, contextWindow: 128_000 },
    contextConfig: { enabled: true, injectionEnabled: true, providerToggles: {}, harvestEnabled: false } as any,
  })

  await session.sendMessage('修复 src/app.ts', makeEvents())

  expect(observedSystemPrompt).toContain('# Model Profile Adaptation')
  expect(observedSystemPrompt).toContain('Evidence strictness: strict')
  expect(observedSystemPrompt).toContain('Strict profile instructions:')
})
```

`textFromSystemPrompt()` already exists in the file and accepts `ModelConfig['systemPrompt']`; keep the call on `config.systemPrompt` because `providerFromChunks()` exposes provider config to the inspect callback.

- [ ] **Step 2: Run session-context tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts --no-file-parallelism
```

Expected: FAIL because `Session` does not resolve or pass model profiles.

- [ ] **Step 3: Resolve profile from app config and provider/model ids**

Modify `packages/core/src/session.ts` imports:

```ts
import { resolveModelCapabilityProfile, strictToolGroundingProfile, type ModelCapabilityProfile } from './model-profile.js'
```

Add a field to `Session`:

```ts
  private modelProfile?: ModelCapabilityProfile
```

Add a helper method inside `Session`:

```ts
  private resolveCurrentModelProfile(appConfig: Record<string, any>): ModelCapabilityProfile {
    const configuredProfiles = Array.isArray(appConfig.modelProfiles?.profiles)
      ? appConfig.modelProfiles.profiles
      : [
          strictToolGroundingProfile({
            id: 'strict_tool_grounding',
            providerPattern: 'ollama',
            modelPattern: 'glm*',
          }),
        ]
    return resolveModelCapabilityProfile({
      providerId: this.provider.name,
      modelId: this.config.modelConfig.model,
      overrideProfileId: typeof appConfig.modelProfiles?.overrideProfileId === 'string'
        ? appConfig.modelProfiles.overrideProfileId
        : undefined,
      profiles: configuredProfiles,
    })
  }
```

In `sendMessage()`, immediately after `const appConfig = loadAppConfig()`, add:

```ts
    this.modelProfile = this.resolveCurrentModelProfile(appConfig)
    this.config.modelConfig.modelProfile = this.modelProfile
```

Pass it into `assembleSystemPrompt()`:

```ts
      modelProfile: this.modelProfile,
```

- [ ] **Step 4: Add profile to context request**

In `createContextRequest()`, add to the returned object:

```ts
      modelProfile: this.modelProfile,
```

- [ ] **Step 5: Run focused session test**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session.ts packages/core/src/session-context.test.ts
git commit -m "feat(session): resolve model profiles for prompts"
```

---

## Task 5: Profile-Aware Read Tool Parallelism

**Goal:** Apply `maxParallelToolCalls` from the active profile to eager read-tool execution without changing write serialization.

**Files:**

- Modify: `packages/core/src/parallel-executor.ts`
- Modify: `packages/core/tests/parallel-executor.test.ts`
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/session-context.test.ts`

- [ ] **Step 1: Add failing parallel executor tests**

Modify `packages/core/tests/parallel-executor.test.ts`:

```ts
it('limits read tool concurrency from executor options', async () => {
  let active = 0
  let maxActive = 0
  const registry = new ToolRegistry()
  registry.register({
    definition: { name: 'Read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
    execute: async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 20))
      active -= 1
      return { content: 'ok' }
    },
  })
  const executor = new ParallelExecutor(createRunner(registry), { maxReadConcurrency: 2 })

  await executor.executeBatch([
    { type: 'tool_use', id: 'read_1', name: 'Read', input: {} },
    { type: 'tool_use', id: 'read_2', name: 'Read', input: {} },
    { type: 'tool_use', id: 'read_3', name: 'Read', input: {} },
    { type: 'tool_use', id: 'read_4', name: 'Read', input: {} },
  ], () => undefined)

  expect(maxActive).toBeLessThanOrEqual(2)
})

it('updates read tool concurrency after construction', async () => {
  let active = 0
  let maxActive = 0
  const registry = new ToolRegistry()
  registry.register({
    definition: { name: 'Read', description: 'Read', inputSchema: { type: 'object', properties: {} } },
    execute: async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 20))
      active -= 1
      return { content: 'ok' }
    },
  })
  const executor = new ParallelExecutor(createRunner(registry))
  executor.setMaxReadConcurrency(1)

  await executor.executeBatch([
    { type: 'tool_use', id: 'read_1', name: 'Read', input: {} },
    { type: 'tool_use', id: 'read_2', name: 'Read', input: {} },
  ], () => undefined)

  expect(maxActive).toBe(1)
})
```

- [ ] **Step 2: Run parallel executor tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run tests/parallel-executor.test.ts --no-file-parallelism
```

Expected: FAIL because `ParallelExecutor` has a fixed read concurrency and no setter.

- [ ] **Step 3: Make read concurrency configurable**

Modify `packages/core/src/parallel-executor.ts`.

Replace:

```ts
const MAX_CONCURRENCY = 5
```

With:

```ts
const DEFAULT_MAX_READ_CONCURRENCY = 5
```

Change the class constructor:

```ts
export class ParallelExecutor {
  private maxReadConcurrency: number

  constructor(private toolRunner: ToolRunner, options: { maxReadConcurrency?: number } = {}) {
    this.maxReadConcurrency = clampReadConcurrency(options.maxReadConcurrency ?? DEFAULT_MAX_READ_CONCURRENCY)
  }

  setMaxReadConcurrency(limit: number): void {
    this.maxReadConcurrency = clampReadConcurrency(limit)
  }
```

Change the semaphore construction:

```ts
      const semaphore = new Semaphore(this.maxReadConcurrency)
```

Add near the bottom:

```ts
function clampReadConcurrency(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_MAX_READ_CONCURRENCY
  return Math.max(1, Math.min(DEFAULT_MAX_READ_CONCURRENCY, Math.floor(limit)))
}
```

- [ ] **Step 4: Apply profile parallelism in Session**

Modify `packages/core/src/session.ts`.

After `this.modelProfile = this.resolveCurrentModelProfile(appConfig)`, add:

```ts
    this.parallelExecutor.setMaxReadConcurrency(this.modelProfile.maxParallelToolCalls)
```

Add a focused session test if the existing provider/tool helpers make it straightforward:

```ts
it('applies strict profile read concurrency to the parallel executor', async () => {
  const session = await makeSession({
    provider: providerFromChunks([
      { type: 'text_delta', text: 'ok' },
      { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } },
    ], undefined, 'ollama'),
    modelConfig: { model: 'glm-4.5', maxTokens: 1024, contextWindow: 128_000 },
    contextConfig: { enabled: false } as any,
  })

  await session.sendMessage('hi', makeEvents())

  expect((session as any).parallelExecutor.maxReadConcurrency).toBe(2)
})
```

- [ ] **Step 5: Run focused parallelism tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run tests/parallel-executor.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/parallel-executor.ts packages/core/tests/parallel-executor.test.ts packages/core/src/session.ts packages/core/src/session-context.test.ts
git commit -m "feat(core): tune read parallelism by model profile"
```

---

## Task 6: Product Evals And Design Decision

**Goal:** Lock Phase 6 behavior into product evals and record the implementation decision.

**Files:**

- Modify: `packages/core/src/context/context-product-evals.test.ts`
- Modify: `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`

- [ ] **Step 1: Add product eval comparing strict and standard contracts**

Modify `packages/core/src/context/context-product-evals.test.ts`:

```ts
import { strictToolGroundingProfile } from '../model-profile.js'
```

Add tests near the Phase 5 evals:

```ts
it('Phase 6 eval: strict model profile renders explicit evidence contract', async () => {
  const result = await buildContextBundle(makeEvalRequest({
    mode: 'code_edit',
    userMessage: '修复登录状态 bug',
    modelProfile: strictToolGroundingProfile({
      id: 'strict_eval',
      providerPattern: 'ollama',
      modelPattern: 'glm*',
    }),
  }), {
    injectionEnabled: true,
    includeAgentContract: true,
    store: makeEvalStore(),
    providers: [],
    now: () => 1_000,
    id: () => 'phase6_strict_contract',
  })

  expect(result.renderedPrompt).toContain('Model profile: strict_eval')
  expect(result.renderedPrompt).toContain('Evidence strictness: strict')
  expect(result.renderedPrompt).toContain('Strict profile instructions:')
})

it('Phase 6 eval: standard profile avoids strict-only contract noise', async () => {
  const result = await buildContextBundle(makeEvalRequest({
    mode: 'code_edit',
    userMessage: '修复登录状态 bug',
  }), {
    injectionEnabled: true,
    includeAgentContract: true,
    store: makeEvalStore(),
    providers: [],
    now: () => 1_000,
    id: () => 'phase6_standard_contract',
  })

  expect(result.renderedPrompt).toContain('Agent run contract')
  expect(result.renderedPrompt).not.toContain('Strict profile instructions:')
})
```

- [ ] **Step 2: Update design document**

Modify `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md` near the existing Phase implementation decision notes:

```md
Phase 6 implementation decision:

- Model capability profiles are deterministic runtime policy records selected by provider id, model id, optional override, and configured profile list.
- Profiles tune evidence strictness, prompt-contract verbosity, default plan depth, and read-tool parallelism.
- Profiles do not bypass Phase 1-5 gates; file mutation, verification requirement derivation, command-result tracking, and TurnEnd disclosure remain authoritative.
- Strict profiles render explicit model-visible instructions in both the base prompt and the JDC Context Engine `agent_contract` section.
- Standard profiles keep the contract compact and avoid strict-only repeated reminders.
- UI profile management and model-assisted final-claim checking remain deferred to later phases.
```

- [ ] **Step 3: Run product evals and docs check**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-product-evals.test.ts --no-file-parallelism
git diff --check -- docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/context/context-product-evals.test.ts docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md
git commit -m "test(context): add phase 6 model profile evals"
```

---

## Task 7: Final Integration Gate

**Goal:** Verify the whole Phase 6 slice and leave the branch clean.

**Files:**

- Review all files changed by Tasks 1-6.

- [ ] **Step 1: Run Phase 6 focused suite**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/model-profile.test.ts src/context-system-prompt.test.ts src/context/context-orchestrator.test.ts src/session-context.test.ts tests/parallel-executor.test.ts src/context/context-product-evals.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run:

```bash
pnpm --filter @jdcagnet/core build
```

Expected: PASS.

- [ ] **Step 3: Run full core test suite**

Run:

```bash
pnpm --filter @jdcagnet/core test -- --run --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 4: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Review final diff and log**

Run:

```bash
git diff --stat HEAD~6..HEAD
git log --oneline -n 10
```

Expected: recent commits contain model profile resolver, prompt contract, context agent contract, session wiring, profile-aware parallelism, evals, and design-doc changes.

- [ ] **Step 6: Final status**

Run:

```bash
git status --short --branch
```

Expected: clean working tree on the implementation branch, ahead by the Phase 6 commits.
