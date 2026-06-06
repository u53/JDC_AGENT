# JDC Agent Constraint Engine Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the edit-to-completion loop by deriving verification requirements from changed files, recording requirement outcomes from shell commands, and enforcing final-answer disclosure before a turn completes.

**Architecture:** Add a verification requirement planner under `packages/core/src/constraints/` that maps changed files and project scripts to small required commands. Extend the existing `VerificationLedger` so command results satisfy or fail specific requirements, then add a TurnEnd gate that appends a deterministic disclosure to final assistant messages when required verification is pending, unavailable, skipped, or failed.

**Tech Stack:** TypeScript, Vitest, existing `ToolRunner`, existing `ConstraintPolicyRuntime`, existing `VerificationLedger`, existing `Session.runLoop`, existing file mutation metadata, existing shell command metadata.

---

## Source Documents

- Design: `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`
- Phase 4 plan: `docs/superpowers/plans/2026-06-06-jdc-agent-constraint-engine-phase4.md`
- Phase 4 hardening commit: `dfd5a56 fix(context): harden phase 4 retrieval fallback`

## Scope

This plan covers Phase 5 only:

- derive verification requirements from changed files and package scripts;
- map shell command results to verification requirements;
- classify `git diff --check` as a docs/whitespace verification command;
- add a TurnEnd gate before final assistant message persistence;
- append final-answer disclosure for pending, failed, skipped, or unavailable verification;
- add product evals for verification-required and failed-verification disclosure.

This plan intentionally does not implement:

- model capability profiles;
- UI observability panels;
- Repo Wiki;
- model-assisted claim checking;
- automatic command execution without model/tool participation.

## Key Design Decision

Phase 5 should not turn verification into a hidden background action. The model still chooses and runs tools. The product runtime derives what verification is required, records what actually ran, and prevents an unsupported final answer from being persisted without disclosure.

Initial TurnEnd behavior is deterministic:

```text
1. If no files changed in this run loop, allow final answer.
2. If changed files have failed required verification, append a failed-verification disclosure.
3. If changed files have pending required verification, append a not-verified disclosure.
4. If verification is unavailable or skipped, append an unavailable/skipped disclosure.
5. If all required verification passed after the relevant changes, allow final answer.
```

Later phases can add model-assisted final claim checking and richer UI. Phase 5 focuses on runtime truthfulness.

## File Boundary Map

Create:

- `packages/core/src/constraints/verification-requirements.ts`
- `packages/core/src/constraints/verification-requirements.test.ts`
- `packages/core/src/constraints/turn-end-gate.ts`
- `packages/core/src/constraints/turn-end-gate.test.ts`

Modify:

- `packages/core/src/constraints/verification-ledger.ts`
- `packages/core/src/constraints/verification-ledger.test.ts`
- `packages/core/src/constraints/tool-output-classifier.ts`
- `packages/core/src/constraints/tool-output-classifier.test.ts`
- `packages/core/src/constraints/policy-runtime.ts`
- `packages/core/src/constraints/policy-runtime.test.ts`
- `packages/core/src/session.ts`
- `packages/core/src/session-context.test.ts`
- `packages/core/src/context/context-product-evals.test.ts`
- `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`

## Global Acceptance Gates

Run these after the final task:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/verification-requirements.test.ts src/constraints/verification-ledger.test.ts src/constraints/tool-output-classifier.test.ts src/constraints/turn-end-gate.test.ts src/constraints/policy-runtime.test.ts src/session-context.test.ts src/context/context-product-evals.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
pnpm --filter @jdcagnet/core test -- --run --no-file-parallelism
git diff --check
```

Expected final result: all commands pass.

---

## Task 1: Verification Requirement Derivation

**Goal:** Convert changed files and available project scripts into deterministic verification requirements.

**Files:**

- Create: `packages/core/src/constraints/verification-requirements.ts`
- Create: `packages/core/src/constraints/verification-requirements.test.ts`

- [ ] **Step 1: Add failing derivation tests**

Create `packages/core/src/constraints/verification-requirements.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { deriveVerificationRequirements } from './verification-requirements.js'

function tempProject(): string {
  return mkdtempSync(path.join(tmpdir(), 'jdc-phase5-verify-'))
}

describe('deriveVerificationRequirements', () => {
  it('requires test and build for TypeScript source changes when scripts exist', async () => {
    const cwd = tempProject()
    writeFileSync(path.join(cwd, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({
      scripts: {
        build: 'tsc',
        test: 'vitest run',
      },
    }))

    const plan = await deriveVerificationRequirements({
      cwd,
      changedFiles: ['packages/core/src/session.ts'],
      userMessage: '修复 session',
    })

    expect(plan.requirements).toEqual([
      expect.objectContaining({
        id: 'verify_test',
        kind: 'test',
        command: 'pnpm test',
        status: 'pending',
        files: ['packages/core/src/session.ts'],
      }),
      expect.objectContaining({
        id: 'verify_build',
        kind: 'build',
        command: 'pnpm build',
        status: 'pending',
      }),
    ])
  })

  it('requires git diff check for docs-only changes', async () => {
    const cwd = tempProject()
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' } }))

    const plan = await deriveVerificationRequirements({
      cwd,
      changedFiles: ['docs/superpowers/plans/phase5.md'],
      userMessage: '写计划',
    })

    expect(plan.requirements).toEqual([
      expect.objectContaining({
        id: 'verify_diff_check',
        kind: 'diff_check',
        command: 'git diff --check',
        status: 'pending',
      }),
    ])
  })

  it('marks unavailable script-backed requirements when no matching script exists', async () => {
    const cwd = tempProject()
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: {} }))

    const plan = await deriveVerificationRequirements({
      cwd,
      changedFiles: ['src/app.ts'],
      userMessage: '修复 app',
    })

    expect(plan.requirements).toContainEqual(expect.objectContaining({
      id: 'verify_test',
      kind: 'test',
      status: 'unavailable',
      reason: 'No test script found in package.json.',
    }))
    expect(plan.requirements).toContainEqual(expect.objectContaining({
      id: 'verify_build',
      kind: 'build',
      status: 'unavailable',
      reason: 'No build script found in package.json.',
    }))
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/verification-requirements.test.ts --no-file-parallelism
```

Expected: FAIL because `verification-requirements.ts` does not exist.

- [ ] **Step 3: Implement requirement derivation**

Create `packages/core/src/constraints/verification-requirements.ts`:

```ts
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { VerificationKind } from './verification-ledger.js'

export type VerificationRequirementStatus = 'pending' | 'passed' | 'failed' | 'skipped' | 'unavailable'

export interface VerificationRequirement {
  id: string
  kind: VerificationKind
  command: string
  status: VerificationRequirementStatus
  files: string[]
  reason: string
}

export interface VerificationRequirementPlan {
  cwd: string
  changedFiles: string[]
  requirements: VerificationRequirement[]
}

export async function deriveVerificationRequirements(input: {
  cwd: string
  changedFiles: string[]
  userMessage: string
}): Promise<VerificationRequirementPlan> {
  const changedFiles = unique(input.changedFiles.map(normalizePath).filter(Boolean))
  if (changedFiles.length === 0) return { cwd: input.cwd, changedFiles, requirements: [] }

  const packageInfo = await readRootPackageInfo(input.cwd)
  const packageManager = detectPackageManager(input.cwd)
  const requirements: VerificationRequirement[] = []

  if (isDocsOnly(changedFiles)) {
    requirements.push({
      id: 'verify_diff_check',
      kind: 'diff_check',
      command: 'git diff --check',
      status: 'pending',
      files: changedFiles,
      reason: 'Documentation-only changes require whitespace/conflict-marker verification.',
    })
    return { cwd: input.cwd, changedFiles, requirements }
  }

  if (hasCodeChange(changedFiles)) {
    requirements.push(scriptRequirement({
      id: 'verify_test',
      kind: 'test',
      scriptName: 'test',
      packageManager,
      scripts: packageInfo.scripts,
      files: changedFiles,
      missingReason: 'No test script found in package.json.',
    }))
    requirements.push(scriptRequirement({
      id: 'verify_build',
      kind: 'build',
      scriptName: 'build',
      packageManager,
      scripts: packageInfo.scripts,
      files: changedFiles,
      missingReason: 'No build script found in package.json.',
    }))
  }

  if (hasTypeScriptChange(changedFiles) && packageInfo.scripts.typecheck) {
    requirements.push(scriptRequirement({
      id: 'verify_typecheck',
      kind: 'typecheck',
      scriptName: 'typecheck',
      packageManager,
      scripts: packageInfo.scripts,
      files: changedFiles,
      missingReason: 'No typecheck script found in package.json.',
    }))
  }

  if (changesPackageOrConfig(changedFiles) && packageInfo.scripts.build && !requirements.some((requirement) => requirement.kind === 'build')) {
    requirements.push(scriptRequirement({
      id: 'verify_build',
      kind: 'build',
      scriptName: 'build',
      packageManager,
      scripts: packageInfo.scripts,
      files: changedFiles,
      missingReason: 'No build script found in package.json.',
    }))
  }

  return { cwd: input.cwd, changedFiles, requirements: dedupeRequirements(requirements) }
}

function scriptRequirement(input: {
  id: string
  kind: VerificationKind
  scriptName: string
  packageManager: string
  scripts: Record<string, string>
  files: string[]
  missingReason: string
}): VerificationRequirement {
  const hasScript = typeof input.scripts[input.scriptName] === 'string' && input.scripts[input.scriptName].trim().length > 0
  return {
    id: input.id,
    kind: input.kind,
    command: `${input.packageManager} ${input.scriptName}`,
    status: hasScript ? 'pending' : 'unavailable',
    files: input.files,
    reason: hasScript ? `${input.scriptName} script covers changed files.` : input.missingReason,
  }
}

async function readRootPackageInfo(cwd: string): Promise<{ scripts: Record<string, string> }> {
  try {
    const raw = await readFile(path.join(cwd, 'package.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> }
    const scripts: Record<string, string> = {}
    for (const [name, command] of Object.entries(parsed.scripts ?? {})) {
      if (typeof command === 'string') scripts[name] = command
    }
    return { scripts }
  } catch {
    return { scripts: {} }
  }
}

function detectPackageManager(cwd: string): 'pnpm' | 'yarn' | 'bun' | 'npm' {
  if (existsSync(path.join(cwd, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(path.join(cwd, 'yarn.lock'))) return 'yarn'
  if (existsSync(path.join(cwd, 'bun.lockb')) || existsSync(path.join(cwd, 'bun.lock'))) return 'bun'
  return 'npm'
}

function hasCodeChange(files: string[]): boolean {
  return files.some((file) => /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|rs|go|java|kt|swift|css|scss|vue|svelte)$/i.test(file))
}

function hasTypeScriptChange(files: string[]): boolean {
  return files.some((file) => /\.(ts|tsx|mts|cts)$/i.test(file))
}

function changesPackageOrConfig(files: string[]): boolean {
  return files.some((file) => /(^|\/)(package\.json|tsconfig[^/]*\.json|vite\.config\.[^/]+|vitest\.config\.[^/]+|eslint\.config\.[^/]+)$/i.test(file))
}

function isDocsOnly(files: string[]): boolean {
  return files.length > 0 && files.every((file) => /\.(md|mdx|txt|rst|adoc)$/i.test(file) || file.startsWith('docs/'))
}

function normalizePath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '')
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function dedupeRequirements(requirements: VerificationRequirement[]): VerificationRequirement[] {
  const seen = new Set<string>()
  const out: VerificationRequirement[] = []
  for (const requirement of requirements) {
    const key = `${requirement.kind}:${requirement.command}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(requirement)
  }
  return out
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/verification-requirements.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/constraints/verification-requirements.ts packages/core/src/constraints/verification-requirements.test.ts
git commit -m "feat(constraints): derive verification requirements"
```

---

## Task 2: Requirement-Aware Verification Ledger

**Goal:** Track required verification separately from changed-file status and update requirements when commands run.

**Files:**

- Modify: `packages/core/src/constraints/verification-ledger.ts`
- Modify: `packages/core/src/constraints/verification-ledger.test.ts`

- [ ] **Step 1: Add failing ledger tests**

Modify `packages/core/src/constraints/verification-ledger.test.ts`:

```ts
it('tracks verification requirements and marks matching commands passed', () => {
  const ledger = new VerificationLedger({ now: () => 100 })
  ledger.recordMutation({ filePath: 'src/app.ts', toolUseId: 'edit_1' })
  ledger.setRequirements([{
    id: 'verify_test',
    kind: 'test',
    command: 'pnpm test',
    status: 'pending',
    files: ['src/app.ts'],
    reason: 'test script covers changed files.',
  }])

  ledger.recordCommand({
    toolUseId: 'bash_1',
    command: 'pnpm test',
    kind: 'test',
    status: 'passed',
    output: 'ok',
  })

  expect(ledger.getRequirements()).toEqual([expect.objectContaining({
    id: 'verify_test',
    status: 'passed',
    satisfiedByToolUseId: 'bash_1',
  })])
})

it('keeps failed requirements visible for the turn-end gate', () => {
  const ledger = new VerificationLedger({ now: () => 100 })
  ledger.recordMutation({ filePath: 'src/app.ts', toolUseId: 'edit_1' })
  ledger.setRequirements([{
    id: 'verify_test',
    kind: 'test',
    command: 'pnpm test',
    status: 'pending',
    files: ['src/app.ts'],
    reason: 'test script covers changed files.',
  }])

  ledger.recordCommand({
    toolUseId: 'bash_1',
    command: 'pnpm test',
    kind: 'test',
    status: 'failed',
    output: '1 failed',
  })

  expect(ledger.getRequirements()).toEqual([expect.objectContaining({
    id: 'verify_test',
    status: 'failed',
    failure: '1 failed',
  })])
})
```

- [ ] **Step 2: Run ledger tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/verification-ledger.test.ts --no-file-parallelism
```

Expected: FAIL because `setRequirements()` and `getRequirements()` do not exist.

- [ ] **Step 3: Extend ledger types and storage**

Modify `packages/core/src/constraints/verification-ledger.ts`:

```ts
export type VerificationKind = 'build' | 'test' | 'typecheck' | 'lint' | 'diff_check'
export type VerificationRequirementStatus = 'pending' | 'passed' | 'failed' | 'skipped' | 'unavailable'

export interface VerificationRequirementRecord {
  id: string
  kind: VerificationKind
  command: string
  status: VerificationRequirementStatus
  files: string[]
  reason: string
  satisfiedByToolUseId?: string
  failure?: string
  updatedAt?: number
}
```

Add a private field:

```ts
  private requirements = new Map<string, VerificationRequirementRecord>()
```

Add methods:

```ts
  setRequirements(requirements: VerificationRequirementRecord[]): void {
    for (const requirement of requirements) {
      const existing = this.requirements.get(requirement.id)
      if (existing && existing.status === 'passed') continue
      this.requirements.set(requirement.id, {
        ...requirement,
        updatedAt: requirement.updatedAt ?? this.now(),
      })
    }
  }

  getRequirements(): VerificationRequirementRecord[] {
    return [...this.requirements.values()]
  }
```

Update `clear()`:

```ts
    this.requirements.clear()
```

- [ ] **Step 4: Update requirements when commands run**

In `recordCommand()`, after `this.applyCommandToPendingChanges(record)`, add:

```ts
    this.applyCommandToRequirements(record)
```

Add:

```ts
  private applyCommandToRequirements(command: VerificationCommandRecord): void {
    for (const requirement of this.requirements.values()) {
      if (requirement.kind !== command.kind) continue
      requirement.updatedAt = this.now()
      requirement.satisfiedByToolUseId = command.toolUseId
      if (command.status === 'passed') {
        requirement.status = 'passed'
        delete requirement.failure
      } else {
        requirement.status = 'failed'
        requirement.failure = command.output.slice(0, 500)
      }
    }
  }
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/verification-ledger.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/constraints/verification-ledger.ts packages/core/src/constraints/verification-ledger.test.ts
git commit -m "feat(constraints): track verification requirements"
```

---

## Task 3: Command Classification For Diff Check

**Goal:** Make docs-only verification commands update the ledger.

**Files:**

- Modify: `packages/core/src/constraints/tool-output-classifier.ts`
- Modify: `packages/core/src/constraints/tool-output-classifier.test.ts`
- Modify: `packages/core/src/constraints/policy-runtime.test.ts`

- [ ] **Step 1: Add failing classifier test**

Modify `packages/core/src/constraints/tool-output-classifier.test.ts`:

```ts
it('classifies git diff check as diff_check verification', () => {
  expect(classifyVerificationCommand('git diff --check')).toEqual({ kind: 'diff_check' })
  expect(classifyVerificationCommand('cd packages/core && git diff --check')).toEqual({ kind: 'diff_check' })
})
```

- [ ] **Step 2: Run classifier tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/tool-output-classifier.test.ts --no-file-parallelism
```

Expected: FAIL because `git diff --check` is not classified.

- [ ] **Step 3: Classify diff check commands**

Modify `packages/core/src/constraints/tool-output-classifier.ts` inside `classifyCommandSegment()`:

```ts
  if (/^git\s+diff\s+--check\b/.test(normalized)) return 'diff_check'
```

Keep this after `normalized` is computed and before package-manager checks.

- [ ] **Step 4: Add policy runtime regression**

Modify `packages/core/src/constraints/policy-runtime.test.ts`:

```ts
it('records git diff check as a passed verification command', () => {
  const runtime = new ConstraintPolicyRuntime({ now: () => 100 })
  runtime.verificationLedger.setRequirements([{
    id: 'verify_diff_check',
    kind: 'diff_check',
    command: 'git diff --check',
    status: 'pending',
    files: ['docs/plan.md'],
    reason: 'Docs-only changes require diff check.',
  }])

  runtime.postToolUse({
    toolName: 'Bash',
    toolUseId: 'bash_1',
    input: { command: 'git diff --check' },
    cwd: '/repo',
    fileReadState: new FileReadStateCache(),
    result: {
      content: '',
      metadata: { command: { shell: 'bash', command: 'git diff --check', exitCode: 0 } },
    },
  })

  expect(runtime.verificationLedger.getRequirements()[0]).toMatchObject({
    id: 'verify_diff_check',
    status: 'passed',
  })
})
```

Add imports if the test file does not already import `FileReadStateCache`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/tool-output-classifier.test.ts src/constraints/policy-runtime.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/constraints/tool-output-classifier.ts packages/core/src/constraints/tool-output-classifier.test.ts packages/core/src/constraints/policy-runtime.test.ts
git commit -m "feat(constraints): classify diff check verification"
```

---

## Task 4: TurnEnd Gate

**Goal:** Evaluate final-answer safety from changed files, requirements, and command records.

**Files:**

- Create: `packages/core/src/constraints/turn-end-gate.ts`
- Create: `packages/core/src/constraints/turn-end-gate.test.ts`

- [ ] **Step 1: Add failing TurnEnd gate tests**

Create `packages/core/src/constraints/turn-end-gate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { evaluateTurnEndGate } from './turn-end-gate.js'
import type { ChangedFileRecord, VerificationRequirementRecord } from './verification-ledger.js'

const changedFile: ChangedFileRecord = {
  filePath: 'src/app.ts',
  changedByToolUseId: 'edit_1',
  changedAt: 100,
  status: 'pending',
  updatedAt: 100,
}

function requirement(input: Partial<VerificationRequirementRecord> = {}): VerificationRequirementRecord {
  return {
    id: 'verify_test',
    kind: 'test',
    command: 'pnpm test',
    status: 'pending',
    files: ['src/app.ts'],
    reason: 'test script covers changed files.',
    ...input,
  }
}

describe('evaluateTurnEndGate', () => {
  it('allows final response when no files changed', () => {
    expect(evaluateTurnEndGate({ changedFiles: [], requirements: [], assistantText: 'Done.' })).toEqual({ action: 'allow' })
  })

  it('appends disclosure for pending required verification', () => {
    const decision = evaluateTurnEndGate({
      changedFiles: [changedFile],
      requirements: [requirement()],
      assistantText: '修好了。',
    })

    expect(decision).toEqual(expect.objectContaining({
      action: 'append_disclosure',
      severity: 'warning',
    }))
    if (decision.action === 'append_disclosure') {
      expect(decision.disclosure).toContain('Verification not completed')
      expect(decision.disclosure).toContain('pnpm test')
    }
  })

  it('appends failure disclosure for failed verification', () => {
    const decision = evaluateTurnEndGate({
      changedFiles: [{ ...changedFile, status: 'failed', verificationFailure: '1 failed' }],
      requirements: [requirement({ status: 'failed', failure: '1 failed' })],
      assistantText: '完成。',
    })

    expect(decision).toEqual(expect.objectContaining({
      action: 'append_disclosure',
      severity: 'error',
    }))
    if (decision.action === 'append_disclosure') {
      expect(decision.disclosure).toContain('Verification failed')
      expect(decision.disclosure).toContain('1 failed')
    }
  })

  it('allows final response when all requirements passed', () => {
    expect(evaluateTurnEndGate({
      changedFiles: [{ ...changedFile, status: 'verified' }],
      requirements: [requirement({ status: 'passed', satisfiedByToolUseId: 'bash_1' })],
      assistantText: '完成，测试已通过。',
    })).toEqual({ action: 'allow' })
  })
})
```

- [ ] **Step 2: Run TurnEnd tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/turn-end-gate.test.ts --no-file-parallelism
```

Expected: FAIL because `turn-end-gate.ts` does not exist.

- [ ] **Step 3: Implement TurnEnd gate**

Create `packages/core/src/constraints/turn-end-gate.ts`:

```ts
import type { ChangedFileRecord, VerificationRequirementRecord } from './verification-ledger.js'

export type TurnEndGateDecision =
  | { action: 'allow' }
  | { action: 'append_disclosure'; severity: 'warning' | 'error'; disclosure: string }

export function evaluateTurnEndGate(input: {
  changedFiles: ChangedFileRecord[]
  requirements: VerificationRequirementRecord[]
  assistantText: string
}): TurnEndGateDecision {
  if (input.changedFiles.length === 0) return { action: 'allow' }

  const failed = input.requirements.filter((requirement) => requirement.status === 'failed')
  if (failed.length) {
    return {
      action: 'append_disclosure',
      severity: 'error',
      disclosure: disclosureBlock('Verification failed', failed.map(formatRequirement)),
    }
  }

  const pending = input.requirements.filter((requirement) => requirement.status === 'pending')
  if (pending.length) {
    return {
      action: 'append_disclosure',
      severity: 'warning',
      disclosure: disclosureBlock('Verification not completed', pending.map(formatRequirement)),
    }
  }

  const unavailable = input.requirements.filter((requirement) => requirement.status === 'unavailable' || requirement.status === 'skipped')
  if (unavailable.length) {
    return {
      action: 'append_disclosure',
      severity: 'warning',
      disclosure: disclosureBlock('Verification unavailable or skipped', unavailable.map(formatRequirement)),
    }
  }

  const unresolvedFiles = input.changedFiles.filter((file) => file.status === 'pending' || file.status === 'failed')
  if (unresolvedFiles.length && input.requirements.length === 0) {
    return {
      action: 'append_disclosure',
      severity: 'warning',
      disclosure: disclosureBlock('Verification not derived', unresolvedFiles.map((file) => `- ${file.filePath}: no verification requirement was available.`)),
    }
  }

  return { action: 'allow' }
}

function disclosureBlock(title: string, lines: string[]): string {
  return [
    '',
    `Verification status: ${title}.`,
    ...lines,
  ].join('\n')
}

function formatRequirement(requirement: VerificationRequirementRecord): string {
  const suffix = requirement.status === 'failed' && requirement.failure ? ` (${requirement.failure})` : ''
  return `- ${requirement.kind}: ${requirement.command} -> ${requirement.status}${suffix}`
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/turn-end-gate.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/constraints/turn-end-gate.ts packages/core/src/constraints/turn-end-gate.test.ts
git commit -m "feat(constraints): add turn-end verification gate"
```

---

## Task 5: Session Integration And Final Disclosure

**Goal:** Apply the TurnEnd gate before final assistant messages are persisted or completed.

**Files:**

- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/session-context.test.ts`

- [ ] **Step 1: Add failing session disclosure tests**

Modify `packages/core/src/session-context.test.ts` with tests near the existing `Session JDC Context Engine runtime integration` suite:

```ts
it('appends verification disclosure when final answer follows an unverified edit', async () => {
  const session = makeSessionWithProvider([
    assistantToolUse('toolu_write', 'file_write', { file_path: 'src/app.ts', content: 'export const value = 1\n' }),
    assistantText('Done, fixed.'),
  ])
  const completed: Message[] = []

  await session.sendMessage('修复 src/app.ts', events({ onMessageComplete: (message) => completed.push(message) }))

  const finalAssistant = completed.filter((message) => message.role === 'assistant').at(-1)
  expect(textContent(finalAssistant)).toContain('Verification status: Verification not completed.')
})

it('appends failed verification disclosure when a required command failed', async () => {
  const session = makeSessionWithProvider([
    assistantToolUse('toolu_write', 'file_write', { file_path: 'src/app.ts', content: 'export const value = 1\n' }),
    assistantToolUse('toolu_test', 'Bash', { command: 'pnpm test' }),
    assistantText('All done.'),
  ], {
    toolResults: {
      toolu_test: { content: '1 failed', is_error: true, metadata: { command: { shell: 'bash', command: 'pnpm test', exitCode: 1 } } },
    },
  })
  const completed: Message[] = []

  await session.sendMessage('修复 src/app.ts', events({ onMessageComplete: (message) => completed.push(message) }))

  const finalAssistant = completed.filter((message) => message.role === 'assistant').at(-1)
  expect(textContent(finalAssistant)).toContain('Verification status: Verification failed.')
  expect(textContent(finalAssistant)).toContain('1 failed')
})
```

Use existing session test helpers where available. If the file has no reusable provider helpers for tool-use sequences, add small local helpers in the test file that emit `tool_use_start`, `tool_use_end`, `text_delta`, and `message_end` chunks.

- [ ] **Step 2: Run session tests and verify they fail**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts --no-file-parallelism
```

Expected: FAIL because the session does not derive requirements or append disclosure.

- [ ] **Step 3: Add session helper methods**

Modify `packages/core/src/session.ts` imports:

```ts
import { deriveVerificationRequirements } from './constraints/verification-requirements.js'
import { evaluateTurnEndGate } from './constraints/turn-end-gate.js'
```

Add helper methods inside `Session`:

```ts
  private async refreshVerificationRequirementsForRunLoop(userMessage: string): Promise<void> {
    const changedFiles = this.toolRunner.constraintRuntime.verificationLedger.getChangedFiles().map((file) => file.filePath)
    const plan = await deriveVerificationRequirements({
      cwd: this.config.cwd,
      changedFiles,
      userMessage,
    })
    this.toolRunner.constraintRuntime.verificationLedger.setRequirements(plan.requirements)
  }

  private appendDisclosureToContent(content: any[], disclosure: string): any[] {
    const next = [...content]
    const lastText = [...next].reverse().find((block) => block.type === 'text')
    if (lastText) {
      lastText.text = `${lastText.text}\n\n${disclosure.trim()}`
      return next
    }
    next.push({ type: 'text', text: disclosure.trim() })
    return next
  }

  private textFromAssistantContent(content: any[]): string {
    return content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
  }
```

- [ ] **Step 4: Apply gate before final assistant persistence**

In `runLoop()`, after `const reorderedContent = reorderAssistantContent(assistantContent)` and before `const assistantMessage`, replace the const with a mutable variable:

```ts
      let finalContent = reorderAssistantContent(assistantContent)
      if (!hasToolUse) {
        await this.refreshVerificationRequirementsForRunLoop(runLoopUserMessage)
        const turnEndDecision = evaluateTurnEndGate({
          changedFiles: this.toolRunner.constraintRuntime.verificationLedger.getChangedFiles(),
          requirements: this.toolRunner.constraintRuntime.verificationLedger.getRequirements(),
          assistantText: this.textFromAssistantContent(finalContent),
        })
        if (turnEndDecision.action === 'append_disclosure') {
          finalContent = this.appendDisclosureToContent(finalContent, turnEndDecision.disclosure)
          events.onStreamChunk({ type: 'text_delta', text: `\n\n${turnEndDecision.disclosure.trim()}` } as any)
        }
      }
```

Then construct the assistant message with `finalContent`:

```ts
        content: finalContent,
```

Keep tool-use assistant messages unchanged. The gate only applies to final assistant messages with no tool calls.

- [ ] **Step 5: Run focused session tests**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts --no-file-parallelism
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session.ts packages/core/src/session-context.test.ts
git commit -m "feat(session): disclose unverified final answers"
```

---

## Task 6: Product Evals And Design Decision

**Goal:** Lock Phase 5 behavior into product evals and update the design decision notes.

**Files:**

- Modify: `packages/core/src/context/context-product-evals.test.ts`
- Modify: `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md`

- [ ] **Step 1: Add product eval for verification-required disclosure**

Modify `packages/core/src/context/context-product-evals.test.ts`:

```ts
it('Phase 5 eval: final answer discloses pending verification after edit', () => {
  const decision = evaluateTurnEndGate({
    changedFiles: [{
      filePath: 'packages/core/src/session.ts',
      changedByToolUseId: 'edit_1',
      changedAt: 100,
      status: 'pending',
      updatedAt: 100,
    }],
    requirements: [{
      id: 'verify_test',
      kind: 'test',
      command: 'pnpm test',
      status: 'pending',
      files: ['packages/core/src/session.ts'],
      reason: 'test script covers changed files.',
    }],
    assistantText: '修好了。',
  })

  expect(decision).toEqual(expect.objectContaining({ action: 'append_disclosure' }))
  if (decision.action === 'append_disclosure') {
    expect(decision.disclosure).toContain('Verification not completed')
  }
})
```

Add imports:

```ts
import { evaluateTurnEndGate } from '../constraints/turn-end-gate.js'
```

- [ ] **Step 2: Add product eval for failed verification disclosure**

Add:

```ts
it('Phase 5 eval: final answer discloses failed verification', () => {
  const decision = evaluateTurnEndGate({
    changedFiles: [{
      filePath: 'packages/core/src/session.ts',
      changedByToolUseId: 'edit_1',
      changedAt: 100,
      status: 'failed',
      verificationFailure: '1 failed',
      updatedAt: 100,
    }],
    requirements: [{
      id: 'verify_test',
      kind: 'test',
      command: 'pnpm test',
      status: 'failed',
      files: ['packages/core/src/session.ts'],
      reason: 'test script covers changed files.',
      failure: '1 failed',
    }],
    assistantText: 'All done.',
  })

  expect(decision).toEqual(expect.objectContaining({ action: 'append_disclosure', severity: 'error' }))
  if (decision.action === 'append_disclosure') {
    expect(decision.disclosure).toContain('Verification failed')
    expect(decision.disclosure).toContain('1 failed')
  }
})
```

- [ ] **Step 3: Update design document**

Modify `docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md` near the implementation decision notes:

```md
Phase 5 implementation decision:

- Verification requirements are derived from changed files, root package scripts, package-manager lockfiles, and docs-only changes.
- `VerificationLedger` stores both changed-file records and verification requirement records.
- Shell command metadata updates matching verification requirements by kind.
- `git diff --check` is classified as `diff_check` verification for docs and whitespace-sensitive changes.
- `Session.runLoop()` applies a deterministic TurnEnd gate before final assistant messages are persisted.
- Phase 5 appends disclosure for pending, unavailable, skipped, or failed verification; it does not silently run commands or add model-assisted final-claim checking.
- UI observability and model profile strictness remain deferred to later phases.
```

- [ ] **Step 4: Run eval and docs checks**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/context/context-product-evals.test.ts --no-file-parallelism
git diff --check -- docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/context/context-product-evals.test.ts docs/superpowers/specs/2026-06-05-jdc-agent-constraint-engine-design.md
git commit -m "test(context): add phase 5 verification evals"
```

---

## Task 7: Final Integration Gate

**Goal:** Verify the whole Phase 5 slice and leave a clean branch.

**Files:**

- Review all files changed by Tasks 1-6.

- [ ] **Step 1: Run Phase 5 focused suite**

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/constraints/verification-requirements.test.ts src/constraints/verification-ledger.test.ts src/constraints/tool-output-classifier.test.ts src/constraints/turn-end-gate.test.ts src/constraints/policy-runtime.test.ts src/session-context.test.ts src/context/context-product-evals.test.ts --no-file-parallelism
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

Expected: recent commits contain Phase 5 requirement derivation, ledger, classifier, TurnEnd gate, session integration, eval, and design-doc changes.

- [ ] **Step 6: Final status**

Run:

```bash
git status --short --branch
```

Expected: clean working tree on the implementation branch, ahead by the Phase 5 commits.
