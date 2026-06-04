# JDC Context Smart Harvest Phases 2-6 Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement each phase task-by-task. Steps use checkbox (`- [ ]`) syntax for phase tracking.

**Goal:** Keep the full intelligent-memory direction visible while shipping it in independently verified phases.

**Architecture:** Phase 2-6 are one product arc, not one giant code change. Each phase must leave the engine usable, tested, and mergeable before the next phase starts.

**Tech Stack:** TypeScript, Vitest, sql.js context store, JDC Context Engine harvest/store/retrieval modules.

---

## Phase 2: Memory Lifecycle Resolver

- [x] Add lifecycle fields for durable facts: `status`, `canonicalKey`, `supersedes`, `conflictsWith`, `archivedAt`, and `lifecycleReason`.
- [x] Add schema migration and legacy defaults.
- [x] Keep normal retrieval away from `superseded`, `conflicted`, and `archived` facts unless explicitly requested.
- [x] Merge duplicate facts with the same canonical identity.
- [x] Supersede older facts when a newer fact explicitly shares the same canonical key but carries updated content.
- [x] Preserve existing cleanup for raw evidence, bundle snapshots, rejected candidates, and explicit maintenance quotas.

## Phase 3: Turn Intelligence Classifier

- [x] Introduce a background classifier that emits a multi-action harvest plan.
- [x] Keep `harvest-router.ts` as a cheap gate and fallback dispatcher.
- [ ] Allow one turn to request multiple distillers when evidence contains project knowledge, workflow rules, runtime state, and team state together.
- [x] Persist classifier diagnostics without blocking foreground chat.

## Phase 4: Multi-Fact Distillation

- [ ] Allow distillers to return a batch of cited fact envelopes.
- [ ] Validate and accept facts independently so one bad fact does not reject the whole batch.
- [ ] Preserve evidence citations for each accepted fact.
- [ ] Add model-output compatibility for existing single-envelope distillers.

## Phase 5: Lifecycle-Aware Retrieval

- [ ] Use lifecycle status, canonical identity, freshness, actor profile, citations, and task scope when selecting facts.
- [ ] Keep accepted project memory unbounded at rest.
- [ ] Retrieve only relevant facts for prompt injection.
- [ ] Add explicit inspection paths for stale, superseded, conflicted, and archived facts.

## Phase 6: Maintenance And Self-Repair

- [ ] Repair stuck harvest jobs after interruption.
- [ ] Re-run lifecycle checks for old facts when new evidence arrives.
- [ ] Surface compact diagnostics for conflicts, repairs, and skipped maintenance.
- [ ] Keep all maintenance in background lanes.

## Execution Policy

- Implement one phase at a time.
- Each phase gets tests, build verification, commit, and local merge before the next phase begins.
- Do not introduce hidden token caps, fact-count caps, memory-count caps, section caps, or same-project accepted-memory loading caps.
- Do not hard-delete accepted durable facts in normal operation.
