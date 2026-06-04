# JDC CODE Operating Contract

This document defines how JDC CODE agents should work inside the JDCAGNET repository and how product-level prompt constraints should behave for installed users.

It is intentionally explicit. The point is to survive context compression, session switching, sub-agent delegation, and long-running implementation work without making the user restate the project.

## Authority

The effective instruction order is:

1. System/developer instructions from the runtime.
2. The user's current request and explicit constraints.
3. Product-level JDC CODE prompt contract in `packages/core/src/base-prompt.ts`.
4. Repository root `JDCAGNET.md`.
5. Project rules and docs routed by `docs/jdc-code/DOC_ROUTER.md`.
6. JDC Context Engine injected facts and cited durable memories.
7. Prior conversation summaries, only after verification.

If lower-level docs conflict with the user's latest explicit instruction, follow the user unless it would break safety or repository integrity. If product-level prompt code conflicts with docs, update docs and tests together.

## Installed-User Boundary

There are three different instruction surfaces:

- Product-level prompt: shipped with JDC CODE through `packages/core/src/base-prompt.ts`; applies to every installed user.
- User project instructions: `JDCAGNET.md`, `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, and rules folders in the user's active project.
- JDCAGNET repository instructions: this repository's root `JDCAGNET.md` and `docs/jdc-code/*`.

Never assume this repository's root `JDCAGNET.md` applies to an installed user working in another project. Product-wide behavior belongs in code, not only in repository docs.

## Startup Protocol

For any non-trivial task:

1. Identify the active `cwd`.
2. Check whether the task is about JDCAGNET itself or a user's project.
3. Read root/project instructions if present.
4. Use `docs/jdc-code/DOC_ROUTER.md` to select relevant design/spec/plan files.
5. Check `git status --short --branch` before editing.
6. Read the exact files you will modify.
7. Use JDC Context Engine tools when available for project-level code understanding and durable memory.
8. Make scoped changes.
9. Verify with focused tests/builds.
10. Report exactly what changed and what was verified.

Do not skip doc routing because the task looks familiar. Familiarity is often stale memory.

## Request Classification

Classify the user's request before acting:

- **Question/explanation**: inspect relevant files and answer with references; do not edit.
- **Bugfix**: reproduce or identify the failing behavior first; add/update tests when practical.
- **Feature/change**: read existing patterns; prefer TDD for behavior changes.
- **Review**: lead with findings ordered by severity and exact file/line references.
- **Plan/spec**: write a durable plan/spec file only when the user wants planning or the task is broad.
- **Continuation**: run compaction recovery before assuming the previous next step.
- **Commit/push**: inspect status, stage specific files, verify, commit, then push only when explicitly requested.

If the request spans multiple independent subsystems, split the work or ask for priority instead of mixing interfaces casually.

## Tooling Contract

Use tools according to the job:

- `JdcContext`: first-choice project code-intelligence tool for architecture, features, bug context, and "how does X work".
- `JdcSearch`: symbol lookup by name.
- `JdcNode`: symbol details and source.
- `JdcCallers` / `JdcCallees` / `JdcImpact` / `JdcTrace`: dependency and impact analysis.
- `JdcMemorySearch`: accepted durable project facts: conventions, workflow rules, architecture decisions, known issues, release process, and preferences.
- `JdcMemoryWrite`: only for explicit durable memory requests with citations.
- File reads/search: verify exact code and docs before editing.
- Tests/builds: prove claims before reporting completion.

If a JDC tool reports that the code index is still building, do not block indefinitely. Use targeted file search/read as a fallback and mention what was not available if it matters.

## Documentation Routing

All non-trivial work needs document routing:

- Check `docs/jdc-code/DOC_ROUTER.md`.
- Read relevant docs before changing behavior.
- If docs and code disagree, treat that as a finding. Update both when the task is to implement or repair the contract.
- Do not create parallel docs with conflicting names. Extend existing design/plan/contract files when possible.

Documentation is not decorative. It is part of the runtime contract for future agents.

## JDC Context Engine Contract

JDC Context Engine is project-level context infrastructure. Keep these rules:

- The name remains `JDC Context Engine`.
- Persistence stays under `<project>/.jdcagnet/context-engine/`.
- Accepted durable facts are shared across sessions in the same project.
- Different project roots never share facts or evidence.
- No raw hidden reasoning is stored.
- No failed/no-op/rejected harvest output appears as primary user memory.
- Memory injection is retrieval-first; never dump all memory.
- Context capacity is not locally capped by arbitrary product numbers.
- Foreground chat cannot block on heavy harvest, indexing, or refresh.
- Context failures degrade silently with diagnostics.

When in doubt, read:

- `docs/superpowers/specs/2026-06-03-jdc-context-engine-v2-design.md`
- `docs/superpowers/specs/2026-06-01-jdc-context-engine-engineering-contract.md`
- `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-master-roadmap.md`

## Prompt And Provider Contract

Prompt behavior is product behavior.

- JDCAGNET/JDC CODE identity comes first.
- Provider adapters must preserve official request shapes.
- Anthropic system blocks, cache-control placement, content arrays, tool results, and dynamic context must remain protocol-safe.
- OpenAI Chat and OpenAI Responses must receive equivalent JDC Context Engine semantics.
- Do not add compatibility text that creates identity conflict with JDCAGNET.
- Do not change adaptive thinking behavior unless the user explicitly asks for that work.

When changing prompts, update prompt contract tests.

## Compaction Contract

After context compaction:

- Do not trust the summary alone.
- Re-read current docs and files.
- Check git status and recent commits.
- Use task state when available.
- Recover active plans through `.jdcagnet/plans` and routed docs.
- Continue without asking the user to restart.
- Ask one focused question only if the recovered evidence is genuinely ambiguous.

See `docs/jdc-code/COMPACTION_RECOVERY.md` for the exact playbook.

## Team / PM / Worker Contract

Team and sub-agent work must be project-aware:

- Main session, PM, workers, and sub-agents should share project-level context through JDC Context Engine.
- Team artifacts and task results that have durable value should become citation-backed project context.
- PM and workers must inherit project instructions and relevant actor-specific context.
- Do not run a shadow copy of delegated Team work while the Team owns it.
- When Team completes, verify artifacts before telling the user what exists.

Read Team docs before changing Team behavior:

- `docs/superpowers/specs/2026-05-20-team-mode-design.md`
- `docs/superpowers/specs/2026-05-22-team-workspace-design.md`
- `docs/superpowers/plans/2026-06-03-jdc-context-engine-v2-phase4-team-ledger-plan.md`

## UI Contract

JDC CODE UI should feel like a working tool, not a debug dashboard for normal users.

- User-facing context UI is Chinese-first.
- Production builds should not expose advanced Context Engine inspector surfaces by default.
- Context data shown in UI should be accepted/final useful state, not noisy failed/no-op internals.
- Diagnostics belong behind development or explicit inspector gates.
- Tool cards should communicate activity and result clearly without overwhelming the model context.

For Context Engine UI, read Phase 6 docs and UI tests before editing.

## Performance Contract

Performance is a product requirement:

- Normal chat should not spike CPU because of foreground indexing, harvest, or full-store writes.
- Background work must be scheduled, cancellable, and project-budgeted.
- Panel reads should be cached/read-only.
- Store writes should avoid write amplification.
- Performance metrics should explain retrieval, packing, harvest, and background work.

Read Phase 7 docs before changing scheduling or performance instrumentation.

## Memory Contract

Durable memory must be useful, cited, stable, and project-scoped.

Store:

- Explicit user preferences.
- Project conventions.
- Architecture decisions.
- Workflow/release rules.
- Known issues.
- Team decisions and artifact summaries with evidence.

Do not store:

- Greetings.
- Acknowledgements.
- One-turn temporary state.
- Uncited model guesses.
- Secrets.
- Raw thinking/reasoning.
- Failed, cancelled, timeout, no-op, or rejected harvest output as accepted facts.

## Verification Contract

Before reporting completion:

- Run focused tests for touched behavior.
- Run builds when TypeScript or UI code changed.
- Run `git diff --check`.
- Read the output and report failures honestly.

Never claim "done", "fixed", "complete", or "passes" without fresh evidence.

## Git Contract

- Check status before editing and before committing.
- Stage specific files.
- Do not revert user changes.
- Do not use destructive commands unless explicitly requested.
- Commit only when the user asks or the plan requires it.
- Push only when explicitly requested.
- Use local proxy instructions when the user specifies them.

## Maintaining This Contract

When changing JDC CODE operating behavior:

1. Update `packages/core/src/base-prompt.ts` if installed users must receive the rule.
2. Update tests that assert prompt contract behavior.
3. Update root `JDCAGNET.md` if repository agents need the rule.
4. Update this document if the rule is durable.
5. Update `DOC_ROUTER.md` if the rule changes what agents must read.

Docs without tests can drift. Prompt changes without docs become invisible to future maintainers. Keep both.
