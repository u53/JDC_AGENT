# JDCAGNET Phase 2C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** 添加 Hooks、Skills、Subagent 三个高级功能

**Architecture:** Hooks 集成到 ToolRunner，Skills 加载 md 文件注入对话，Subagent 派发独立子 session

**Tech Stack:** TypeScript, Zod, gray-matter, child_process

---

### Task 1: Hooks — 类型定义和配置加载

**Files:**
- Create: `packages/core/src/hooks/types.ts`
- Create: `packages/core/src/hooks/loader.ts`
- Create: `packages/core/src/hooks/index.ts`
- Test: `packages/core/src/hooks/__tests__/loader.test.ts`

- [ ] **Step 1: Install gray-matter**

```bash
cd packages/core && pnpm add gray-matter && pnpm add -D @types/gray-matter
```

- [ ] **Step 2: Write hook types**

```typescript
// packages/core/src/hooks/types.ts
import { z } from 'zod'

export const CommandHookSchema = z.object({
  type: z.literal('command'),
  command: z.string(),
  timeout: z.number().default(10000),
})

export type CommandHook = z.infer<typeof CommandHookSchema>

export const HookRuleSchema = z.object({
  matcher: z.string().optional(),
  hooks: z.array(CommandHookSchema),
})

export type HookRule = z.infer<typeof HookRuleSchema>

export const HookConfigSchema = z.object({
  hooks: z.object({
    PreToolUse: z.array(HookRuleSchema).optional(),
    PostToolUse: z.array(HookRuleSchema).optional(),
    SessionStart: z.array(HookRuleSchema).optional(),
    SessionEnd: z.array(HookRuleSchema).optional(),
  }),
})

export type HookConfig = z.infer<typeof HookConfigSchema>

export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'SessionEnd'

export interface HookInput {
  hook_event: HookEvent
  session_id: string
  cwd: string
  tool_name?: string
  tool_input?: unknown
  tool_result?: string
  project_name?: string
  message_count?: number
}

export interface HookOutput {
  decision?: 'allow' | 'block'
  reason?: string
  message?: string
}
```

- [ ] **Step 3: Write loader**

```typescript
// packages/core/src/hooks/loader.ts
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { HookConfigSchema, type HookConfig, type HookRule, type HookEvent } from './types.js'

const GLOBAL_PATH = path.join(os.homedir(), '.jdcagnet', 'hooks.json')

function projectPath(cwd: string): string {
  return path.join(cwd, '.jdcagnet', 'hooks.json')
}

async function loadFile(filePath: string): Promise<HookConfig | null> {
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf-8'))
    return HookConfigSchema.parse(raw)
  } catch { return null }
}

export async function loadHookConfig(cwd: string): Promise<HookConfig> {
  const global = await loadFile(GLOBAL_PATH)
  const project = await loadFile(projectPath(cwd))
  return mergeConfigs(global, project)
}

function mergeConfigs(global: HookConfig | null, project: HookConfig | null): HookConfig {
  if (!global && !project) return { hooks: {} }
  if (!global) return project!
  if (!project) return global

  const events: HookEvent[] = ['PreToolUse', 'PostToolUse', 'SessionStart', 'SessionEnd']
  const merged: HookConfig = { hooks: {} }
  for (const event of events) {
    const g = global.hooks[event] || []
    const p = project.hooks[event] || []
    if (g.length || p.length) {
      merged.hooks[event] = [...g, ...p]
    }
  }
  return merged
}

export function getMatchingHooks(config: HookConfig, event: HookEvent, toolName?: string): HookRule[] {
  const rules = config.hooks[event] || []
  if (!toolName) return rules
  return rules.filter(r => {
    if (!r.matcher) return true
    if (r.matcher === '*') return true
    if (r.matcher.endsWith('*')) return toolName.startsWith(r.matcher.slice(0, -1))
    return r.matcher === toolName
  })
}
```

- [ ] **Step 4: Write loader tests**

```typescript
// packages/core/src/hooks/__tests__/loader.test.ts
import { describe, it, expect } from 'vitest'
import { getMatchingHooks } from '../loader.js'
import type { HookConfig } from '../types.js'

describe('getMatchingHooks', () => {
  const config: HookConfig = {
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo bash', timeout: 10000 }] },
        { matcher: '*', hooks: [{ type: 'command', command: 'echo all', timeout: 10000 }] },
        { matcher: 'mcp__*', hooks: [{ type: 'command', command: 'echo mcp', timeout: 10000 }] },
      ],
    },
  }

  it('matches exact tool name', () => {
    const rules = getMatchingHooks(config, 'PreToolUse', 'Bash')
    expect(rules).toHaveLength(2) // Bash + *
  })

  it('matches wildcard prefix', () => {
    const rules = getMatchingHooks(config, 'PreToolUse', 'mcp__github__search')
    expect(rules).toHaveLength(2) // mcp__* + *
  })

  it('matches only wildcard for unknown tool', () => {
    const rules = getMatchingHooks(config, 'PreToolUse', 'FileRead')
    expect(rules).toHaveLength(1) // * only
  })

  it('returns all rules for events without matcher', () => {
    const cfg: HookConfig = {
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo start', timeout: 10000 }] }] },
    }
    const rules = getMatchingHooks(cfg, 'SessionStart')
    expect(rules).toHaveLength(1)
  })
})
```

- [ ] **Step 5: Run tests**

```bash
cd packages/core && pnpm vitest run src/hooks/__tests__/loader.test.ts
```

- [ ] **Step 6: Create index.ts and commit**

```typescript
// packages/core/src/hooks/index.ts
export * from './types.js'
export * from './loader.js'
export * from './engine.js'
```

```bash
git add packages/core/src/hooks/ && git commit -m "feat(hooks): add hook types, config loader, and matcher logic"
```

---

### Task 2: Hooks — 执行引擎

**Files:**
- Create: `packages/core/src/hooks/engine.ts`
- Test: `packages/core/src/hooks/__tests__/engine.test.ts`

- [ ] **Step 1: Write engine**

```typescript
// packages/core/src/hooks/engine.ts
import { exec } from 'node:child_process'
import type { HookConfig, HookEvent, HookInput, HookOutput, HookRule } from './types.js'
import { getMatchingHooks } from './loader.js'

export class HookEngine {
  private config: HookConfig

  constructor(config: HookConfig) {
    this.config = config
  }

  updateConfig(config: HookConfig): void {
    this.config = config
  }

  async runPreToolUse(input: Omit<HookInput, 'hook_event'>): Promise<HookOutput> {
    return this.run('PreToolUse', input)
  }

  async runPostToolUse(input: Omit<HookInput, 'hook_event'>): Promise<HookOutput> {
    return this.run('PostToolUse', input)
  }

  async runSessionStart(input: Omit<HookInput, 'hook_event'>): Promise<void> {
    await this.run('SessionStart', input)
  }

  async runSessionEnd(input: Omit<HookInput, 'hook_event'>): Promise<void> {
    await this.run('SessionEnd', input)
  }

  private async run(event: HookEvent, partialInput: Omit<HookInput, 'hook_event'>): Promise<HookOutput> {
    const input: HookInput = { hook_event: event, ...partialInput }
    const rules = getMatchingHooks(this.config, event, input.tool_name)
    let combined: HookOutput = {}

    for (const rule of rules) {
      for (const hook of rule.hooks) {
        const output = await this.executeCommand(hook.command, input, hook.timeout ?? 10000)
        if (output.decision === 'block') return output
        if (output.message) combined.message = (combined.message || '') + output.message + '\n'
      }
    }
    return combined
  }

  private executeCommand(command: string, input: HookInput, timeout: number): Promise<HookOutput> {
    return new Promise((resolve) => {
      const env = {
        ...process.env,
        TOOL_NAME: input.tool_name || '',
        SESSION_ID: input.session_id,
        CWD: input.cwd,
        HOOK_EVENT: input.hook_event,
      }

      const child = exec(command, { timeout, cwd: input.cwd, env }, (error, stdout) => {
        if (error) {
          resolve({ message: `Hook error: ${error.message}` })
          return
        }
        const trimmed = stdout.trim()
        if (!trimmed) { resolve({}); return }
        try {
          resolve(JSON.parse(trimmed) as HookOutput)
        } catch {
          resolve({ message: trimmed })
        }
      })

      child.stdin?.write(JSON.stringify(input))
      child.stdin?.end()
    })
  }
}
```

- [ ] **Step 2: Write engine tests**

```typescript
// packages/core/src/hooks/__tests__/engine.test.ts
import { describe, it, expect } from 'vitest'
import { HookEngine } from '../engine.js'
import type { HookConfig } from '../types.js'

describe('HookEngine', () => {
  it('runs command and returns output', async () => {
    const config: HookConfig = {
      hooks: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo \'{"decision":"allow"}\'', timeout: 5000 }] }],
      },
    }
    const engine = new HookEngine(config)
    const result = await engine.runPreToolUse({ session_id: 'test', cwd: '/tmp', tool_name: 'Bash', tool_input: {} })
    expect(result.decision).not.toBe('block')
  })

  it('blocks when hook returns block decision', async () => {
    const config: HookConfig = {
      hooks: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo \'{"decision":"block","reason":"not allowed"}\'', timeout: 5000 }] }],
      },
    }
    const engine = new HookEngine(config)
    const result = await engine.runPreToolUse({ session_id: 'test', cwd: '/tmp', tool_name: 'Bash', tool_input: {} })
    expect(result.decision).toBe('block')
    expect(result.reason).toBe('not allowed')
  })

  it('handles timeout gracefully', async () => {
    const config: HookConfig = {
      hooks: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'sleep 10', timeout: 100 }] }],
      },
    }
    const engine = new HookEngine(config)
    const result = await engine.runPreToolUse({ session_id: 'test', cwd: '/tmp', tool_name: 'Bash', tool_input: {} })
    expect(result.message).toContain('Hook error')
  })

  it('passes input via stdin', async () => {
    const config: HookConfig = {
      hooks: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'cat | node -e "const d=require(\'fs\').readFileSync(0,\'utf8\');const j=JSON.parse(d);process.stdout.write(JSON.stringify({message:j.tool_name}))"', timeout: 5000 }] }],
      },
    }
    const engine = new HookEngine(config)
    const result = await engine.runPreToolUse({ session_id: 'test', cwd: '/tmp', tool_name: 'MyTool', tool_input: {} })
    expect(result.message).toBe('MyTool')
  })
})
```

- [ ] **Step 3: Run tests**

```bash
cd packages/core && pnpm vitest run src/hooks/__tests__/engine.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/hooks/ && git commit -m "feat(hooks): add hook execution engine with command support"
```

---

### Task 3: Hooks — 集成到 ToolRunner

**Files:**
- Modify: `packages/core/src/tool-runner.ts`
- Modify: `packages/core/src/session.ts`
- Test: `packages/core/src/hooks/__tests__/integration.test.ts`

- [ ] **Step 1: Modify ToolRunner to accept HookEngine**

```typescript
// packages/core/src/tool-runner.ts — 修改 constructor 和 execute
import { HookEngine } from './hooks/engine.js'

export class ToolRunner {
  private registry: ToolRegistry
  private cwd: string
  private permissionChecker: PermissionChecker
  private onPermissionRequest?: PermissionCallback
  private hookEngine?: HookEngine
  private sessionId: string

  constructor(
    registry: ToolRegistry,
    cwd: string,
    permissionChecker?: PermissionChecker,
    onPermissionRequest?: PermissionCallback,
    hookEngine?: HookEngine,
    sessionId?: string
  ) {
    this.registry = registry
    this.cwd = cwd
    this.permissionChecker = permissionChecker ?? new PermissionChecker()
    this.onPermissionRequest = onPermissionRequest
    this.hookEngine = hookEngine
    this.sessionId = sessionId || ''
  }

  async execute(toolName, toolUseId, input, onEvent, signal): Promise<ToolResult> {
    // ... existing permission check ...

    // PreToolUse hooks
    if (this.hookEngine) {
      const hookResult = await this.hookEngine.runPreToolUse({
        session_id: this.sessionId,
        cwd: this.cwd,
        tool_name: toolName,
        tool_input: input,
      })
      if (hookResult.decision === 'block') {
        const result: ToolResult = { content: `Blocked by hook: ${hookResult.reason || 'no reason'}`, isError: true }
        onEvent({ type: 'error', toolName, toolUseId, result })
        return result
      }
    }

    onEvent({ type: 'start', toolName, toolUseId })
    // ... existing execution ...
    const result = await handler.execute(input, context)

    // PostToolUse hooks
    if (this.hookEngine) {
      await this.hookEngine.runPostToolUse({
        session_id: this.sessionId,
        cwd: this.cwd,
        tool_name: toolName,
        tool_input: input,
        tool_result: result.content,
      })
    }

    onEvent({ type: 'complete', toolName, toolUseId, result })
    return result
  }
}
```

- [ ] **Step 2: Modify Session to load hooks and pass to ToolRunner**

```typescript
// packages/core/src/session.ts — 在 constructor 中加载 hooks
import { loadHookConfig } from './hooks/loader.js'
import { HookEngine } from './hooks/engine.js'

// constructor 末尾:
// 异步初始化 hooks (在 sendMessage 首次调用前完成)
private hookEngine?: HookEngine
private hooksReady: Promise<void>

constructor(...) {
  // ... existing code ...
  this.hooksReady = this.initHooks()
}

private async initHooks(): Promise<void> {
  const config = await loadHookConfig(this.config.cwd)
  this.hookEngine = new HookEngine(config)
  // 重建 toolRunner with hookEngine
  this.toolRunner = new ToolRunner(
    this.toolRegistry, this.config.cwd,
    new PermissionChecker(), this.onPermissionRequest,
    this.hookEngine, this.id
  )
}
```

- [ ] **Step 3: Write integration test**

```typescript
// packages/core/src/hooks/__tests__/integration.test.ts
import { describe, it, expect } from 'vitest'
import { HookEngine } from '../engine.js'
import { ToolRunner } from '../../tool-runner.js'
import { ToolRegistry } from '../../tool-registry.js'

describe('ToolRunner + Hooks integration', () => {
  it('blocks tool execution when hook returns block', async () => {
    const config = {
      hooks: {
        PreToolUse: [{ matcher: 'TestTool', hooks: [{ type: 'command' as const, command: 'echo \'{"decision":"block","reason":"denied"}\'', timeout: 5000 }] }],
      },
    }
    const engine = new HookEngine(config)
    const registry = new ToolRegistry()
    registry.register({
      definition: { name: 'TestTool', description: 'test', inputSchema: { type: 'object', properties: {} } },
      execute: async () => ({ content: 'ok' }),
    })
    const runner = new ToolRunner(registry, '/tmp', undefined, undefined, engine, 'test-session')
    const events: any[] = []
    const result = await runner.execute('TestTool', 'id1', {}, (e) => events.push(e))
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Blocked by hook')
  })
})
```

- [ ] **Step 4: Run tests**

```bash
cd packages/core && pnpm vitest run src/hooks/__tests__/integration.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tool-runner.ts packages/core/src/session.ts packages/core/src/hooks/ && git commit -m "feat(hooks): integrate hook engine into ToolRunner and Session"
```

---

### Task 4: Skills — 类型定义和加载器

**Files:**
- Create: `packages/core/src/skills/types.ts`
- Create: `packages/core/src/skills/loader.ts`
- Create: `packages/core/src/skills/index.ts`
- Test: `packages/core/src/skills/__tests__/loader.test.ts`

- [ ] **Step 1: Write skill types**

```typescript
// packages/core/src/skills/types.ts
export interface SkillDefinition {
  name: string
  description: string
  content: string
  userInvocable: boolean
  arguments: string[]
  argumentHint?: string
  allowedTools?: string[]
  source: 'global' | 'project'
  filePath: string
}
```

- [ ] **Step 2: Write skill loader**

```typescript
// packages/core/src/skills/loader.ts
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import matter from 'gray-matter'
import type { SkillDefinition } from './types.js'

const GLOBAL_DIR = path.join(os.homedir(), '.jdcagnet', 'skills')

function projectDir(cwd: string): string {
  return path.join(cwd, '.jdcagnet', 'skills')
}

export class SkillLoader {
  private skills = new Map<string, SkillDefinition>()

  async loadAll(cwd: string): Promise<void> {
    this.skills.clear()
    await this.loadDir(GLOBAL_DIR, 'global')
    await this.loadDir(projectDir(cwd), 'project')
  }

  private async loadDir(dir: string, source: 'global' | 'project'): Promise<void> {
    let entries: string[]
    try { entries = await readdir(dir) } catch { return }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry)
      const st = await stat(fullPath).catch(() => null)
      if (!st) continue

      let filePath: string
      if (st.isDirectory()) {
        filePath = path.join(fullPath, 'SKILL.md')
        try { await stat(filePath) } catch { continue }
      } else if (entry.endsWith('.md')) {
        filePath = fullPath
      } else {
        continue
      }

      const skill = await this.parseSkill(filePath, source)
      if (skill) this.skills.set(skill.name, skill)
    }
  }

  private async parseSkill(filePath: string, source: 'global' | 'project'): Promise<SkillDefinition | null> {
    try {
      const raw = await readFile(filePath, 'utf-8')
      const { data, content } = matter(raw)
      const name = data.name || path.basename(filePath, '.md')
      return {
        name,
        description: data.description || '',
        content: content.trim(),
        userInvocable: data['user-invocable'] !== false,
        arguments: data.arguments || [],
        argumentHint: data['argument-hint'],
        allowedTools: data['allowed-tools'],
        source,
        filePath,
      }
    } catch { return null }
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name)
  }

  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values())
  }

  getInvocable(): SkillDefinition[] {
    return this.getAll().filter(s => s.userInvocable)
  }
}

export function renderSkill(skill: SkillDefinition, args?: string): string {
  let content = skill.content
  if (args) {
    const parts = args.split(/\s+/)
    parts.forEach((part, i) => {
      content = content.replace(new RegExp(`\\$\\{${i + 1}\\}`, 'g'), part)
    })
  }
  return content
}
```

- [ ] **Step 3: Write loader tests**

```typescript
// packages/core/src/skills/__tests__/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { SkillLoader, renderSkill } from '../loader.js'

describe('SkillLoader', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'skill-test-'))
    const skillsDir = path.join(tmpDir, '.jdcagnet', 'skills')
    await mkdir(skillsDir, { recursive: true })
    await writeFile(path.join(skillsDir, 'refactor.md'), `---
name: refactor
description: Refactor a file
user-invocable: true
arguments:
  - file-path
argument-hint: "<file-path>"
---

Please refactor \${1} for better readability.
`)
    await writeFile(path.join(skillsDir, 'internal.md'), `---
name: internal
description: Internal skill
user-invocable: false
---

Internal content.
`)
  })

  afterEach(async () => { await rm(tmpDir, { recursive: true }) })

  it('loads skills from project directory', async () => {
    const loader = new SkillLoader()
    await loader.loadAll(tmpDir)
    expect(loader.getAll()).toHaveLength(2)
  })

  it('filters user-invocable skills', async () => {
    const loader = new SkillLoader()
    await loader.loadAll(tmpDir)
    expect(loader.getInvocable()).toHaveLength(1)
    expect(loader.getInvocable()[0].name).toBe('refactor')
  })

  it('gets skill by name', async () => {
    const loader = new SkillLoader()
    await loader.loadAll(tmpDir)
    const skill = loader.get('refactor')
    expect(skill?.description).toBe('Refactor a file')
  })
})

describe('renderSkill', () => {
  it('substitutes arguments', () => {
    const skill = { name: 'test', description: '', content: 'Fix ${1} and ${2}', userInvocable: true, arguments: ['a', 'b'], source: 'project' as const, filePath: '' }
    const result = renderSkill(skill, 'foo.ts bar.ts')
    expect(result).toBe('Fix foo.ts and bar.ts')
  })
})
```

- [ ] **Step 4: Create index and run tests**

```typescript
// packages/core/src/skills/index.ts
export * from './types.js'
export { SkillLoader, renderSkill } from './loader.js'
```

```bash
cd packages/core && pnpm vitest run src/skills/__tests__/loader.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skills/ && git commit -m "feat(skills): add skill types, loader, and argument rendering"
```

---

### Task 5: Skills — SkillTool 实现

**Files:**
- Create: `packages/core/src/tools/skill.ts`
- Modify: `packages/core/src/session.ts`
- Test: `packages/core/src/skills/__tests__/skill-tool.test.ts`

- [ ] **Step 1: Write SkillTool**

```typescript
// packages/core/src/tools/skill.ts
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import { SkillLoader, renderSkill } from '../skills/loader.js'

export function createSkillTool(skillLoader: SkillLoader, injectMessage: (content: string) => void): ToolHandler {
  return {
    definition: {
      name: 'Skill',
      description: 'Invoke a skill by name. Skills are reusable instruction templates loaded from .jdcagnet/skills/.',
      inputSchema: {
        type: 'object',
        properties: {
          skill: { type: 'string', description: 'The skill name to invoke' },
          args: { type: 'string', description: 'Optional arguments for the skill' },
        },
        required: ['skill'],
      },
    },
    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      const name = input.skill as string
      const args = input.args as string | undefined
      const skill = skillLoader.get(name)
      if (!skill) {
        return { content: `Unknown skill: ${name}. Available: ${skillLoader.getAll().map(s => s.name).join(', ')}`, isError: true }
      }
      const rendered = renderSkill(skill, args)
      injectMessage(rendered)
      return { content: `Skill "${name}" activated. Follow the instructions above.` }
    },
  }
}
```

- [ ] **Step 2: Integrate into Session**

在 Session constructor 中，初始化 SkillLoader 并注册 SkillTool：

```typescript
// session.ts 新增:
import { SkillLoader } from './skills/loader.js'
import { createSkillTool } from './tools/skill.js'

// constructor 中:
private skillLoader: SkillLoader

constructor(...) {
  // ... existing ...
  this.skillLoader = new SkillLoader()
  this.skillsReady = this.initSkills()
}

private async initSkills(): Promise<void> {
  await this.skillLoader.loadAll(this.config.cwd)
  this.toolRegistry.register(createSkillTool(this.skillLoader, (content) => {
    this.injectSkillMessage(content)
  }))
}

private injectSkillMessage(content: string): void {
  // 将 skill 内容作为下一轮的 user message 前缀注入
  this.pendingSkillContent = content
}

// 在 sendMessage 中，如果有 pendingSkillContent，prepend 到 user message
```

- [ ] **Step 3: Write test**

```typescript
// packages/core/src/skills/__tests__/skill-tool.test.ts
import { describe, it, expect } from 'vitest'
import { SkillLoader } from '../loader.js'
import { createSkillTool } from '../../tools/skill.js'

describe('SkillTool', () => {
  it('returns error for unknown skill', async () => {
    const loader = new SkillLoader()
    const messages: string[] = []
    const tool = createSkillTool(loader, (msg) => messages.push(msg))
    const result = await tool.execute({ skill: 'nonexistent' }, { cwd: '/tmp' })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('Unknown skill')
  })
})
```

- [ ] **Step 4: Run tests and commit**

```bash
cd packages/core && pnpm vitest run src/skills/__tests__/skill-tool.test.ts
git add packages/core/src/tools/skill.ts packages/core/src/skills/ packages/core/src/session.ts && git commit -m "feat(skills): add SkillTool and session integration"
```

---

### Task 6: Subagent — 子代理 session 和 AgentTool

**Files:**
- Create: `packages/core/src/sub-session.ts`
- Create: `packages/core/src/tools/agent.ts`
- Modify: `packages/core/src/session.ts`
- Test: `packages/core/src/tools/__tests__/agent.test.ts`

- [ ] **Step 1: Write sub-session runner**

```typescript
// packages/core/src/sub-session.ts
import { v4 as uuid } from 'uuid'
import type { Message, StreamChunk, ModelConfig, ContentBlock } from './types.js'
import type { ModelProvider } from './model-provider.js'
import type { ToolRegistry } from './tool-registry.js'
import { ToolRunner } from './tool-runner.js'
import { PermissionChecker } from './permissions.js'
import type { ToolExecutionEvent, PermissionCallback } from './tool-runner.js'

const SUB_AGENT_SYSTEM = `You are a sub-agent executing a specific task. Focus on completing the task efficiently.
You have access to the same tools as the main session.
When done, respond with your final answer as plain text.
Do not ask questions — work with what you have.`

export interface SubSessionOptions {
  prompt: string
  provider: ModelProvider
  toolRegistry: ToolRegistry
  modelConfig: ModelConfig
  cwd: string
  maxTurns?: number
  signal?: AbortSignal
  onToolEvent?: (event: ToolExecutionEvent) => void
  onPermissionRequest?: PermissionCallback
}

export async function runSubSession(opts: SubSessionOptions): Promise<{ content: string; turns: number; toolsUsed: string[] }> {
  const { prompt, provider, toolRegistry, modelConfig, cwd, maxTurns = 10, signal, onToolEvent, onPermissionRequest } = opts
  const sessionId = uuid()
  const toolRunner = new ToolRunner(toolRegistry, cwd, new PermissionChecker(), onPermissionRequest)
  const toolDefs = toolRegistry.getDefinitions().filter(t => t.name !== 'Agent')
  const messages: Message[] = [{ id: uuid(), role: 'user', content: [{ type: 'text', text: prompt }], timestamp: Date.now() }]
  const toolsUsed: string[] = []
  let turns = 0

  while (turns < maxTurns) {
    if (signal?.aborted) break
    turns++

    const chunks: StreamChunk[] = []
    const stream = provider.stream(messages, {
      ...modelConfig,
      systemPrompt: SUB_AGENT_SYSTEM,
    }, toolDefs, signal)

    let textContent = ''
    const toolUses: { id: string; name: string; input: string }[] = []
    let currentToolUse: { id: string; name: string; input: string } | null = null

    for await (const chunk of stream) {
      if (chunk.type === 'text_delta') textContent += chunk.text || ''
      if (chunk.type === 'tool_use_start' && chunk.toolUse) {
        currentToolUse = { id: chunk.toolUse.id, name: chunk.toolUse.name, input: '' }
      }
      if (chunk.type === 'tool_use_delta' && currentToolUse) {
        currentToolUse.input += chunk.text || ''
      }
      if (chunk.type === 'tool_use_end' && currentToolUse) {
        toolUses.push(currentToolUse)
        currentToolUse = null
      }
    }

    // Build assistant message
    const contentBlocks: ContentBlock[] = []
    if (textContent) contentBlocks.push({ type: 'text', text: textContent })
    for (const tu of toolUses) {
      let parsedInput: Record<string, unknown> = {}
      try { parsedInput = JSON.parse(tu.input) } catch {}
      contentBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: parsedInput })
    }
    messages.push({ id: uuid(), role: 'assistant', content: contentBlocks, timestamp: Date.now() })

    // If no tool uses, we're done
    if (toolUses.length === 0) {
      return { content: textContent, turns, toolsUsed }
    }

    // Execute tools
    const toolResults: ContentBlock[] = []
    for (const tu of toolUses) {
      let parsedInput: Record<string, unknown> = {}
      try { parsedInput = JSON.parse(tu.input) } catch {}
      toolsUsed.push(tu.name)
      const result = await toolRunner.execute(tu.name, tu.id, parsedInput, (event) => { onToolEvent?.(event) }, signal)
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: result.content, is_error: result.isError })
    }
    messages.push({ id: uuid(), role: 'user', content: toolResults, timestamp: Date.now() })
  }

  // Max turns reached — extract last text
  const lastAssistant = messages.filter(m => m.role === 'assistant').pop()
  const lastText = lastAssistant?.content.find(b => b.type === 'text')
  return { content: (lastText as any)?.text || '[Sub-agent reached max turns without final response]', turns, toolsUsed }
}
```

- [ ] **Step 2: Write AgentTool**

```typescript
// packages/core/src/tools/agent.ts
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { ToolRegistry } from '../tool-registry.js'
import type { ModelProvider } from '../model-provider.js'
import type { ModelConfig } from '../types.js'
import type { ToolExecutionEvent, PermissionCallback } from '../tool-runner.js'
import { runSubSession } from '../sub-session.js'

export interface AgentToolDeps {
  provider: ModelProvider
  toolRegistry: ToolRegistry
  modelConfig: ModelConfig
  cwd: string
  signal?: AbortSignal
  onToolEvent?: (event: ToolExecutionEvent) => void
  onPermissionRequest?: PermissionCallback
  isSubAgent?: boolean
}

export function createAgentTool(deps: AgentToolDeps): ToolHandler {
  return {
    definition: {
      name: 'Agent',
      description: 'Dispatch a sub-agent to handle a complex task independently. The sub-agent has access to the same tools but runs with its own conversation context.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The task description for the sub-agent' },
          maxTurns: { type: 'number', description: 'Maximum conversation turns (default: 10)' },
        },
        required: ['prompt'],
      },
    },
    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      if (deps.isSubAgent) {
        return { content: 'Sub-agents cannot dispatch further sub-agents.', isError: true }
      }
      const prompt = input.prompt as string
      const maxTurns = (input.maxTurns as number) || 10

      const result = await runSubSession({
        prompt,
        provider: deps.provider,
        toolRegistry: deps.toolRegistry,
        modelConfig: deps.modelConfig,
        cwd: deps.cwd,
        maxTurns,
        signal: deps.signal,
        onToolEvent: deps.onToolEvent,
        onPermissionRequest: deps.onPermissionRequest,
      })

      return { content: result.content }
    },
  }
}
```

- [ ] **Step 3: Register AgentTool in Session**

```typescript
// session.ts — 在 constructor 或 sendMessage 中注册 AgentTool
import { createAgentTool } from './tools/agent.js'

// 在 sendMessage 方法中（因为需要 signal）:
// 注册 AgentTool（每次 sendMessage 更新 signal）
this.toolRegistry.register(createAgentTool({
  provider: this.provider,
  toolRegistry: this.toolRegistry,
  modelConfig: this.config.modelConfig,
  cwd: this.config.cwd,
  signal: this.abortController?.signal,
  onToolEvent: events.onToolEvent,
  onPermissionRequest: this.onPermissionRequest,
  isSubAgent: false,
}))
```

- [ ] **Step 4: Write test**

```typescript
// packages/core/src/tools/__tests__/agent.test.ts
import { describe, it, expect } from 'vitest'
import { createAgentTool } from '../agent.js'
import { ToolRegistry } from '../../tool-registry.js'

describe('AgentTool', () => {
  it('blocks recursive sub-agent dispatch', async () => {
    const registry = new ToolRegistry()
    const tool = createAgentTool({
      provider: {} as any,
      toolRegistry: registry,
      modelConfig: { model: 'test', maxTokens: 1000 },
      cwd: '/tmp',
      isSubAgent: true,
    })
    const result = await tool.execute({ prompt: 'do something' }, { cwd: '/tmp' })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('cannot dispatch')
  })
})
```

- [ ] **Step 5: Run tests and commit**

```bash
cd packages/core && pnpm vitest run src/tools/__tests__/agent.test.ts
git add packages/core/src/sub-session.ts packages/core/src/tools/agent.ts packages/core/src/session.ts && git commit -m "feat(agent): add sub-agent dispatch with AgentTool"
```

---

### Task 7: UI — Skills 集成到 SlashCommandMenu

**Files:**
- Modify: `packages/ui/src/components/SlashCommandMenu.tsx`
- Modify: `packages/ui/src/components/ChatView.tsx`
- Modify: `packages/electron/src/preload.ts`
- Modify: `packages/electron/src/main.ts` (or session-manager)

- [ ] **Step 1: Add IPC for skills list**

```typescript
// packages/electron/src/preload.ts — 新增:
listSkills: () => ipcRenderer.invoke('skills:list'),

// packages/electron/src/session-manager.ts — 新增:
getSkills(): SkillDefinition[] {
  return this.currentSession?.getSkillLoader()?.getInvocable() || []
}
```

- [ ] **Step 2: Extend SlashCommandMenu to show skills**

在 SlashCommandMenu 中，从 IPC 获取 skills 列表，追加到内置命令后面，带 `[SKILL]` 标签。

- [ ] **Step 3: Handle skill invocation in ChatView**

当用户选择 skill 命令时，如果 skill 有 arguments，显示参数输入提示；否则直接发送 `/skill-name` 作为消息。

- [ ] **Step 4: Test in browser and commit**

```bash
cd packages/ui && pnpm build
cd packages/electron && pnpm build && npx electron dist/main.js
git add -A && git commit -m "feat(ui): integrate skills into slash command menu"
```

---

### Task 8: UI — Subagent 进度显示

**Files:**
- Modify: `packages/ui/src/components/ChatView.tsx`
- Modify: `packages/ui/src/hooks/useSession.ts`

- [ ] **Step 1: Track sub-agent events in useSession**

当收到 Agent tool 的 start/progress/complete 事件时，维护一个 `subAgentStatus` 状态。

- [ ] **Step 2: Display sub-agent card in ChatView**

类似 ToolCard 但带 "AGENT" 标签和紫色主题，显示子代理正在执行的工具调用。

- [ ] **Step 3: Test and commit**

```bash
cd packages/electron && pnpm build && npx electron dist/main.js
git add -A && git commit -m "feat(ui): add sub-agent progress display in chat"
```
