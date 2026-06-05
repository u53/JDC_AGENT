# JDC Context Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent JDC Context Engine bundles from duplicating or conflicting with context already carried by the system prompt, task system, git status, runtime/tool stream, project instructions, and provider messages.

**Architecture:** Add an explicit context ownership model to `ContextRequest` and `ContextSection`, make providers label what they own, and run a conflict resolver before planning/ranking/rendering. System prompt remains authoritative for behavior and project instructions; JDC Engine owns live evidence, cited project signals, durable memory, and derived state that does not copy higher-authority context.

**Tech Stack:** TypeScript, Vitest, existing `@jdcagnet/core` Context Engine modules.

---

## File Structure

- Modify `packages/core/src/context/types.ts`
  - Add ownership metadata types for carried system context and section authority.
- Modify `packages/core/src/context/schemas.ts`
  - Accept the new metadata in protocol schemas.
- Modify `packages/core/src/context/providers/shared.ts`
  - Let providers attach ownership metadata through the existing `section()` helper.
- Modify `packages/core/src/context.ts`
  - Expose loaded project instruction refs.
  - Remove full `# Git Status` from the generic system prompt so `GitSignalProvider` is the detailed git authority.
- Modify `packages/core/src/session.ts`
  - Populate `ContextRequest.carriedContext` for project instruction refs, task refs, and transcript ownership.
- Modify `packages/core/src/sub-session.ts`
  - Mark sub-session transcript as already in provider messages.
- Modify `packages/core/src/team/team-manager-ai.ts`
  - Mark Team PM transcript as already in provider messages.
- Modify `packages/core/src/context/providers/project-provider.ts`
  - Skip instruction files already loaded into system prompt.
- Modify `packages/core/src/context/providers/git-provider.ts`
  - Mark git state as live authoritative evidence.
- Modify `packages/core/src/context/providers/conversation-provider.ts`
  - Mark raw conversation transcript sections as derived transcript echoes.
- Create `packages/core/src/context/conflict-resolver.ts`
  - Suppress sections that duplicate higher-authority carried context.
- Modify `packages/core/src/context/orchestrator.ts`
  - Run conflict resolution before `planContext`.
- Modify `packages/core/src/context/planner.ts`
  - Keep relevance planning only; remove authority/conflict decisions from planner.
- Tests:
  - Add `packages/core/src/context/conflict-resolver.test.ts`
  - Modify `packages/core/src/context/protocol-schemas.test.ts`
  - Modify `packages/core/src/context/signal-providers.test.ts`
  - Modify `packages/core/src/context/context-orchestrator.test.ts`
  - Modify `packages/core/src/context/context-planner.test.ts`
  - Modify `packages/core/src/session-context.test.ts`
  - Add or modify `packages/core/src/context-system-prompt.test.ts`

---

### Task 1: Model Context Ownership Metadata

**Files:**
- Modify: `packages/core/src/context/types.ts`
- Modify: `packages/core/src/context/schemas.ts`
- Modify: `packages/core/src/context/providers/shared.ts`
- Test: `packages/core/src/context/protocol-schemas.test.ts`

- [ ] **Step 1: Write the failing protocol test**

In `packages/core/src/context/protocol-schemas.test.ts`, import `ContextRequestSchema`:

```ts
import {
  ContextBundleSchema,
  ContextCitationSchema,
  ContextFactSchema,
  ContextRequestSchema,
  DistillerEnvelopeSchema,
  HarvestDecisionSchema,
  MemoryRecordSchema,
  validateContextBundle,
  validateContextFact,
  validateDistillerEnvelope,
  validateMemoryRecord,
} from './schemas.js'
```

Add this assertion inside `it('accepts valid context facts, bundles, harvest decisions, memory records, and distiller envelopes', ...)`:

```ts
const request = {
  sessionId: 'session_1',
  cwd: '/repo',
  userMessage: 'fix retry',
  recentMessages: [],
  transcriptAlreadyInModel: true,
  carriedContext: {
    projectInstructionRefs: ['JDCAGNET.md', 'AGENTS.md'],
    gitStatusInSystemPrompt: false,
    taskRefs: ['task_1'],
  },
  mode: 'code_edit',
  model: 'test-model',
  runtime: {},
  createdAt: 1,
}

expect(ContextRequestSchema.parse(request).carriedContext?.projectInstructionRefs).toEqual(['JDCAGNET.md', 'AGENTS.md'])
```

Also extend the `bundle.sections[0]` test fixture with:

```ts
ownership: {
  authority: 'durable_memory',
  topic: 'memory',
  conflictPolicy: 'render',
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/context/protocol-schemas.test.ts
```

Expected: FAIL because `ContextRequestSchema.carriedContext` and section `ownership` are not supported yet.

- [ ] **Step 3: Add ownership types**

In `packages/core/src/context/types.ts`, add:

```ts
export type ContextAuthority =
  | 'system_instruction'
  | 'project_instruction'
  | 'current_user'
  | 'live_state'
  | 'runtime_evidence'
  | 'code_evidence'
  | 'durable_memory'
  | 'derived_state'

export type ContextOwnershipTopic =
  | 'project_instruction'
  | 'project_profile'
  | 'workflow'
  | 'git'
  | 'task'
  | 'runtime'
  | 'ide'
  | 'code'
  | 'memory'
  | 'conversation'

export type ContextConflictPolicy =
  | 'render'
  | 'suppress_if_carried'
  | 'pointer_only'

export interface ContextOwnership {
  authority: ContextAuthority
  topic: ContextOwnershipTopic
  conflictPolicy: ContextConflictPolicy
  refs?: string[]
}

export interface CarriedContextMetadata {
  projectInstructionRefs: string[]
  gitStatusInSystemPrompt: boolean
  taskRefs: string[]
}
```

Extend `ContextRequest`:

```ts
transcriptAlreadyInModel?: boolean
carriedContext?: CarriedContextMetadata
```

Extend `ContextSection`:

```ts
ownership?: ContextOwnership
```

- [ ] **Step 4: Add schema support**

In `packages/core/src/context/schemas.ts`, add:

```ts
const ContextOwnershipSchema = z.object({
  authority: z.enum([
    'system_instruction',
    'project_instruction',
    'current_user',
    'live_state',
    'runtime_evidence',
    'code_evidence',
    'durable_memory',
    'derived_state',
  ]),
  topic: z.enum([
    'project_instruction',
    'project_profile',
    'workflow',
    'git',
    'task',
    'runtime',
    'ide',
    'code',
    'memory',
    'conversation',
  ]),
  conflictPolicy: z.enum(['render', 'suppress_if_carried', 'pointer_only']),
  refs: z.array(z.string()).optional(),
})

const CarriedContextMetadataSchema = z.object({
  projectInstructionRefs: z.array(z.string()),
  gitStatusInSystemPrompt: z.boolean(),
  taskRefs: z.array(z.string()),
})
```

Extend `ContextRequestSchema`:

```ts
transcriptAlreadyInModel: z.boolean().optional(),
carriedContext: CarriedContextMetadataSchema.optional(),
```

Extend `ContextSectionSchema` with:

```ts
ownership: ContextOwnershipSchema.optional(),
```

- [ ] **Step 5: Update provider helper**

In `packages/core/src/context/providers/shared.ts`, update the `section()` signature:

```ts
export function section(
  idParts: string[],
  kind: ContextSection['kind'],
  title: string,
  content: string,
  citations: ContextCitation[],
  priority: number,
  confidence: number,
  freshness: ContextSection['freshness'],
  sourceProvider: string,
  ownership?: ContextSection['ownership'],
): ContextSection {
```

Add the property to the returned object:

```ts
    ...(ownership ? { ownership } : {}),
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/context/protocol-schemas.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/context/types.ts packages/core/src/context/schemas.ts packages/core/src/context/providers/shared.ts packages/core/src/context/protocol-schemas.test.ts
git commit -m "feat(context): add context ownership metadata"
```

---

### Task 2: Expose System-Carried Project Instructions and Remove Full System Git Status

**Files:**
- Modify: `packages/core/src/context.ts`
- Test: `packages/core/src/context-system-prompt.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/core/src/context-system-prompt.test.ts`:

```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assembleSystemPrompt, loadInstructionSources } from './context.js'

const tmpDirs: string[] = []

afterEach(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true })
  tmpDirs.length = 0
})

describe('system prompt carried context', () => {
  it('returns refs for project instructions loaded into the system prompt', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-system-carried-'))
    tmpDirs.push(cwd)
    writeFileSync(path.join(cwd, 'JDCAGNET.md'), 'Project instruction.')
    mkdirSync(path.join(cwd, '.jdcagnet', 'rules'), { recursive: true })
    writeFileSync(path.join(cwd, '.jdcagnet', 'rules', 'style.md'), 'Use local style.')

    const sources = await loadInstructionSources(cwd)

    expect(sources.map((source) => source.ref)).toEqual(['JDCAGNET.md', '.jdcagnet/rules/style.md'])
    expect(sources.map((source) => source.scope)).toEqual(['project', 'rule'])
  })

  it('keeps current date but does not inject detailed git status in the generic system prompt', async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-system-git-'))
    tmpDirs.push(cwd)

    const text = (await assembleSystemPrompt({ cwd, toolDefs: [], toolNames: [] }))
      .map((segment) => segment.content)
      .join('\n')

    expect(text).toContain('# Current Date')
    expect(text).not.toContain('# Git Status')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/context-system-prompt.test.ts
```

Expected: FAIL because `loadInstructionSources` does not exist.

- [ ] **Step 3: Add instruction source API**

In `packages/core/src/context.ts`, add:

```ts
export interface InstructionSource {
  ref: string
  content: string
  scope: 'global' | 'project' | 'rule'
}

async function readInstructionCandidate(candidate: { ref: string; fullPath: string; scope: InstructionSource['scope'] }): Promise<InstructionSource | null> {
  try {
    return { ref: candidate.ref, content: await readFile(candidate.fullPath, 'utf-8'), scope: candidate.scope }
  } catch {
    return null
  }
}

export async function loadInstructionSources(cwd: string): Promise<InstructionSource[]> {
  const sources: InstructionSource[] = []

  for (const candidate of [
    { ref: '~/.jdcagnet/JDCAGNET.md', fullPath: path.join(CONFIG_DIR, 'JDCAGNET.md'), scope: 'global' as const },
    { ref: '~/.claude/CLAUDE.md', fullPath: path.join(os.homedir(), '.claude', 'CLAUDE.md'), scope: 'global' as const },
  ]) {
    const source = await readInstructionCandidate(candidate)
    if (source) {
      sources.push(source)
      break
    }
  }

  for (const candidate of [
    { ref: 'JDCAGNET.md', fullPath: path.join(cwd, 'JDCAGNET.md'), scope: 'project' as const },
    { ref: '.jdcagnet/JDCAGNET.md', fullPath: path.join(cwd, '.jdcagnet', 'JDCAGNET.md'), scope: 'project' as const },
    { ref: 'CLAUDE.md', fullPath: path.join(cwd, 'CLAUDE.md'), scope: 'project' as const },
    { ref: '.claude/CLAUDE.md', fullPath: path.join(cwd, '.claude', 'CLAUDE.md'), scope: 'project' as const },
    { ref: 'AGENTS.md', fullPath: path.join(cwd, 'AGENTS.md'), scope: 'project' as const },
    { ref: '.github/copilot-instructions.md', fullPath: path.join(cwd, '.github', 'copilot-instructions.md'), scope: 'project' as const },
    { ref: '.cursorrules', fullPath: path.join(cwd, '.cursorrules'), scope: 'project' as const },
  ]) {
    const source = await readInstructionCandidate(candidate)
    if (source) {
      sources.push(source)
      break
    }
  }

  for (const dir of [
    { prefix: '.jdcagnet/rules', fullPath: path.join(cwd, '.jdcagnet', 'rules') },
    { prefix: '.claude/rules', fullPath: path.join(cwd, '.claude', 'rules') },
  ]) {
    try {
      const files = (await readdir(dir.fullPath)).filter((file) => file.endsWith('.md')).sort()
      for (const file of files) {
        sources.push({
          ref: `${dir.prefix}/${file}`,
          content: `# ${file}\n${await readFile(path.join(dir.fullPath, file), 'utf-8')}`,
          scope: 'rule',
        })
      }
    } catch {}
  }

  return sources
}
```

- [ ] **Step 4: Use instruction sources in system prompt**

In `assembleSystemPrompt`, replace the existing global/project/rules loading block with:

```ts
const instructionSources = await loadInstructionSources(opts.cwd)
if (instructionSources.length > 0) {
  const instructionParts: string[] = []
  const global = instructionSources.filter((source) => source.scope === 'global')
  const project = instructionSources.filter((source) => source.scope === 'project')
  const rules = instructionSources.filter((source) => source.scope === 'rule')
  if (global.length) instructionParts.push(`# Global Instructions\n${global.map((source) => source.content).join('\n\n')}`)
  if (project.length) instructionParts.push(`# Project Instructions\n${project.map((source) => source.content).join('\n\n')}`)
  if (rules.length) instructionParts.push(`# Project Rules\n${rules.map((source) => source.content).join('\n\n')}`)
  segments.push({ content: instructionParts.join('\n\n'), cacheable: true })
}
```

Keep compatibility functions by rewriting them as:

```ts
export async function loadProjectMd(cwd: string): Promise<string | null> {
  return (await loadInstructionSources(cwd)).find((source) => source.scope === 'project')?.content ?? null
}

export async function loadGlobalMd(): Promise<string | null> {
  return (await loadInstructionSources(process.cwd())).find((source) => source.scope === 'global')?.content ?? null
}

export async function loadProjectRules(cwd: string): Promise<string[]> {
  return (await loadInstructionSources(cwd)).filter((source) => source.scope === 'rule').map((source) => source.content)
}
```

- [ ] **Step 5: Remove full Git Status from generic system prompt**

In `assembleSystemPrompt`, replace:

```ts
const dynamicParts: string[] = []
if (git.status) dynamicParts.push(`# Git Status\n${git.status}`)
const date = new Date().toISOString().split('T')[0]
dynamicParts.push(`# Current Date\n${date}`)
segments.push({ content: dynamicParts.join('\n\n'), cacheable: false })
```

with:

```ts
const date = new Date().toISOString().split('T')[0]
segments.push({ content: `# Current Date\n${date}`, cacheable: false })
```

The `# Environment` section may still include `Git branch`; detailed status belongs to `GitSignalProvider`.

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/context-system-prompt.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/context.ts packages/core/src/context-system-prompt.test.ts
git commit -m "refactor(context): expose system-carried instructions and move git status to engine"
```

---

### Task 3: Populate Carried Context Metadata in Foreground Requests

**Files:**
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/sub-session.ts`
- Modify: `packages/core/src/team/team-manager-ai.ts`
- Test: `packages/core/src/session-context.test.ts`

- [ ] **Step 1: Write failing session assertions**

In `packages/core/src/session-context.test.ts`, in the provider `collect` body of `injects a protocol-neutral context bundle before streaming and falls back when bundle generation fails`, add:

```ts
expect(request.transcriptAlreadyInModel).toBe(true)
expect(request.carriedContext).toMatchObject({
  gitStatusInSystemPrompt: false,
  projectInstructionRefs: expect.any(Array),
  taskRefs: expect.any(Array),
})
```

Add a focused test:

```ts
it('passes active task refs into context requests without copying task content', async () => {
  let captured: ContextRequest | undefined
  const session = await makeSession({
    provider: providerFromChunks([
      { type: 'text_delta', text: 'done' },
      { type: 'message_end', usage: { inputTokens: 1, outputTokens: 1 } },
    ]),
    contextConfig: { injectionEnabled: true, harvestEnabled: false },
    contextStore: makeContextStore(),
    contextProviders: [{
      id: 'runtime',
      collect: async (request: ContextRequest) => {
        captured = request
        return {
          evidence: [],
          sections: [],
          diagnostics: [],
          health: { id: 'runtime', status: 'enabled', updatedAt: 1 },
        }
      },
    }],
  })

  ;(session as any).taskStore.create('Fix retry UI', 'Make automatic retry visible')
  await session.sendMessage('continue current task', makeEvents())

  expect(captured?.carriedContext?.taskRefs.length).toBeGreaterThan(0)
  expect(JSON.stringify(captured?.carriedContext)).not.toContain('Fix retry UI')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/session-context.test.ts -t "context requests|active task refs"
```

Expected: FAIL because `carriedContext` is not yet populated.

- [ ] **Step 3: Implement session metadata**

In `packages/core/src/session.ts`, change the import:

```ts
import { assembleSystemPrompt, loadInstructionSources } from './context.js'
```

Add a helper to `Session`:

```ts
  private async buildCarriedContextMetadata() {
    const instructionSources = await loadInstructionSources(this.config.cwd)
    const activeTasks = this.history.getActiveTasks(this.id)
    return {
      projectInstructionRefs: instructionSources
        .filter((source) => source.scope === 'project' || source.scope === 'rule')
        .map((source) => source.ref),
      gitStatusInSystemPrompt: false,
      taskRefs: activeTasks.map((task) => String(task.id)),
    }
  }
```

Change `createContextRequest` to async:

```ts
private async createContextRequest(userMessage: string): Promise<ContextRequest> {
```

Inside it, before `return`, add:

```ts
const carriedContext = await this.buildCarriedContextMetadata()
```

Return these fields:

```ts
transcriptAlreadyInModel: true,
carriedContext,
```

In `injectContextForRunLoop`, replace:

```ts
const request = this.createContextRequest(userMessage)
```

with:

```ts
const request = await this.createContextRequest(userMessage)
```

- [ ] **Step 4: Update sub-session and Team PM request metadata**

In `packages/core/src/sub-session.ts`, add to the `buildContextBundle` request:

```ts
transcriptAlreadyInModel: true,
carriedContext: {
  projectInstructionRefs: [],
  gitStatusInSystemPrompt: false,
  taskRefs: [],
},
```

In `packages/core/src/team/team-manager-ai.ts`, add to the `buildContextBundle` request:

```ts
transcriptAlreadyInModel: true,
carriedContext: {
  projectInstructionRefs: [],
  gitStatusInSystemPrompt: false,
  taskRefs: [],
},
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
pnpm exec vitest run src/session-context.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session.ts packages/core/src/sub-session.ts packages/core/src/team/team-manager-ai.ts packages/core/src/session-context.test.ts
git commit -m "feat(context): pass carried context metadata into foreground requests"
```

---

### Task 4: Make Providers Label Authority and Avoid System-Carried Duplicates

**Files:**
- Modify: `packages/core/src/context/providers/project-provider.ts`
- Modify: `packages/core/src/context/providers/git-provider.ts`
- Modify: `packages/core/src/context/providers/runtime-provider.ts`
- Modify: `packages/core/src/context/providers/ide-provider.ts`
- Modify: `packages/core/src/context/providers/code-provider.ts`
- Modify: `packages/core/src/context/providers/memory-provider.ts`
- Modify: `packages/core/src/context/providers/conversation-provider.ts`
- Test: `packages/core/src/context/signal-providers.test.ts`

- [ ] **Step 1: Write failing project-provider dedupe test**

In `packages/core/src/context/signal-providers.test.ts`, add:

```ts
it('does not duplicate project instruction files already loaded into the system prompt', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'jdc-project-provider-dedupe-'))
  writeFileSync(join(cwd, 'JDCAGNET.md'), 'Instruction: use project style.')
  writeFileSync(join(cwd, 'AGENTS.md'), 'Agent instruction.')
  writeFileSync(join(cwd, 'README.md'), 'Project overview.')
  writeFileSync(join(cwd, 'package.json'), '{"scripts":{"test":"vitest"}}')

  const result = await collectProjectContext(request(cwd, {
    carriedContext: {
      projectInstructionRefs: ['JDCAGNET.md', 'AGENTS.md'],
      gitStatusInSystemPrompt: false,
      taskRefs: [],
    },
  }))

  const content = result.sections.map((section) => section.content).join('\n')
  expect(content).not.toContain('Instruction: use project style.')
  expect(content).not.toContain('Agent instruction.')
  expect(content).toContain('Project overview.')
  expect(content).toContain('package.json')
  expect(result.sections[0]?.ownership).toMatchObject({
    authority: 'live_state',
    topic: 'project_profile',
    conflictPolicy: 'render',
  })
})
```

Ensure imports include:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs'
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/context/signal-providers.test.ts -t "project instruction files"
```

Expected: FAIL because project provider currently includes `JDCAGNET.md` and does not attach ownership metadata.

- [ ] **Step 3: Update project provider**

In `packages/core/src/context/providers/project-provider.ts`, add:

```ts
function carriedInstructionRefs(request: ContextRequest): Set<string> {
  return new Set(request.carriedContext?.projectInstructionRefs ?? [])
}
```

Inside `collectProjectContext`, before the loop:

```ts
const carriedRefs = carriedInstructionRefs(request)
```

Inside the loop:

```ts
if (carriedRefs.has(fileName)) continue
```

When creating the section, pass ownership:

```ts
section(
  [request.sessionId, SOURCE, ...summaries],
  'project_profile',
  'Project profile',
  summaries.join('\n'),
  citations,
  60,
  0.86,
  'recent',
  SOURCE,
  { authority: 'live_state', topic: 'project_profile', conflictPolicy: 'render' },
)
```

- [ ] **Step 4: Add ownership to other providers**

Use these exact ownership values:

In `git-provider.ts`:

```ts
{ authority: 'live_state', topic: 'git', conflictPolicy: 'suppress_if_carried' }
```

In `runtime-provider.ts`:

```ts
{ authority: 'runtime_evidence', topic: 'runtime', conflictPolicy: 'render' }
```

In `ide-provider.ts`:

```ts
{ authority: 'live_state', topic: 'ide', conflictPolicy: 'render' }
```

In `code-provider.ts`:

```ts
{ authority: 'code_evidence', topic: 'code', conflictPolicy: 'render' }
```

In `memory-provider.ts`:

```ts
{ authority: 'durable_memory', topic: 'memory', conflictPolicy: 'render' }
```

In `conversation-provider.ts`:

```ts
{ authority: 'derived_state', topic: 'conversation', conflictPolicy: 'suppress_if_carried' }
```

- [ ] **Step 5: Run provider tests**

Run:

```bash
pnpm exec vitest run src/context/signal-providers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/context/providers packages/core/src/context/signal-providers.test.ts
git commit -m "feat(context): label provider authority and avoid instruction duplication"
```

---

### Task 5: Centralize Conflict Resolution Before Planning

**Files:**
- Create: `packages/core/src/context/conflict-resolver.ts`
- Add: `packages/core/src/context/conflict-resolver.test.ts`
- Modify: `packages/core/src/context/orchestrator.ts`
- Modify: `packages/core/src/context/planner.ts`
- Modify: `packages/core/src/context/context-planner.test.ts`
- Modify: `packages/core/src/context/context-orchestrator.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Create `packages/core/src/context/conflict-resolver.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveContextConflicts } from './conflict-resolver.js'
import type { ContextRequest, ContextSection } from './types.js'

describe('Context conflict resolver', () => {
  it('suppresses raw conversation transcript when provider messages already carry it', () => {
    const result = resolveContextConflicts(request({ transcriptAlreadyInModel: true }), [
      section({
        id: 'conversation_live',
        kind: 'conversation_state',
        title: 'Conversation state',
        sourceProvider: 'ConversationSignalProvider',
        content: 'user: duplicate',
        ownership: { authority: 'derived_state', topic: 'conversation', conflictPolicy: 'suppress_if_carried' },
      }),
      section({
        id: 'runtime_live',
        kind: 'runtime_state',
        title: 'Runtime state',
        sourceProvider: 'RuntimeSignalProvider',
        content: 'Read failed',
        ownership: { authority: 'runtime_evidence', topic: 'runtime', conflictPolicy: 'render' },
      }),
    ])

    expect(result.sections.map((item) => item.id)).toEqual(['runtime_live'])
    expect(result.suppressed).toEqual([{ id: 'conversation_live', reason: 'transcript_already_in_model_messages' }])
  })

  it('suppresses git state when detailed git status is already carried by system prompt', () => {
    const result = resolveContextConflicts(request({
      carriedContext: { projectInstructionRefs: [], gitStatusInSystemPrompt: true, taskRefs: [] },
    }), [
      section({
        id: 'git_live',
        kind: 'git_state',
        title: 'Git state',
        sourceProvider: 'GitSignalProvider',
        content: 'branch: main',
        ownership: { authority: 'live_state', topic: 'git', conflictPolicy: 'suppress_if_carried' },
      }),
    ])

    expect(result.sections).toEqual([])
    expect(result.suppressed).toEqual([{ id: 'git_live', reason: 'git_state_already_in_system_prompt' }])
  })
})

function request(overrides: Partial<ContextRequest> = {}): ContextRequest {
  return {
    sessionId: 'session_1',
    cwd: '/repo',
    userMessage: 'fix retry',
    recentMessages: [],
    mode: 'code_edit',
    model: 'test-model',
    runtime: {},
    createdAt: 1,
    ...overrides,
  }
}

function section(overrides: Partial<ContextSection>): ContextSection {
  return {
    id: 'section_1',
    kind: 'memory',
    title: 'Section',
    content: 'content',
    citations: [{ id: 'cit_1', type: 'message', ref: 'msg_1' }],
    priority: 50,
    confidence: 0.9,
    freshness: 'live',
    sourceProvider: 'test',
    tokenEstimate: 1,
    ...overrides,
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm exec vitest run src/context/conflict-resolver.test.ts
```

Expected: FAIL because `conflict-resolver.ts` does not exist.

- [ ] **Step 3: Implement resolver**

Create `packages/core/src/context/conflict-resolver.ts`:

```ts
import type { ContextDiagnostic, ContextRequest, ContextSection } from './types.js'
import { diagnostic } from './providers/shared.js'

export interface SuppressedContextSection {
  id: string
  reason: string
}

export interface ContextConflictResolution {
  sections: ContextSection[]
  suppressed: SuppressedContextSection[]
  diagnostics: ContextDiagnostic[]
}

export function resolveContextConflicts(request: ContextRequest, sections: ContextSection[]): ContextConflictResolution {
  const kept: ContextSection[] = []
  const suppressed: SuppressedContextSection[] = []

  for (const section of sections) {
    const reason = conflictReason(request, section)
    if (reason) {
      suppressed.push({ id: section.id, reason })
      continue
    }
    kept.push(section)
  }

  return {
    sections: kept,
    suppressed,
    diagnostics: suppressed.map((item) => {
      const section = sections.find((candidate) => candidate.id === item.id)
      const label = section ? `${section.kind} "${section.title}"` : item.id
      return diagnostic('ContextConflictResolver', 'info', `Suppressed context section ${item.id} (${label}): ${item.reason}.`, request.createdAt, false)
    }),
  }
}

function conflictReason(request: ContextRequest, section: ContextSection): string | null {
  if (
    request.transcriptAlreadyInModel === true &&
    section.ownership?.topic === 'conversation' &&
    section.ownership.conflictPolicy === 'suppress_if_carried' &&
    section.sourceProvider === 'ConversationSignalProvider' &&
    section.title === 'Conversation state'
  ) {
    return 'transcript_already_in_model_messages'
  }

  if (
    request.carriedContext?.gitStatusInSystemPrompt === true &&
    section.ownership?.topic === 'git' &&
    section.ownership.conflictPolicy === 'suppress_if_carried'
  ) {
    return 'git_state_already_in_system_prompt'
  }

  return null
}
```

- [ ] **Step 4: Integrate resolver into orchestrator**

In `packages/core/src/context/orchestrator.ts`, import:

```ts
import { resolveContextConflicts } from './conflict-resolver.js'
```

Replace:

```ts
const plan = planContext(request, rawSections)
const plannedSectionIds = new Set(plan.relevantSections)
const plannedSections = rawSections.filter((section) => plannedSectionIds.has(section.id))
```

with:

```ts
const conflictResolution = resolveContextConflicts(request, rawSections)
const plan = planContext(request, conflictResolution.sections)
const plannedSectionIds = new Set(plan.relevantSections)
const plannedSections = conflictResolution.sections.filter((section) => plannedSectionIds.has(section.id))
```

Replace diagnostics array:

```ts
...providerResults.diagnostics,
...storeFacts.diagnostics,
...diagnosticsFromPlan(plan, rawSections, now()),
```

with:

```ts
...providerResults.diagnostics,
...storeFacts.diagnostics,
...conflictResolution.diagnostics,
...diagnosticsFromPlan(plan, conflictResolution.sections, now()),
```

Update `shouldPersistDiagnostic`:

```ts
if (item.source === 'ContextConflictResolver' && item.message.startsWith('Suppressed context section ')) return true
```

- [ ] **Step 5: Remove authority suppression from planner**

In `packages/core/src/context/planner.ts`, ensure `suppressionReason` only handles low-salience diagnostics and stale low-value sections:

```ts
function suppressionReason(_request: ContextRequest, section: ContextSection): string | null {
  const content = section.content.toLowerCase()
  if (section.kind === 'diagnostics' && /model_noop|noop|no durable/.test(content)) return 'low_salience_diagnostic'
  if (section.freshness === 'stale' && isLowValueStaleSection(section)) return 'stale_low_value'
  return null
}
```

- [ ] **Step 6: Update planner test**

In `packages/core/src/context/context-planner.test.ts`, replace the transcript suppression test with:

```ts
it('leaves authority conflict decisions to the conflict resolver', () => {
  const plan = planContext(makeRequest({
    userMessage: '继续修复重试',
    transcriptAlreadyInModel: true,
  }), [
    section({
      id: 'conversation_live',
      kind: 'conversation_state',
      title: 'Conversation state',
      content: 'state summary, not raw transcript',
      freshness: 'live',
      sourceProvider: 'ConversationSignalProvider',
    }),
  ])

  expect(plan.relevantSections).toEqual(['conversation_live'])
  expect(plan.suppressedSections).toEqual([])
})
```

- [ ] **Step 7: Update orchestrator test**

In `packages/core/src/context/context-orchestrator.test.ts`, ensure the existing transcript duplicate test expects the conflict resolver diagnostic:

```ts
expect(result.bundle.diagnostics.some((item) =>
  item.source === 'ContextConflictResolver' &&
  item.message.includes('transcript_already_in_model_messages')
)).toBe(true)
```

- [ ] **Step 8: Run tests**

Run:

```bash
pnpm exec vitest run src/context/conflict-resolver.test.ts src/context/context-planner.test.ts src/context/context-orchestrator.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/context/conflict-resolver.ts packages/core/src/context/conflict-resolver.test.ts packages/core/src/context/orchestrator.ts packages/core/src/context/planner.ts packages/core/src/context/context-planner.test.ts packages/core/src/context/context-orchestrator.test.ts
git commit -m "feat(context): centralize authority conflict resolution"
```

---

### Task 6: Lock Behavior With Product Evals

**Files:**
- Modify: `packages/core/src/context/context-product-evals.test.ts`
- Modify: `packages/core/src/context/evals/index.ts`

- [ ] **Step 1: Add product test for project instruction suppression**

In `packages/core/src/context/context-product-evals.test.ts`, add:

```ts
it('does not inject project instruction files already carried by the system prompt', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'jdc-context-authority-'))
  tmpDirs.push(cwd)
  writeFileSync(path.join(cwd, 'JDCAGNET.md'), 'Instruction: prefer pnpm.')
  writeFileSync(path.join(cwd, 'README.md'), 'README project overview.')

  const result = await buildContextBundle(request({
    cwd,
    userMessage: 'How should I test this project?',
    carriedContext: {
      projectInstructionRefs: ['JDCAGNET.md'],
      gitStatusInSystemPrompt: false,
      taskRefs: [],
    },
  }), {
    injectionEnabled: true,
    store: makeStore(),
    providers: [{ id: 'project', collect: (req) => collectProjectContext(req) }],
    id: () => 'ctx_authority_project',
  })

  expect(result.renderedPrompt).not.toContain('Instruction: prefer pnpm.')
  expect(result.renderedPrompt).toContain('README project overview.')
})
```

Add imports if missing:

```ts
import { writeFileSync } from 'node:fs'
import { collectProjectContext } from './providers/project-provider.js'
```

- [ ] **Step 2: Add gate eval**

In `packages/core/src/context/evals/index.ts`, add this eval case to the gate list:

```ts
{
  name: 'Context authority suppresses system-carried project instructions',
  run: async () => {
    const fixture = makeEvalFixture()
    writeFileSync(path.join(fixture.cwd, 'JDCAGNET.md'), 'Instruction: do not duplicate.')
    writeFileSync(path.join(fixture.cwd, 'README.md'), 'Readable project overview.')
    const report = await buildContextBundle(makeEvalRequest({
      cwd: fixture.cwd,
      carriedContext: {
        projectInstructionRefs: ['JDCAGNET.md'],
        gitStatusInSystemPrompt: false,
        taskRefs: [],
      },
    }), {
      injectionEnabled: true,
      store: makeEvalStore(),
      providers: [{ id: 'project', collect: (request) => collectProjectContext(request) }],
      now: () => 1,
      id: () => 'ctx_authority_eval',
    })
    assert.equal(report.renderedPrompt.includes('Instruction: do not duplicate.'), false)
    assert.equal(report.renderedPrompt.includes('Readable project overview.'), true)
  },
}
```

Add imports if missing:

```ts
import path from 'node:path'
import { writeFileSync } from 'node:fs'
import { collectProjectContext } from '../providers/project-provider.js'
```

- [ ] **Step 3: Run product tests**

Run:

```bash
pnpm exec vitest run src/context/context-product-evals.test.ts src/context/context-evals.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/context/context-product-evals.test.ts packages/core/src/context/evals/index.ts
git commit -m "test(context): gate context ownership conflict behavior"
```

---

### Task 7: Full Verification

**Files:**
- No source changes unless verification exposes a failure.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm exec vitest run src/context-system-prompt.test.ts src/context/conflict-resolver.test.ts src/context/context-planner.test.ts src/context/context-orchestrator.test.ts src/context/signal-providers.test.ts src/context/protocol-schemas.test.ts src/context/context-product-evals.test.ts src/context/context-evals.test.ts src/session-context.test.ts
```

Expected: PASS for all listed files.

- [ ] **Step 2: Run Context Engine gate suite**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-evals.test.ts src/context/context-product-evals.test.ts src/context/context-retriever.test.ts src/context/store.test.ts src/tools/__tests__/context-engine-tools.test.ts tests/anthropic.test.ts tests/openai-chat.test.ts tests/openai-responses.test.ts src/session-context.test.ts src/context/context-harvest.test.ts src/context/context-redaction.test.ts src/context/context-safety.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 3: Run core build**

Run from repo root:

```bash
pnpm --filter @jdcagnet/core build
```

Expected: `tsc` exits 0.

- [ ] **Step 4: Inspect diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: changed files are limited to core context ownership implementation and tests.

- [ ] **Step 5: Commit verification fixes**

If Step 1-3 required source fixes, commit them:

```bash
git add packages/core/src/context packages/core/src/context.ts packages/core/src/session.ts packages/core/src/sub-session.ts packages/core/src/team/team-manager-ai.ts
git commit -m "fix(context): finalize context ownership verification"
```

If Step 1-3 passed without additional source changes, skip this commit.

---

## Self-Review

- **Spec coverage:** This plan covers system prompt/project instruction overlap, Git Status overlap, task refs, transcript duplication, provider authority labels, centralized conflict resolution, and product eval gates.
- **Placeholder scan:** No unresolved placeholder markers or incomplete tasks remain. Each task includes concrete file paths, code snippets, commands, and expected outcomes.
- **Type consistency:** The plan consistently uses `CarriedContextMetadata`, `ContextOwnership`, `ContextRequest.carriedContext`, `ContextSection.ownership`, and `resolveContextConflicts`.
- **Scope check:** The plan intentionally does not redesign memory distillation, UI inspection, or Context Panel rendering. Those should come after the ownership model lands.
