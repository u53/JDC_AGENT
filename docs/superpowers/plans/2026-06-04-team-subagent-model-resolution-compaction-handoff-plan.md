# Team / Subagent Model Resolution, Compaction, and Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking; completed steps are marked `- [x]`.

**Goal:** Fix explicit model selection for Agent/Team/PM, add fail-open compaction to long sub-sessions, and make Team archive handoff structured enough that the main session never reads stale `.team/` paths.

**Architecture:** Split the work into three dependent tracks inside one plan. Track A creates one pure model resolver and wires every Agent/Team caller through it; Track B adds sub-session context lifecycle management without adding JDC Context Engine token caps; Track C carries Team archive metadata as structured runtime data and updates the handoff contract.

**Tech Stack:** TypeScript, Electron main process, `@jdcagnet/core`, Vitest, existing `compactMessages`, `UsageTracker`, `TeamRuntime`, `TeamWorkspace`.

**Implementation Status:** Completed on `main`.

**Completion Commits:**

- `25638e7 feat(model): add configured model resolver`
- `5589775 fix(model): use unified resolver for agents and teams`
- `6aa85b3 fix(model): surface agent and team model fallback`
- `d881d24 fix(model): complete runtime model overrides`
- `12418af feat(team): compact sub-sessions and structure archive handoff`

**Final Verification Run:**

- `pnpm --filter @jdcagnet/core exec vitest run src/model-resolution.test.ts --no-file-parallelism`
- `pnpm --filter @jdcagnet/core exec vitest run src/sub-session-max-turns.test.ts src/sub-session-compaction.test.ts src/team/__tests__/team-member.test.ts src/team/__tests__/team-runtime.test.ts src/team/__tests__/team-tools.test.ts --no-file-parallelism`
- `pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts --no-file-parallelism`
- `pnpm --filter @jdcagnet/core build`
- `pnpm --filter jdcagnet build`
- `pnpm --filter @jdcagnet/ui build`
- `git diff --check`

---

## Current Findings To Preserve

- `packages/electron/src/session-manager.ts` has two model resolution paths. `resolveModelById()` supports `groupId:modelId` and UUID, but the `session.resolveModel` callback used by Agent and Team only supports UUID/API model id and silently takes the first duplicate group.
- `packages/core/src/session.ts` now injects `<available-models>` with `modelId: "groupId:modelId"`, so the prompt layer and resolver layer currently disagree.
- `packages/core/src/tools/team.ts` always constructs PM with the main session provider/model config; there is no `pmModelId` override.
- `packages/core/src/sub-session.ts` has no `UsageTracker`, no `estimateTokens`, and no `compactMessages` call. It forwards usage but does not use it to manage history.
- `packages/core/src/tools/agent.ts` and `packages/core/src/sub-session.ts` default `maxTurns` to `1000`, which prevents agent type defaults from naturally applying.
- `packages/core/src/team/team-runtime.ts` appends `Archived to: ...` to a summary string, but no structured `archivePath` reaches `session.ts`, `backgroundTasks`, or the final Team snapshot.

## File Map

- Create `packages/core/src/model-resolution.ts` — pure resolver for configured model groups; no Electron dependencies.
- Create `packages/core/src/model-resolution.test.ts` — resolver tests for composite keys, UUID, API names, display names, ambiguity, and not-found cases.
- Modify `packages/core/src/index.ts` — export resolver types/functions if needed by Electron.
- Modify `packages/electron/src/session-manager.ts` — use the pure resolver in both `resolveModelById()` and `session.resolveModel`.
- Modify `packages/core/src/tools/agent.ts` — preserve agent type maxTurns defaults; surface model resolution warnings.
- Modify `packages/core/src/tools/team.ts` — add `pmModelId`, resolve PM model, update handoff contract.
- Modify `packages/core/src/team/team-member.ts` — make worker model fallback visible through Team events.
- Modify `packages/core/src/team/team-runtime.ts` — pass `archivePath`/archive failure as structured fields.
- Modify `packages/core/src/team/team-types.ts` — extend `TeamEvent` and `TeamRuntime` metadata types.
- Modify `packages/core/src/session.ts` — forward model warnings and archive path into main session notifications/snapshots.
- Modify `packages/core/src/sub-session.ts` — add sub-session compaction and maxTurns default fix.
- Test files to modify/add:
  - `packages/core/src/team/__tests__/team-tools.test.ts`
  - `packages/core/src/team/__tests__/team-member.test.ts`
  - `packages/core/src/team/__tests__/team-runtime.test.ts`
  - `packages/core/src/session-context.test.ts`
  - `packages/core/src/sub-session-compaction.test.ts`

---

## Task 1: Pure Configured Model Resolver

**Files:**
- Create: `packages/core/src/model-resolution.ts`
- Create: `packages/core/src/model-resolution.test.ts`
- Modify: `packages/core/src/index.ts`

- [x] **Step 1: Write failing resolver tests**

Create `packages/core/src/model-resolution.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveConfiguredModel } from './model-resolution.js'

const groups = [
  {
    id: 'official',
    name: 'Official Anthropic',
    protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'sk-official',
    models: [
      { id: 'uuid-opus-official', modelId: 'claude-opus-4-1', name: 'Opus Official', maxTokens: 32000, contextWindow: 200000, compressAt: 0.9 },
      { id: 'uuid-sonnet', modelId: 'claude-sonnet-4-5', name: 'Sonnet', maxTokens: 32000, contextWindow: 200000, compressAt: 0.9 },
    ],
  },
  {
    id: 'proxy',
    name: 'Company Proxy',
    protocol: 'openai-responses',
    baseUrl: 'https://models.company.local',
    apiKey: 'sk-proxy',
    models: [
      { id: 'uuid-opus-proxy', modelId: 'claude-opus-4-1', name: 'Opus Proxy', maxTokens: 64000, contextWindow: 300000, compressAt: 0.92 },
      { id: 'uuid-ds', modelId: 'deepseek-reasoner', name: '公司 DeepSeek', maxTokens: 32000, contextWindow: 128000, compressAt: 0.9 },
    ],
  },
]

describe('resolveConfiguredModel', () => {
  it('resolves composite groupId:modelId without cross-group collision', () => {
    const result = resolveConfiguredModel(groups, 'proxy:claude-opus-4-1')
    expect(result.status).toBe('resolved')
    expect(result.model?.groupId).toBe('proxy')
    expect(result.model?.modelId).toBe('claude-opus-4-1')
    expect(result.model?.contextWindow).toBe(300000)
  })

  it('resolves stored UUID model ids', () => {
    const result = resolveConfiguredModel(groups, 'uuid-sonnet')
    expect(result.status).toBe('resolved')
    expect(result.model?.groupId).toBe('official')
    expect(result.model?.modelId).toBe('claude-sonnet-4-5')
  })

  it('resolves display names when they are unique', () => {
    const result = resolveConfiguredModel(groups, '公司 DeepSeek')
    expect(result.status).toBe('resolved')
    expect(result.model?.groupId).toBe('proxy')
    expect(result.model?.modelId).toBe('deepseek-reasoner')
  })

  it('rejects ambiguous bare API model ids instead of choosing the first group', () => {
    const result = resolveConfiguredModel(groups, 'claude-opus-4-1')
    expect(result.status).toBe('ambiguous')
    expect(result.matches.map(m => m.groupId)).toEqual(['official', 'proxy'])
    expect(result.message).toContain('official:claude-opus-4-1')
    expect(result.message).toContain('proxy:claude-opus-4-1')
  })

  it('returns not_found with a useful message for unknown requests', () => {
    const result = resolveConfiguredModel(groups, 'missing-model')
    expect(result.status).toBe('not_found')
    expect(result.message).toContain('missing-model')
  })
})
```

- [x] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/model-resolution.test.ts --no-file-parallelism
```

Expected: FAIL because `./model-resolution.js` does not exist.

- [x] **Step 3: Implement the resolver**

Create `packages/core/src/model-resolution.ts`:

```ts
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
```

- [x] **Step 4: Export the resolver**

Modify `packages/core/src/index.ts` and add:

```ts
export {
  resolveConfiguredModel,
  type ConfiguredModelGroup,
  type ConfiguredModelEntry,
  type ConfiguredModelResolution,
  type ResolvedConfiguredModel,
} from './model-resolution.js'
```

- [x] **Step 5: Run resolver tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/model-resolution.test.ts --no-file-parallelism
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/core/src/model-resolution.ts packages/core/src/model-resolution.test.ts packages/core/src/index.ts
git commit -m "feat(model): add configured model resolver"
```

---

## Task 2: Wire Unified Resolver Into SessionManager

**Files:**
- Modify: `packages/electron/src/session-manager.ts:182-321`
- Test: `packages/core/src/model-resolution.test.ts`

- [x] **Step 1: Replace private resolver logic with pure helper**

In `packages/electron/src/session-manager.ts`, import:

```ts
import { resolveConfiguredModel, type ConfiguredModelResolution } from '@jdcagnet/core'
```

Add a private conversion helper inside `SessionManager`:

```ts
private modelResolutionToRuntime(resolution: ConfiguredModelResolution): { provider: any; modelConfig: ModelConfig; protocol: string; warning?: string } | { warning: string } {
  if (resolution.status !== 'resolved') return { warning: resolution.message }
  const model = resolution.model
  const provider = this.createProvider(model.group as any)
  return {
    provider,
    modelConfig: {
      model: model.modelId,
      maxTokens: model.maxTokens,
      contextWindow: model.contextWindow,
      compressAt: model.compressAt,
    },
    protocol: model.protocol || 'anthropic',
  }
}
```

Then change `resolveModelById(modelId)` to:

```ts
private resolveModelById(modelId: string): { provider: any; modelConfig: ModelConfig; protocol: string } | null {
  const config = loadAppConfig()
  const resolution = resolveConfiguredModel(config.modelGroups?.groups, modelId)
  if (resolution.status !== 'resolved') return null
  const runtime = this.modelResolutionToRuntime(resolution)
  if (!('provider' in runtime)) return null
  return { provider: runtime.provider, modelConfig: runtime.modelConfig, protocol: runtime.protocol }
}
```

- [x] **Step 2: Replace `session.resolveModel` duplicate implementation**

Replace the callback at `packages/electron/src/session-manager.ts:303` with:

```ts
session.resolveModel = (modelId: string) => {
  const config = loadAppConfig()
  const resolution = resolveConfiguredModel(config.modelGroups?.groups, modelId)
  const runtime = this.modelResolutionToRuntime(resolution)
  if (!('provider' in runtime)) return { status: 'failed', warning: runtime.warning }
  return { status: 'resolved', provider: runtime.provider, modelConfig: runtime.modelConfig, warning: runtime.warning }
}
```

Update every `resolveModel` type that currently returns only provider/modelConfig so warnings are type-safe:

```ts
export type RuntimeModelResolution =
  | { status: 'resolved'; provider: ModelProvider; modelConfig: ModelConfig; warning?: string }
  | { status: 'failed'; warning: string }

resolveModel?: (modelId: string) => RuntimeModelResolution
```

Apply this return type in:

- `packages/core/src/session.ts`
- `packages/core/src/tools/agent.ts`
- `packages/core/src/tools/team.ts`
- `packages/core/src/team/team-runtime.ts`
- `packages/core/src/team/team-member.ts`

- [x] **Step 3: Preserve not-specified inheritance**

Do not change any code path when `modelId` is absent. Agent, Team worker, and PM must keep inheriting the main session provider/modelConfig.

- [x] **Step 4: Verify build**

Run:

```bash
pnpm --filter @jdcagnet/core build
pnpm --filter jdcagnet build
```

Expected: both PASS.

- [x] **Step 5: Commit**

```bash
git add packages/electron/src/session-manager.ts packages/core/src/session.ts
git commit -m "fix(model): use unified resolver for agents and teams"
```

---

## Task 3: Make Model Resolution Fallback Visible

**Files:**
- Modify: `packages/core/src/tools/agent.ts:76-90`
- Modify: `packages/core/src/team/team-member.ts:214-239`
- Modify: `packages/core/src/session.ts:239-258`
- Modify: `packages/core/src/team/team-types.ts`
- Test: `packages/core/src/team/__tests__/team-member.test.ts`
- Test: `packages/core/src/session-context.test.ts`

- [x] **Step 1: Add a Team event for model warnings**

Modify `packages/core/src/team/team-types.ts` and add this union member:

```ts
| { type: 'model_resolution_warning'; memberId?: string; requestedModelId: string; message: string; timestamp: number }
```

- [x] **Step 2: Surface Agent model fallback in returned content**

In `packages/core/src/tools/agent.ts`, replace the resolution block with:

```ts
let modelWarning: string | undefined
if (requestedModelId && deps.resolveModel) {
  const resolved = deps.resolveModel(requestedModelId)
  if (resolved?.status === 'resolved') {
    effectiveProvider = resolved.provider
    effectiveModelConfig = resolved.modelConfig
    modelWarning = resolved.warning
  } else {
    modelWarning = resolved?.warning ?? `Requested model "${requestedModelId}" was not found; using the main session model.`
  }
}
```

When returning foreground result, prefix the content:

```ts
const content = modelWarning ? `${modelWarning}\n\n${raceResult.result.content}` : raceResult.result.content
return { content, isError: false }
```

When returning background start content, include:

```ts
modelWarning ? `Model warning: ${modelWarning}` : '',
```

- [x] **Step 3: Surface Team worker fallback as a structured event**

In `packages/core/src/team/team-member.ts`, change the failure branch to emit:

```ts
const message = resolved?.warning ?? `Requested model "${this.modelId}" was not found; using the main session model.`
this.opts.onEvent?.({
  type: 'model_resolution_warning',
  memberId: this.id,
  requestedModelId: this.modelId,
  message,
  timestamp: Date.now(),
})
this.opts.onEvent?.({
  type: 'member_progress',
  memberId: this.id,
  text: `[modelId resolve] ${message}`,
  timestamp: Date.now(),
})
```

- [x] **Step 4: Forward model warning events to the main session**

In `packages/core/src/session.ts` inside `onTeamEvent`, add before the terminal event branches:

```ts
if (event.type === 'model_resolution_warning') {
  this.pendingNotifications.push({
    type: 'team_progress',
    taskId: teamId,
    status: 'running',
    teamEvent: `Model warning: ${(event as any).message}`,
  })
  this.onNotificationReady?.()
  return
}
```

- [x] **Step 5: Add tests**

In `packages/core/src/team/__tests__/team-member.test.ts`, add a test that constructs a `TeamMember` with `modelId: 'missing'`, `resolveModel: () => null`, and asserts `onEvent` receives `model_resolution_warning`.

In `packages/core/src/session-context.test.ts`, add a focused test through `processNotifications()` with a fake provider: trigger a `model_resolution_warning` Team event, process notifications, and assert the fake provider receives a `<task-notification>` containing `Model warning:`.

- [x] **Step 6: Run tests**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/team/__tests__/team-member.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add packages/core/src/tools/agent.ts packages/core/src/team/team-member.ts packages/core/src/team/team-types.ts packages/core/src/session.ts packages/core/src/team/__tests__/team-member.test.ts packages/core/src/session-context.test.ts
git commit -m "fix(model): surface agent and team model fallback"
```

---

## Task 4: Add Explicit PM Model Override

**Files:**
- Modify: `packages/core/src/tools/team.ts:18-251`
- Modify: `packages/core/src/team/team-runtime.ts:40-122`
- Modify: `packages/core/src/team/team-types.ts`
- Test: `packages/core/src/team/__tests__/team-tools.test.ts`

- [x] **Step 1: Extend Team tool schema**

In `packages/core/src/tools/team.ts`, add an optional root input field:

```ts
pmModelId: {
  type: 'string',
  description: 'Optional model id for the Team PM only. Use exactly a configured model id such as "groupId:modelId" when the user explicitly asks the PM to use a specific model. Omit to inherit the main session model.',
},
```

- [x] **Step 2: Resolve PM model before constructing TeamRuntime**

Before `new TeamRuntime(...)`, add:

```ts
let aiPM = deps.provider && deps.modelConfig ? { provider: deps.provider, modelConfig: deps.modelConfig } : undefined
const pmModelId = input.pmModelId as string | undefined
let pmModelWarning: string | undefined
if (pmModelId && deps.resolveModel) {
  const resolved = deps.resolveModel(pmModelId)
  if (resolved?.status === 'resolved') {
    aiPM = { provider: resolved.provider, modelConfig: resolved.modelConfig }
    pmModelWarning = resolved.warning
  } else {
    pmModelWarning = resolved?.warning ?? `Requested PM model "${pmModelId}" was not found; PM is using the main session model.`
  }
}
```

Pass `aiPM`:

```ts
aiPM,
```

Add `pmModelWarning` to returned content when present.

- [x] **Step 3: Store PM model id in runtime state**

In `packages/core/src/team/team-runtime.ts`, set manager state model id when available:

```ts
this.manager = new TeamManagerAI({
  provider: opts.aiPM.provider,
  modelConfig: opts.aiPM.modelConfig,
  memberStates: () => this.getMembers(),
  taskStates: () => this.getTasks(),
  onAction: (action) => this.handlePMActions([action]),
  skillInjection: opts.skillInjection?.pmContent,
  modelId: opts.aiPM.modelConfig.model,
})
```

Extend `TeamManagerAIOptions` with `modelId?: string` and include it in `TeamManagerState.modelId` so the UI can show which model the PM used.

- [x] **Step 4: Add tests**

In `packages/core/src/team/__tests__/team-tools.test.ts`, add:

```ts
it('resolves explicit PM model without changing worker defaults', async () => {
  const bg = new BackgroundTaskManager(path.join(os.tmpdir(), 'team-tools-pm-model-' + Date.now()))
  const registry = new TeamRegistry()
  const resolveModel = vi.fn((modelId: string) => modelId === 'proxy:deepseek-reasoner'
    ? { status: 'resolved' as const, provider: { name: 'pm-provider' }, modelConfig: { model: 'deepseek-reasoner', maxTokens: 32000, contextWindow: 128000 } }
    : { status: 'failed' as const, warning: `missing ${modelId}` })
  const tool = createTeamTool({
    teamRegistry: registry,
    backgroundTasks: bg,
    buildSubSessionDeps,
    provider: { name: 'main-provider' } as any,
    modelConfig: { model: 'main-model', maxTokens: 32000, contextWindow: 200000 } as any,
    resolveModel,
  })

  const result = await tool.execute({
    objective: 'PM model override test',
    pmModelId: 'proxy:deepseek-reasoner',
    members: [{ role: 'explorer', agentType: 'explore' }],
    tasks: [{ title: 'A', description: 'a' }],
  } as any, {} as any)

  expect(result.isError).toBeFalsy()
  expect(resolveModel).toHaveBeenCalledWith('proxy:deepseek-reasoner')
})
```

- [x] **Step 5: Run tests**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/team/__tests__/team-tools.test.ts --no-file-parallelism
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/core/src/tools/team.ts packages/core/src/team/team-runtime.ts packages/core/src/team/team-manager-ai.ts packages/core/src/team/team-types.ts packages/core/src/team/__tests__/team-tools.test.ts
git commit -m "feat(team): support explicit PM model override"
```

---

## Task 5: Fix Sub-session maxTurns Defaults

**Files:**
- Modify: `packages/core/src/tools/agent.ts:76`
- Modify: `packages/core/src/sub-session.ts:92-110`
- Test: `packages/core/src/__tests__/agent-types.test.ts` or create `packages/core/src/sub-session-max-turns.test.ts`

- [x] **Step 1: Write failing maxTurns test**

Create `packages/core/src/sub-session-max-turns.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { runSubSession } from './sub-session.js'
import { ToolRegistry } from './tool-registry.js'
import type { ModelProvider, Message, ModelConfig, ToolDefinition } from './index.js'

describe('runSubSession maxTurns', () => {
  it('uses the agentType maxTurns when maxTurns is not explicitly provided', async () => {
    let calls = 0
    const provider: ModelProvider = {
      name: 'max-turns-provider',
      chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async function* (_messages: Message[], _tools: ToolDefinition[], _config: ModelConfig) {
        calls++
        yield { type: 'tool_use_start', toolUse: { id: `tool_${calls}`, name: 'Read', input: '' } }
        yield { type: 'tool_use_delta', toolUse: { id: `tool_${calls}`, name: 'Read', input: '{"file_path":"missing.ts"}' } }
        yield { type: 'tool_use_end' }
      },
    } as any
    const registry = new ToolRegistry()
    registry.register({
      name: 'Read',
      description: 'fake read',
      inputSchema: {},
      execute: async () => ({ content: 'missing', isError: true }),
    } as any)

    const result = await runSubSession({
      prompt: 'loop',
      provider,
      toolRegistry: registry,
      modelConfig: { model: 'test', maxTokens: 1000, contextWindow: 200000 },
      cwd: process.cwd(),
      agentType: 'explore',
    })

    expect(result.turns).toBeLessThan(1000)
  })
})
```

- [x] **Step 2: Run test to verify failure**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/sub-session-max-turns.test.ts --no-file-parallelism
```

Expected: FAIL. To keep the failure fast, make the fake provider throw `new Error('agentType maxTurns was not applied')` when `calls > 30`.

- [x] **Step 3: Implement maxTurns default fix**

In `packages/core/src/tools/agent.ts`, change:

```ts
const maxTurns = typeof input.maxTurns === 'number' ? input.maxTurns : undefined
```

In `packages/core/src/sub-session.ts`, change destructuring:

```ts
maxTurns,
```

Then:

```ts
const effectiveMaxTurns = maxTurns ?? agentDef?.maxTurns ?? 1000
```

- [x] **Step 4: Run tests**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/sub-session-max-turns.test.ts src/team/__tests__/team-member.test.ts --no-file-parallelism
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/core/src/tools/agent.ts packages/core/src/sub-session.ts packages/core/src/sub-session-max-turns.test.ts
git commit -m "fix(agent): respect agent type max turn defaults"
```

---

## Task 6: Add Fail-open Sub-session Compaction

**Files:**
- Modify: `packages/core/src/sub-session.ts`
- Create: `packages/core/src/sub-session-compaction.test.ts`

- [x] **Step 1: Write failing compaction continuation test**

Create `packages/core/src/sub-session-compaction.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { runSubSession } from './sub-session.js'
import { ToolRegistry } from './tool-registry.js'
import type { Message, ModelConfig, ToolDefinition } from './types.js'
import type { ModelProvider } from './model-provider.js'

describe('sub-session compaction', () => {
  it('compacts long sub-session history and continues with compacted messages', async () => {
    const foregroundMessages: Message[][] = []
    let compactCalls = 0
    const provider: ModelProvider = {
      name: 'sub-compact-provider',
      chat: async () => ({ content: [], usage: { inputTokens: 0, outputTokens: 0 } }),
      stream: async function* (messages: Message[], _tools: ToolDefinition[], config: ModelConfig) {
        if (typeof config.systemPrompt === 'string' && config.systemPrompt.includes('specialist at creating detailed')) {
          compactCalls++
          yield { type: 'text_delta', text: '<summary>Sub-session recovered summary.</summary>' }
          yield { type: 'message_end', usage: { inputTokens: 10, outputTokens: 2 } }
          return
        }
        foregroundMessages.push(messages.map(m => ({ ...m, content: [...m.content] })))
        if (foregroundMessages.length < 4) {
          yield { type: 'tool_use_start', toolUse: { id: `tool_${foregroundMessages.length}`, name: 'Read', input: '' } }
          yield { type: 'tool_use_delta', toolUse: { id: `tool_${foregroundMessages.length}`, name: 'Read', input: '{"file_path":"large.ts"}' } }
          yield { type: 'tool_use_end' }
          yield { type: 'message_end', usage: { inputTokens: 1000, outputTokens: 10 } }
          return
        }
        yield { type: 'text_delta', text: 'done after sub compact' }
        yield { type: 'message_end', usage: { inputTokens: 100, outputTokens: 10 } }
      },
    } as any
    const registry = new ToolRegistry()
    registry.register({
      name: 'Read',
      description: 'fake read',
      inputSchema: {},
      execute: async (_input, _ctx) => ({ content: 'x'.repeat(5000), isError: false }),
    } as any)

    const result = await runSubSession({
      prompt: 'long worker task',
      provider,
      toolRegistry: registry,
      modelConfig: { model: 'test', maxTokens: 1000, contextWindow: 1200, compressAt: 0.5 },
      cwd: process.cwd(),
      maxTurns: 8,
      onStreamHeartbeat: vi.fn(),
    })

    expect(result.content).toBe('done after sub compact')
    expect(compactCalls).toBeGreaterThan(0)
    expect(JSON.stringify(foregroundMessages.at(-1))).toContain('Sub-session recovered summary')
  })
})
```

- [x] **Step 2: Run test to verify failure**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/sub-session-compaction.test.ts --no-file-parallelism
```

Expected: FAIL because no compaction occurs.

- [x] **Step 3: Implement UsageTracker and compaction**

In `packages/core/src/sub-session.ts`, import:

```ts
import { compactMessages, MIN_COMPACT_LENGTH } from './compact.js'
import { estimateTokens } from './token-estimation.js'
import { UsageTracker } from './usage-tracker.js'
```

After `let turns = 0`, add:

```ts
const usageTracker = new UsageTracker(modelConfig.contextWindow || 200000)
let subSessionJustCompacted = false
```

At the top of the loop, after abort check and before composing system prompt, add:

```ts
if (!subSessionJustCompacted && shouldCompactSubSession(messages, usageTracker, modelConfig)) {
  const compactResult = await compactMessages(
    messages,
    provider,
    modelConfig,
    (chunk) => {
      if (chunk.type === 'compact_progress') onStreamHeartbeat?.()
    },
    signal,
  )
  if (compactResult.status === 'compacted') {
    messages.splice(0, messages.length, ...compactResult.messages)
    const estimated = estimateTokens(messages)
    usageTracker.resetLastTurn(estimated)
    subSessionJustCompacted = true
  } else {
    subSessionJustCompacted = true
  }
} else {
  subSessionJustCompacted = false
}
```

When handling `message_end`, add:

```ts
usageTracker.addTurn(chunk.usage)
onUsage?.(chunk.usage)
```

Add helper at bottom:

```ts
function shouldCompactSubSession(messages: Message[], usageTracker: UsageTracker, modelConfig: ModelConfig): boolean {
  if (messages.length < MIN_COMPACT_LENGTH) return false
  const compressAt = modelConfig.compressAt ?? 0.9
  if (usageTracker.shouldCompact(compressAt)) return true
  const contextWindow = modelConfig.contextWindow || 200000
  return estimateTokens(messages) > contextWindow * compressAt
}
```

- [x] **Step 4: Ensure harvest accumulators are not touched**

Do not mutate `harvestAssistantMessages` or `harvestToolEvents` during compaction. Only replace the local `messages` array used for provider context.

- [x] **Step 5: Add fail-open test**

In `packages/core/src/sub-session-compaction.test.ts`, add a second test where the compact stream throws and the worker still returns final text. Assert `result.content` is the final response and no exception escapes.

- [x] **Step 6: Run tests**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/sub-session-compaction.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add packages/core/src/sub-session.ts packages/core/src/sub-session-compaction.test.ts
git commit -m "feat(agent): compact long sub-session histories"
```

---

## Task 7: Structured Team Archive Handoff

**Files:**
- Modify: `packages/core/src/team/team-types.ts`
- Modify: `packages/core/src/team/team-runtime.ts:1141-1155`
- Modify: `packages/core/src/tools/team.ts:258-310`
- Modify: `packages/core/src/session.ts:244-258,1401-1428`
- Test: `packages/core/src/team/__tests__/team-runtime.test.ts`
- Test: `packages/core/src/team/__tests__/team-tools.test.ts`

- [x] **Step 1: Extend Team completed event**

In `packages/core/src/team/team-types.ts`, replace:

```ts
| { type: 'team_completed'; summary: string; timestamp: number }
```

with:

```ts
| { type: 'team_completed'; summary: string; archivePath?: string; archiveError?: string; timestamp: number }
```

- [x] **Step 2: Extend TeamRuntime onComplete signature**

In `packages/core/src/team/team-runtime.ts`, update `TeamRuntimeOptions`:

```ts
onComplete?: (summary: string, meta?: { archivePath?: string; archiveError?: string }) => void
```

Change `completeTeam()` success branch:

```ts
this.recordEvent({ type: 'team_completed', summary, archivePath, timestamp: Date.now() })
this.opts.onComplete?.(summary, { archivePath })
```

Change archive failure branch:

```ts
const archiveError = err instanceof Error ? err.message : String(err)
this.recordEvent({ type: 'team_completed', summary, archiveError, timestamp: Date.now() })
this.opts.onComplete?.(summary, { archiveError })
```

- [x] **Step 3: Store archive metadata in background completion**

In `packages/core/src/tools/team.ts`, update:

```ts
onComplete: (summary, meta) => {
  deps.backgroundTasks.completeTeam(bgTask.id, { summary, archivePath: meta?.archivePath, archiveError: meta?.archiveError })
  deps.teamRegistry.remove(bgTask.id)
},
```

Extend the `BackgroundTaskManager.completeTeam()` team result payload type to include optional `archivePath` and `archiveError`, then store both fields in the completed task result.

- [x] **Step 4: Update handoff contract text**

In `packages/core/src/tools/team.ts`, add to the returned `HANDOFF CONTRACT`:

```ts
`  • When the team completes, its live .team/ workspace is archived. Use the archive path from team_complete for artifacts/results/contracts; do NOT assume .team/ still exists.`,
```

- [x] **Step 5: Include archive metadata in main session notification**

In `packages/core/src/session.ts`, change the `team_completed` branch:

```ts
const archivePath = (event as any).archivePath
const archiveError = (event as any).archiveError
const archiveLine = archivePath
  ? `\n\nTeam workspace archived to: ${archivePath}\nUse this archive directory for task artifacts/results/contracts. Do NOT read .team/ for this completed team; it has been moved.`
  : archiveError
  ? `\n\nTeam workspace archive failed: ${archiveError}\nDo not assume .team/ or .team-archive/ contains complete artifacts.`
  : ''
this.captureTeamFinalSnapshot(teamId, { archivePath, archiveError })
this.pendingNotifications.push({
  type: 'team_complete',
  taskId: teamId,
  status: 'completed',
  teamEvent: `Team finished. Final summary:\n${(event as any).summary ?? ''}${archiveLine}\n\nDo NOT call background_status / background_events on this team again — it is done.`,
})
```

Update `captureTeamFinalSnapshot` signature:

```ts
private captureTeamFinalSnapshot(taskId: string, meta: { archivePath?: string; archiveError?: string } = {}): void
```

Add to snapshot:

```ts
archivePath: meta.archivePath,
archiveError: meta.archiveError,
```

- [x] **Step 6: Add archive tests**

In `packages/core/src/team/__tests__/team-runtime.test.ts`, add a test that completes a team and asserts a `team_completed` event has `archivePath`.

In `packages/core/src/team/__tests__/team-tools.test.ts`, assert the Team tool returned handoff text contains:

```ts
expect(result.content).toContain('Use the archive path from team_complete')
expect(result.content).toContain('Do NOT assume .team/ still exists')
```

- [x] **Step 7: Run tests**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/team/__tests__/team-runtime.test.ts src/team/__tests__/team-tools.test.ts src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add packages/core/src/team/team-types.ts packages/core/src/team/team-runtime.ts packages/core/src/tools/team.ts packages/core/src/session.ts packages/core/src/background-tasks.ts packages/core/src/team/__tests__/team-runtime.test.ts packages/core/src/team/__tests__/team-tools.test.ts packages/core/src/session-context.test.ts
git commit -m "fix(team): structure archive handoff metadata"
```

---

## Task 8: Final Integration Verification

**Files:**
- No production files unless verification exposes a bug.

- [x] **Step 1: Run model resolver tests**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/model-resolution.test.ts --no-file-parallelism
```

Expected: PASS.

- [x] **Step 2: Run Agent/Team focused tests**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/sub-session-max-turns.test.ts src/sub-session-compaction.test.ts src/team/__tests__/team-member.test.ts src/team/__tests__/team-runtime.test.ts src/team/__tests__/team-tools.test.ts --no-file-parallelism
```

Expected: PASS.

- [x] **Step 3: Run context integration tests**

```bash
pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts --no-file-parallelism
```

Expected: PASS. Existing intentional stderr from fallback tests is acceptable only when Vitest exits 0.

- [x] **Step 4: Build core/electron/ui**

```bash
pnpm --filter @jdcagnet/core build
pnpm --filter jdcagnet build
pnpm --filter @jdcagnet/ui build
```

Expected: all PASS.

- [x] **Step 5: Check formatting and git status**

```bash
git diff --check
git status --short
```

Expected: `git diff --check` has no output. `git status --short` shows only intentional files before final commit.

- [x] **Step 6: Final commit**

```bash
git add -A
git commit -m "test(team): verify model resolution compaction and handoff"
```

When Task 8 makes no file changes, do not create an empty commit; report that the prior task commits are the final state.

---

## Self-Review

- A-fix-1 is covered by Task 1 and Task 2.
- A-fix-2 is covered by Task 3.
- A-fix-3 is covered by Task 4.
- A-fix-4 is intentionally not expanded into PM autonomous model selection. Existing `<available-models>` prompt remains enough for user-explicit selection once the resolver works.
- B-design-1 is covered by Task 5.
- B-design-2 and B-design-3 are covered by Task 6.
- C-fix-1 and C-fix-2 are covered by Task 7.
- C-fix-3 is partially covered by adding `archivePath`/`archiveError` to the final Team snapshot; per-task artifact pointers remain out of scope because the archive root path is sufficient for the main session to inspect files.
- No task adds a JDC Context Engine token budget or section cap. Sub-session compaction is provider-window lifecycle management, not Context Engine content limiting.
