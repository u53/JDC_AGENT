export const PROJECT_INIT_PROMPT = `Read the project structure in the current working directory and create or update a project-level JDCAGNET.md file in the project root.

This file is project-level, not product-level. It guides JDC CODE when working inside this specific repository. Product-level rules are already built into JDC CODE and must not be copied as if they belong only to this project.

If JDCAGNET.md already exists, read it first and preserve user-written constraints unless they are clearly obsolete or contradicted by current project files. Update it carefully instead of overwriting.

Analyze the project by reading relevant files before writing:

- README / docs
- package manager files and scripts
- build/test/lint config
- source tree structure
- CI/release workflows
- existing AGENTS.md / CLAUDE.md / .cursorrules if present
- docs/specs/plans/contracts/roadmaps if present

Write a complete, practical JDCAGNET.md with these sections:

# Project Operating Contract

## Project Overview
What this project is, primary languages/frameworks, key runtime targets, and important packages.

## Commands
Install, dev, build, test, lint, package, release, and any platform-specific commands. Put commands in code blocks and prefer commands that actually exist in project files.

## Architecture
Key directories, major modules, data flow, boundaries, and where to start for common feature or bug work.

## Doc Routing
Tell future agents what docs to read for common task types. Include exact paths when docs exist. If docs/specs/plans/contracts/roadmaps exist, route to them.

## Code Intelligence
When JDC tools are available, use JdcContext first for architecture, feature, bug-context, and "how does X work" questions. Use JdcMemorySearch before relying on durable project conventions, workflow rules, known issues, release steps, or preferences.

## Development Rules
Project-specific style, testing, dependency, security, data, platform, and compatibility constraints.

## Verification
Which tests/builds prove common changes. State the smallest useful focused commands first, then broader commands.

## Git And Release
Branch, commit, versioning, tagging, packaging, and push expectations if the project defines them.

## Compaction Recovery
Explain how to recover after context compression or a long pause:

- Check git status and recent commits.
- Re-read this JDCAGNET.md and routed docs.
- Re-open files before editing.
- Re-run or inspect relevant verification before claiming previous results still hold.
- Do not resurrect completed, cancelled, or superseded tasks.
- Treat the latest user instruction as stronger than stale plans or summaries.

## Persistent Memory
What is worth remembering for this project. Require citations and stable value. Do not store secrets, guesses, raw reasoning, greetings, or transient one-turn state.

Hard requirements:

- Be specific to this project. Do not write generic filler.
- Do not invent commands, architecture, docs, or workflows. If something is unknown, say how to discover it.
- Do not add arbitrary token limits or context-size rules.
- Keep the document complete enough for a future compressed session to recover the project.
- Write the file using the Write tool to the project root as JDCAGNET.md.`
