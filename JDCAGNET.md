# JDCAGNET Repository Operating Contract

This file is loaded automatically when an agent works inside the JDCAGNET source repository. It is a repository-level bootstrap, not the only product-level prompt. Product-level rules that must apply to every installed user also live in `packages/core/src/base-prompt.ts`.

## Read This First

When working in this repository, treat the following files as the durable navigation layer:

- `docs/jdc-code/OPERATING_CONTRACT.md` — full JDC CODE working contract for agents and maintainers.
- `docs/jdc-code/DOC_ROUTER.md` — which docs to read for each kind of task.
- `docs/jdc-code/COMPACTION_RECOVERY.md` — how to recover after conversation compression or a long pause.
- `docs/superpowers/specs/2026-06-03-jdc-context-engine-v2-design.md` — JDC Context Engine V2 product design.
- `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-master-roadmap.md` — phase map and dependencies for JDC Context Engine V2.
- `docs/superpowers/specs/2026-06-01-jdc-context-engine-engineering-contract.md` — strict Context Engine engineering contract.

Before changing any JDC Context Engine behavior, read the relevant V2 design, roadmap, phase plan, and engineering contract. Do not infer these rules from memory.

## Installed-User Boundary

This root `JDCAGNET.md` applies when the active project is this source repository. It does not automatically apply to a user who installed JDC CODE and opened a different project.

For installed users:

- Product-level constraints belong in `packages/core/src/base-prompt.ts` or a prompt module imported by it.
- User project instructions are loaded from that user's project root, such as `JDCAGNET.md`, `AGENTS.md`, or `CLAUDE.md`.
- `/init` can generate a project-level `JDCAGNET.md`, but project files are optional and must not be required for core JDC CODE safety.

Do not rely on this repository file for behavior that every installed user must get.

## JDC CODE Operating Standard

- Read before editing. For behavior claims, inspect the code path or tests first.
- Use `rg`/project-aware search for discovery; use JDC code-intelligence tools when available.
- For architecture, feature, bug-context, or "how does X work" tasks, use `JdcContext` before relying only on raw grep.
- For project conventions, workflow rules, architecture decisions, known issues, release process, or user preferences, use `JdcMemorySearch` when available.
- Keep edits scoped and follow existing module boundaries.
- Verify with focused tests first, then builds when needed.
- Never claim success without fresh verification evidence.
- When committing, stage specific files and use the repository's existing commit style.

## JDC Context Engine Hard Contract

All future `JDC Context Engine` implementation must avoid local artificial capacity limits.

- Do not rename `JDC Context Engine`.
- Do not move project context persistence out of `<project>/.jdcagnet/context-engine/`.
- Do not add default token caps for Engine bundles, sections, code context, project docs, accepted memory, or same-project fact loading.
- Do not reintroduce legacy defaults such as `2500`, `700`, `900`, or provider-side memory caps such as `50`.
- Do not summarize, truncate, or drop Engine context because of local token budgeting.
- Selection belongs to relevance, freshness, citations, confidence, actor profile, and protocol safety, not a hidden product-wide size ceiling.
- If a provider/model rejects an oversized request, handle it in a protocol-safe adapter fallback with diagnostics. Do not hide a small cap in the Engine.
- Foreground chat must not block on harvest, full indexing, code reindex, or heavy background refresh.
- Context panel reads must be cached/read-only and must not start heavy jobs.
- Accepted project facts are project-level by default and shared across sessions in the same project. Do not make them session-isolated.
- Different project roots must never share facts, bundle snapshots, raw evidence, Team artifacts, or retrieval results.

Keep comments and tests near Engine code so future maintainers do not accidentally weaken these constraints.

## Documentation Routing Shortcuts

Use `docs/jdc-code/DOC_ROUTER.md` for the full table. Common routes:

- Context Engine architecture or behavior: read V2 design, engineering contract, master roadmap, and the relevant phase plan.
- Prompt/provider behavior: read `packages/core/src/base-prompt.ts`, provider adapters, and provider prompt contract tests.
- Compression/session behavior: read `docs/jdc-code/COMPACTION_RECOVERY.md`, `packages/core/src/session.ts`, and `packages/core/src/compact.ts`.
- Team/PM/worker behavior: read Team Mode design, Team Workspace design, Team ledger plan, `team-manager-ai.ts`, and Team tests.
- UI/Inspector behavior: read Phase 6 UI diagnostics plan, UI context components, and context panel tests.
- Codegraph/JDC tools: read codegraph integration docs and `packages/core/src/tools/context-engine-tools.ts`.

If a task touches multiple subsystems, read each subsystem's contract before editing shared interfaces.

## Compaction Recovery

After conversation compression, do not rely only on the summary. Recover by:

1. Checking `git status --short --branch`.
2. Checking recent commits with `git log --oneline -8`.
3. Reading this `JDCAGNET.md`.
4. Reading `docs/jdc-code/COMPACTION_RECOVERY.md`.
5. Re-opening any files you are about to edit.
6. Re-running or inspecting the last relevant verification command before claiming prior results still hold.

When the user says "继续", "next", "下一步", or asks where work stands, use this recovery protocol before proceeding.

## No Hidden Size Limits

The user explicitly wants JDC Context Engine and JDC CODE operating docs to be complete. Do not shrink these contracts merely to save prompt tokens. If content must be selected, select by relevance and protocol safety, not by an arbitrary local cap.
