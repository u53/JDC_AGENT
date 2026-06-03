# Spec 9: System Prompt Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor system prompt into cacheable segments, add system reminders in tool results, inject MCP server instructions, and support language/custom instructions configuration.

**Architecture:** `assembleSystemPrompt()` returns `PromptSegment[]` instead of string. Anthropic provider maps segments to cache_control content blocks. OpenAI providers join segments into a string. Session injects `<system-reminder>` tags in tool_result content.

**Tech Stack:** TypeScript, Vitest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/core/src/types.ts` (MODIFY) | Add PromptSegment type |
| `packages/core/src/context.ts` (REFACTOR) | Return PromptSegment[] |
| `packages/core/src/providers/anthropic.ts` (MODIFY) | Handle segments with cache_control |
| `packages/core/src/providers/openai-chat.ts` (MODIFY) | Join segments to string |
| `packages/core/src/providers/openai-responses.ts` (MODIFY) | Join segments to string |
| `packages/core/src/session.ts` (MODIFY) | System reminder injection + pass config |
| `packages/core/src/mcp/types.ts` (MODIFY) | Add instructions field |
| `packages/core/src/mcp/manager.ts` (MODIFY) | Save instructions from initialize |
| `packages/core/src/config.ts` (MODIFY) | Expose language/customInstructions |

---

### Task 1: Add PromptSegment type + refactor assembleSystemPrompt

**Files:**
- Modify: `packages/core/src/types.ts`
- Refactor: `packages/core/src/context.ts`

- [ ] **Step 1: Add PromptSegment to types.ts**

Add to `packages/core/src/types.ts`:

```typescript
export interface PromptSegment {
  content: string
  cacheable: boolean
}
```

- [ ] **Step 2: Update ContextOptions and refactor assembleSystemPrompt**

In `packages/core/src/context.ts`:

1. Add `language?: string` and `customInstructions?: string` to `ContextOptions`
2. Change return type of `assembleSystemPrompt` from `Promise<string>` to `Promise<PromptSegment[]>`
3. Instead of pushing strings to `parts[]` and joining with `---`, push `PromptSegment` objects

The refactored function should produce segments like:
- `{ content: basePrompt, cacheable: true }` — identity/system/tools/coding/safety
- `{ content: skillsSection, cacheable: true }` — if skills exist
- `{ content: memorySection, cacheable: true }` — memory prompt
- `{ content: globalMd + projectMd + rules, cacheable: true }` — instructions
- `{ content: userPreferences, cacheable: true }` — language + custom instructions (if configured)
- `{ content: gitStatus + date, cacheable: false }` — dynamic content

- [ ] **Step 3: Add helper to join segments (for backward compat)**

Add a utility function:

```typescript
export function joinSegments(segments: PromptSegment[]): string {
  return segments.map(s => s.content).join('\n\n---\n\n')
}
```

- [ ] **Step 4: Update session.ts to handle new return type**

In `session.ts`, where `assembleSystemPrompt` is called (around line 234):

```typescript
// BEFORE:
this.config.modelConfig.systemPrompt = await assembleSystemPrompt({...})

// AFTER:
const appConfig = loadAppConfig()
this.config.modelConfig.systemPrompt = await assembleSystemPrompt({
  cwd: this.config.cwd,
  toolDefs,
  toolNames,
  mcpServers,
  skills: this.skillLoader.getAll().map(s => ({ name: s.name, description: s.description })),
  language: appConfig.language,
  customInstructions: appConfig.customInstructions,
})
```

Note: `systemPrompt` in ModelConfig changes from `string` to `PromptSegment[]`. Update the type in types.ts:

```typescript
systemPrompt?: string | PromptSegment[]
```

- [ ] **Step 5: Run tests and build**

Run: `cd packages/core && npx vitest run`
Run: `cd packages/electron && node build.mjs`

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/context.ts packages/core/src/session.ts
git commit -m "feat(core): refactor assembleSystemPrompt to return PromptSegment[]"
```

---

### Task 2: Anthropic provider cache_control support

**Files:**
- Modify: `packages/core/src/providers/anthropic.ts`

- [ ] **Step 1: Update system parameter handling**

In `anthropic.ts`, both `chat()` and `stream()` methods currently pass `system: config.systemPrompt` (a string). Update to handle `PromptSegment[]`:

```typescript
private formatSystem(systemPrompt?: string | PromptSegment[]): any {
  if (!systemPrompt) return undefined
  if (typeof systemPrompt === 'string') return systemPrompt
  // PromptSegment[] → Anthropic content blocks with cache_control
  return systemPrompt.map(seg => ({
    type: 'text' as const,
    text: seg.content,
    ...(seg.cacheable ? { cache_control: { type: 'ephemeral' as const } } : {}),
  }))
}
```

Replace `system: config.systemPrompt` with `system: this.formatSystem(config.systemPrompt)` in both `chat()` and `stream()`.

- [ ] **Step 2: Build and verify**

Run: `cd packages/electron && node build.mjs`

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/providers/anthropic.ts
git commit -m "feat(core): add cache_control support to Anthropic provider"
```

---

### Task 3: OpenAI providers — join segments

**Files:**
- Modify: `packages/core/src/providers/openai-chat.ts`
- Modify: `packages/core/src/providers/openai-responses.ts`

- [ ] **Step 1: Add helper to resolve systemPrompt to string**

In both OpenAI provider files, add a helper (or import from context.ts):

```typescript
function resolveSystemPrompt(systemPrompt?: string | PromptSegment[]): string | undefined {
  if (!systemPrompt) return undefined
  if (typeof systemPrompt === 'string') return systemPrompt
  return systemPrompt.map(s => s.content).join('\n\n---\n\n')
}
```

Use it where `config.systemPrompt` is passed to the API.

- [ ] **Step 2: Build and verify**

Run: `cd packages/electron && node build.mjs`

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/providers/openai-chat.ts packages/core/src/providers/openai-responses.ts
git commit -m "feat(core): handle PromptSegment[] in OpenAI providers"
```

---

### Task 4: System Reminders injection

**Files:**
- Modify: `packages/core/src/session.ts`

- [ ] **Step 1: Add reminder generation method to Session**

Add a private method to Session class:

```typescript
private getSystemReminder(): string | null {
  const appConfig = loadAppConfig()
  const parts: string[] = []
  const date = new Date().toISOString().split('T')[0]
  parts.push(`当前日期: ${date}`)
  if (appConfig.language) {
    const labels: Record<string, string> = { 'zh-CN': '中文', 'en': 'English', 'ja': '日本語', 'ko': '한국어' }
    parts.push(`语言: ${labels[appConfig.language] || appConfig.language}`)
  }
  if (appConfig.customInstructions) {
    parts.push(appConfig.customInstructions)
  }
  if (parts.length <= 1) return null  // only date, no user config — skip
  return `\n\n<system-reminder>\n${parts.join('\n')}\n</system-reminder>`
}
```

- [ ] **Step 2: Inject reminder into tool_result content**

In the `runLoop` method, after `parallelExecutor.executeBatch()` returns `batchResults`, before assembling `toolResults`:

```typescript
const reminder = this.getSystemReminder()
const toolResults = batchResults.map(r => ({
  type: 'tool_result',
  tool_use_id: r.tool_use_id,
  content: r.content + (reminder || ''),
  is_error: r.is_error,
}))
```

- [ ] **Step 3: Build and verify**

Run: `cd packages/electron && node build.mjs`

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/session.ts
git commit -m "feat(core): inject system reminders in tool_result content"
```

---

### Task 5: MCP server instructions

**Files:**
- Modify: `packages/core/src/mcp/types.ts`
- Modify: `packages/core/src/mcp/manager.ts`
- Modify: `packages/core/src/base-prompt.ts`

- [ ] **Step 1: Add instructions field to McpServerState**

In `packages/core/src/mcp/types.ts`:

```typescript
export interface McpServerState {
  name: string
  config: McpServerConfig
  status: McpConnectionStatus
  error?: string
  tools: McpToolInfo[]
  instructions?: string  // from server's initialize response
}
```

- [ ] **Step 2: Save instructions from initialize response in manager**

In `packages/core/src/mcp/manager.ts`, find where the server is initialized and the state is set. After getting the initialize response, extract `instructions` if present:

```typescript
// After client.initialize() or equivalent
const serverInstructions = initResult?.instructions || undefined
// Save to state
state.instructions = serverInstructions
```

(The exact location depends on how the MCP client is initialized — read the file to find it.)

- [ ] **Step 3: Pass instructions through to system prompt**

In `session.ts` where mcpServers are assembled for the prompt (around line 230-232):

```typescript
// BEFORE:
const mcpServers = this.mcpManager?.getServerStates()
  .filter(s => s.status === 'connected')
  .map(s => ({ name: s.name, toolCount: s.tools.length, tools: s.tools.map(t => t.name) }))

// AFTER:
const mcpServers = this.mcpManager?.getServerStates()
  .filter(s => s.status === 'connected')
  .map(s => ({ name: s.name, toolCount: s.tools.length, tools: s.tools.map(t => t.name), instructions: s.instructions }))
```

- [ ] **Step 4: Update getMcpSection in base-prompt.ts**

In `packages/core/src/base-prompt.ts`, find `getMcpSection` and add instructions output:

```typescript
// For each server, if instructions exist:
if (server.instructions) {
  serverSection += `\nInstructions: ${server.instructions}`
}
```

- [ ] **Step 5: Build and verify**

Run: `cd packages/electron && node build.mjs`

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/mcp/types.ts packages/core/src/mcp/manager.ts packages/core/src/session.ts packages/core/src/base-prompt.ts
git commit -m "feat(core): inject MCP server instructions into system prompt"
```

---

### Task 6: End-to-End Verification

- [ ] **Step 1: Build and launch**

```bash
cd packages/electron && node build.mjs
cd packages/electron && NODE_ENV=development npx electron dist/main.js
```

- [ ] **Step 2: Test basic functionality**

Send a message and verify the app works normally (no regressions from prompt refactoring).

- [ ] **Step 3: Test system reminders**

Set language in config:
```bash
cd /Users/chenmingxu/Documents/jdcagnet
node -e "const c=require('./packages/core/src/config.js'); c.saveAppConfig({language:'zh-CN',customInstructions:'回复简洁'})"
```

Send a message that triggers tool use. Check that the model receives system reminders (visible in model's behavior — should respond in Chinese concisely).

- [ ] **Step 4: Commit if fixes needed**

```bash
git add -A && git commit -m "fix(core): address issues found in system prompt manual testing"
```
