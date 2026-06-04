# JDC CODE Compaction Recovery Protocol

Use this protocol after conversation compression, after a long pause, after an interrupted turn, or whenever the user says "继续", "下一步", "where were we", "resume", or similar.

The goal is simple: recover from durable project state instead of hallucinating from a compressed summary.

## Recovery Rule

Do not continue from memory alone. Recover from files, git state, task state, routed docs, and JDC Context Engine facts.

## Step 1: Establish Current Repository State

Run or inspect:

```bash
git status --short --branch
git log --oneline -8
```

Check:

- current branch
- whether main is ahead/behind
- uncommitted files
- recent commits
- whether previous work was already committed or pushed

If there are uncommitted changes, assume they may be user changes unless you know you made them.

## Step 2: Re-read Durable Instructions

Read:

1. `JDCAGNET.md`
2. `docs/jdc-code/OPERATING_CONTRACT.md`
3. `docs/jdc-code/DOC_ROUTER.md`

If the task is about JDC Context Engine, also read:

1. `docs/superpowers/specs/2026-06-03-jdc-context-engine-v2-design.md`
2. `docs/superpowers/specs/2026-06-01-jdc-context-engine-engineering-contract.md`
3. `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-master-roadmap.md`
4. The matching phase plan.

Do not trust that the compacted summary preserved all constraints.

## Step 3: Recover Current Task

Use these sources, in order:

1. User's latest message.
2. Active task list if task tools exist.
3. Recent commits.
4. Uncommitted diff.
5. `.jdcagnet/plans/*.md` if the user asked to continue a plan.
6. `docs/superpowers/plans/*` if the work is part of a durable roadmap.
7. JDC Context Engine memory search for project facts, when available.

If the latest user message contradicts older plan state, the latest user message wins.

## Step 4: Re-open Files Before Editing

Before modifying a file after compaction:

- Read the file again.
- Check whether it changed since the previous step.
- Search for nearby tests.
- Search for related code paths.

Never patch a file based only on a compacted summary.

## Step 5: Rebuild The Verification Target

Identify the smallest command that proves the next claim.

Examples:

- Prompt/base prompt changes:
  ```bash
  pnpm --filter @jdcagnet/core exec vitest run src/base-prompt.test.ts src/providers/provider-prompt-contract.test.ts --no-file-parallelism
  pnpm --filter @jdcagnet/core build
  ```

- JDC Context Engine retrieval/harvest/store:
  ```bash
  pnpm --filter @jdcagnet/core exec vitest run src/context/context-retriever.test.ts src/context/context-harvest.test.ts src/context/store.test.ts src/session-context.test.ts --no-file-parallelism
  pnpm --filter @jdcagnet/core build
  ```

- Context UI:
  ```bash
  pnpm --filter @jdcagnet/ui exec vitest run src/components/context/context-panels.test.tsx src/stores/context-store.test.tsx src/lib/context-inspector-visibility.test.ts --no-file-parallelism
  pnpm --filter @jdcagnet/ui build
  ```

- Generic docs/prompt-only change:
  ```bash
  pnpm --filter @jdcagnet/core exec vitest run src/base-prompt.test.ts --no-file-parallelism
  git diff --check
  ```

Do not report a previous verification as still valid unless you just re-ran it or inspected that nothing relevant changed.

## Step 6: Continue Or Ask One Question

Continue automatically when:

- The latest user instruction is clear.
- Git state and docs identify the next task.
- No unrelated user changes block the work.

Ask one focused question when:

- Two plausible tasks could both be "next".
- The user changed direction.
- Continuing would risk touching unrelated user work.
- The active plan is stale and the latest message does not clearly reference it.

Do not ask the user to restate the whole project.

## Handoff Summary Format

When creating a handoff or compact-safe summary, include:

```text
Objective:
Current branch / commit:
Changed files:
Completed:
Verification run:
Remaining:
Relevant docs to read next:
Known pitfalls:
```

Keep it factual. Do not include hidden reasoning or guesses.

## Recovery Pitfalls

Avoid:

- Continuing an old `.jdcagnet/plans` file because it exists but the user asked a new unrelated question.
- Assuming a team finished without reading its final event or artifact.
- Claiming a push happened without checking `git status` or remote log.
- Reusing stale test results after code changed.
- Relying on a memory fact without citations when files disagree.
- Reintroducing Context Engine token caps because a compacted summary omitted the no-cap contract.

## Product-Level Contract

This recovery protocol is backed by the built-in JDC CODE Operating Contract in `packages/core/src/base-prompt.ts`. Installed users should receive the core behavior even if their project has no `JDCAGNET.md`.

This file gives repository workers a longer, explicit version to read when working on JDCAGNET itself.
