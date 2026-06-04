# JDC CODE Operating Contract Design

## Status

Implemented as a prompt/docs hardening pass for JDC CODE.

## Problem

JDCAGNET had useful project instructions and JDC Context Engine facts, but the model did not have a durable, product-level operating contract equivalent to the Superpower workflow discipline.

The main gap was installation scope:

- A repository root `JDCAGNET.md` is loaded only when the active project is this repository.
- Installed users opening their own projects do not inherit this repository's root file.
- `/init` can generate a project-level `JDCAGNET.md`, but it is user-triggered and optional.

Therefore, product-level rules such as compaction recovery, doc routing, JDC tool priority, and Context Engine no-cap constraints cannot live only in root docs. They must be built into the shipped prompt.

## Goals

- Give every installed user a built-in JDC CODE Operating Contract.
- Keep the repository root `JDCAGNET.md` useful for agents working on JDCAGNET itself.
- Add durable docs that tell future agents what to read after compaction.
- Preserve the no-artificial-token-cap JDC Context Engine rule.
- Make doc routing explicit for Context Engine, prompt/provider, UI, Team, codegraph, MCP, background tasks, and release work.
- Add tests so prompt-level rules cannot silently disappear.

## Non-Goals

- Do not auto-create `JDCAGNET.md` in user projects.
- Do not force user projects to accept JDCAGNET-specific repository docs.
- Do not add a new Context Engine token cap.
- Do not change provider protocol behavior beyond prompt content.
- Do not alter adaptive thinking behavior.

## Architecture

The contract has three layers.

### Layer 1: Product Built-In Prompt

File:

- `packages/core/src/base-prompt.ts`

Purpose:

- Applies to every installed user.
- Does not rely on a project `JDCAGNET.md`.
- Defines JDC CODE Operating Contract, context hierarchy, doc routing, compaction recovery, JDC tool priority, memory rules, and JDC Context Engine hard constraints.

Test:

- `packages/core/src/base-prompt.test.ts`

### Layer 2: Repository Bootstrap

File:

- `JDCAGNET.md`

Purpose:

- Applies when agents work inside the JDCAGNET source repository.
- Points agents to `docs/jdc-code/*` and Context Engine specs/plans.
- Clarifies installed-user boundary.

### Layer 3: Durable Repository Docs

Files:

- `docs/jdc-code/OPERATING_CONTRACT.md`
- `docs/jdc-code/DOC_ROUTER.md`
- `docs/jdc-code/COMPACTION_RECOVERY.md`

Purpose:

- Make the rules readable and maintainable outside prompt code.
- Provide exact document routes by task type.
- Give agents a recovery playbook after compaction or interruption.

## Key Product Decisions

### Root `JDCAGNET.md` Is Not Product-Global

The root file is valuable for this repository, but installed users working in another project will not read it. Product-global behavior must live in `base-prompt.ts`.

### `/init` Is Optional

The `/init` command can generate a project-level `JDCAGNET.md`, but first-run safety must not depend on `/init`.

### Doc Routing Is Mandatory For Non-Trivial Work

Agents should route tasks to specs/plans/contracts before editing. This prevents the model from losing design constraints after compression.

### Compaction Recovery Reads Durable State

After compaction, the agent must recover from git state, task state, docs, files, and JDC Context Engine facts rather than trusting the compressed summary alone.

### No Artificial Context Caps

JDC Context Engine must not add local arbitrary caps such as 2500, 700, 900, 8k, 32k, or memory result caps that silently weaken context. Selection remains relevance-first and provider fallback remains protocol-safe.

## Acceptance Criteria

- `getBasePrompt()` contains `# JDC CODE Operating Contract` even when no project `JDCAGNET.md` exists.
- The base prompt explicitly says not to depend on project `JDCAGNET.md` for product-level rules.
- The base prompt names `JdcContext` as first code-understanding tool when available.
- The base prompt names `JdcMemorySearch` as durable project-memory lookup when available.
- Root `JDCAGNET.md` explains installed-user boundary and routes to durable docs.
- `docs/jdc-code/DOC_ROUTER.md` maps major task classes to docs, code entry points, and verification.
- `docs/jdc-code/COMPACTION_RECOVERY.md` gives a concrete recovery playbook.

## Verification

Run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/base-prompt.test.ts --no-file-parallelism
pnpm --filter @jdcagnet/core build
git diff --check
```

For broader prompt/provider changes, also run:

```bash
pnpm --filter @jdcagnet/core exec vitest run src/providers/provider-prompt-contract.test.ts src/session-context.test.ts --no-file-parallelism
```

## Maintenance Rule

When changing JDC CODE operating behavior:

1. Update product prompt code if installed users must receive the behavior.
2. Update tests.
3. Update root `JDCAGNET.md` if repository agents need the behavior.
4. Update `docs/jdc-code/*` when doc routing or recovery changes.
5. Verify.
