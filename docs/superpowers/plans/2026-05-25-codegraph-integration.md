# CodeGraph 集成实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 CodeGraph 内置进 JDC 安装包，作为默认 MCP 服务暴露给主会话、子代理、Team worker，并提供项目级索引初始化的 UI 引导。

**Architecture:** CodeGraph 当作被托管的 stdio MCP 服务，沿用现有 `McpManager`。所有新逻辑集中在 `packages/core/src/codegraph/` 模块，6 个集成点接入。CI 在 macOS / Windows runner 上下载对应平台 binary 打进 `extraResources`。多项目共享一个 codegraph 子进程，靠工具调用时显式传 `projectPath` 路由。

**Tech Stack:** Electron 33、TypeScript 5、pnpm 10、vitest、electron-builder 25、tree-sitter（codegraph 内部）、SQLite + FTS5（codegraph 内部）

**Spec:** [`docs/superpowers/specs/2026-05-25-codegraph-integration-design.md`](../specs/2026-05-25-codegraph-integration-design.md)

---

## 文件结构

新增（按职责分隔，每个文件单一职责）：

```
scripts/
  fetch-codegraph.ts                          下载、校验、解压 codegraph binary

packages/core/src/codegraph/
  index.ts                                    桶状导出
  binary.ts                                   binary 路径解析（dev / packaged）
  mcp-default.ts                              生成默认 MCP 配置
  prompt.ts                                   生成 system prompt 引导片段
  project.ts                                  项目级 init / status / forceReindex
  __tests__/binary.test.ts
  __tests__/mcp-default.test.ts
  __tests__/prompt.test.ts
  __tests__/project.test.ts
```

修改：

```
.github/workflows/release.yml                 macOS / Windows runner 加 fetch 步骤
electron-builder.yml                          extraResources
packages/core/src/agent-types.ts              新增 allowedMcpServers + 过滤逻辑
packages/core/src/mcp/manager.ts              loadConfig 时合并默认 codegraph
packages/core/src/tool-runner.ts              MCP 工具拦截器自动注入 projectPath
packages/core/src/session.ts                  拼 system prompt 时调用 prompt 模块
packages/electron/src/session-manager.ts      activate 时推送项目状态
packages/core/src/__tests__/agent-types.test.ts (扩充)
packages/core/package.json                    导出 codegraph 模块
```

UI 改动（最后两个 task）：

```
packages/ui/src/...                           顶部横条 + Settings 详情入口
```

---

## Task 1：scripts/fetch-codegraph.ts —— 下载与校验

**Files:**
- Create: `scripts/fetch-codegraph.ts`
- Modify: `package.json`（加 script `fetch-codegraph`）

- [ ] **Step 1：写脚本**

```typescript
// scripts/fetch-codegraph.ts
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

type Platform = 'darwin-arm64' | 'darwin-x64' | 'win32-x64' | 'win32-arm64'

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

const ROOT = path.resolve(__dirname, '..')
const RES_DIR = path.join(ROOT, 'packages', 'electron', 'resources', 'codegraph')
const TMP_DIR = path.join(ROOT, 'tmp', 'codegraph-fetch')

function parseArgs(): { platforms: Platform[]; version: string } {
  const argv = process.argv.slice(2)
  let platforms: Platform[] = []
  let version = 'latest'
  for (const a of argv) {
    if (a.startsWith('--platforms=')) {
      platforms = a.slice('--platforms='.length).split(',').map(s => s.trim()) as Platform[]
    } else if (a.startsWith('--version=')) {
      version = a.slice('--version='.length).trim()
    }
  }
  if (platforms.length === 0) {
    const p = process.platform
    const a = process.arch
    if (p === 'darwin' && a === 'arm64') platforms = ['darwin-arm64']
    else if (p === 'darwin' && a === 'x64') platforms = ['darwin-x64']
    else if (p === 'win32' && a === 'x64') platforms = ['win32-x64']
    else if (p === 'win32' && a === 'arm64') platforms = ['win32-arm64']
    else throw new Error(`Unsupported host platform ${p}-${a}; pass --platforms=...`)
  }
  return { platforms, version }
}

async function fetchJson(url: string): Promise<any> {
  const headers: Record<string, string> = { 'user-agent': 'jdc-fetch-codegraph' }
  if (process.env.GH_TOKEN) headers.authorization = `Bearer ${process.env.GH_TOKEN}`
  const r = await fetch(url, { headers })
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`)
  return r.json()
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const headers: Record<string, string> = { 'user-agent': 'jdc-fetch-codegraph' }
  if (process.env.GH_TOKEN) headers.authorization = `Bearer ${process.env.GH_TOKEN}`
  const r = await fetch(url, { headers, redirect: 'follow' })
  if (!r.ok || !r.body) throw new Error(`GET ${url} -> ${r.status}`)
  await pipeline(Readable.fromWeb(r.body as any), createWriteStream(dest))
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function parseSumsFile(content: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [hash, name] = trimmed.split(/\s+/)
    if (hash && name) m.set(name, hash.toLowerCase())
  }
  return m
}

function platformAssetName(p: Platform): string {
  return p.startsWith('win32') ? `codegraph-${p}.zip` : `codegraph-${p}.tar.gz`
}

function extract(file: string, dir: string, p: Platform): void {
  mkdirSync(dir, { recursive: true })
  if (p.startsWith('win32')) {
    if (process.platform === 'win32') {
      execSync(`powershell -Command "Expand-Archive -Force -Path '${file}' -DestinationPath '${dir}'"`, { stdio: 'inherit' })
    } else {
      execSync(`unzip -o "${file}" -d "${dir}"`, { stdio: 'inherit' })
    }
  } else {
    execSync(`tar -xzf "${file}" -C "${dir}"`, { stdio: 'inherit' })
  }
}

async function main() {
  const { platforms, version } = parseArgs()
  console.log(`[fetch-codegraph] platforms=${platforms.join(',')} version=${version}`)

  const release = version === 'latest'
    ? await fetchJson('https://api.github.com/repos/colbymchenry/codegraph/releases/latest')
    : await fetchJson(`https://api.github.com/repos/colbymchenry/codegraph/releases/tags/${version}`)

  const tag: string = release.tag_name
  const assets: ReleaseAsset[] = release.assets || []
  console.log(`[fetch-codegraph] release tag=${tag}`)

  rmSync(TMP_DIR, { recursive: true, force: true })
  mkdirSync(TMP_DIR, { recursive: true })

  const sumsAsset = assets.find(a => a.name === 'SHA256SUMS')
  if (!sumsAsset) throw new Error('SHA256SUMS missing in release')
  const sumsPath = path.join(TMP_DIR, 'SHA256SUMS')
  await downloadFile(sumsAsset.browser_download_url, sumsPath)
  const sums = parseSumsFile(readFileSync(sumsPath, 'utf-8'))

  for (const p of platforms) {
    const assetName = platformAssetName(p)
    const asset = assets.find(a => a.name === assetName)
    if (!asset) throw new Error(`asset ${assetName} missing in release ${tag}`)

    const archivePath = path.join(TMP_DIR, assetName)
    console.log(`[fetch-codegraph] downloading ${assetName}...`)
    await downloadFile(asset.browser_download_url, archivePath)

    const want = sums.get(assetName)
    const got = sha256(archivePath)
    if (!want) throw new Error(`no sha for ${assetName}`)
    if (want !== got) throw new Error(`sha mismatch ${assetName}: want ${want}, got ${got}`)
    console.log(`[fetch-codegraph] ${assetName} sha ok`)

    const outDir = path.join(RES_DIR, p)
    rmSync(outDir, { recursive: true, force: true })
    extract(archivePath, outDir, p)
    console.log(`[fetch-codegraph] extracted to ${outDir}`)
  }

  mkdirSync(RES_DIR, { recursive: true })
  writeFileSync(path.join(RES_DIR, 'VERSION'), tag.replace(/^v/, ''), 'utf-8')

  const hostP: Platform | null =
    process.platform === 'darwin' && process.arch === 'arm64' ? 'darwin-arm64'
    : process.platform === 'darwin' && process.arch === 'x64' ? 'darwin-x64'
    : process.platform === 'win32' && process.arch === 'x64' ? 'win32-x64'
    : process.platform === 'win32' && process.arch === 'arm64' ? 'win32-arm64'
    : null
  if (hostP && platforms.includes(hostP)) {
    const binName = hostP.startsWith('win32') ? 'codegraph.exe' : 'codegraph'
    const candidates = [
      path.join(RES_DIR, hostP, 'bin', binName),
      path.join(RES_DIR, hostP, binName),
    ]
    const bin = candidates.find(c => existsSync(c))
    if (!bin) throw new Error(`smoke test: binary not found in ${candidates.join(' | ')}`)
    console.log(`[fetch-codegraph] smoke test: ${bin} --version`)
    execSync(`"${bin}" --version`, { stdio: 'inherit' })
  } else {
    console.log('[fetch-codegraph] smoke test skipped (cross-platform fetch)')
  }

  rmSync(TMP_DIR, { recursive: true, force: true })
  console.log('[fetch-codegraph] done')
}

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2：在 root `package.json` 的 `scripts` 加一条**

```json
"scripts": {
  ...
  "fetch-codegraph": "tsx scripts/fetch-codegraph.ts"
}
```

- [ ] **Step 3：本机跑一次冒烟**

Run: `pnpm fetch-codegraph`
Expected: 输出 `release tag=vX.Y.Z`、下载、`sha ok`、`extracted to ...`、`smoke test: ... --version` 输出版本号、`done`。完成后 `packages/electron/resources/codegraph/<host>/` 存在 binary，`packages/electron/resources/codegraph/VERSION` 文件存在。

- [ ] **Step 4：把 resources/codegraph/ 加到 .gitignore（不入库 binary）**

Edit: `.gitignore`，追加：
```
packages/electron/resources/codegraph/
```

- [ ] **Step 5：提交**

```bash
git add scripts/fetch-codegraph.ts package.json .gitignore
git commit -m "feat(codegraph): add fetch-codegraph script for downloading binaries"
```

---

## Task 2：codegraph/binary.ts —— 路径解析

**Files:**
- Create: `packages/core/src/codegraph/binary.ts`
- Test: `packages/core/src/codegraph/__tests__/binary.test.ts`

- [ ] **Step 1：写测试**

```typescript
// packages/core/src/codegraph/__tests__/binary.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

describe('resolveCodegraphBinary', () => {
  let tmp: string
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'codegraph-bin-'))
    originalEnv = { ...process.env }
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
    process.env = originalEnv
    vi.resetModules()
  })

  it('returns the dev resources path when binary exists there', async () => {
    const hostKey = `${process.platform === 'win32' ? 'win32' : process.platform}-${process.arch}`
    const dir = path.join(tmp, 'packages', 'electron', 'resources', 'codegraph', hostKey, 'bin')
    mkdirSync(dir, { recursive: true })
    const binName = process.platform === 'win32' ? 'codegraph.exe' : 'codegraph'
    const file = path.join(dir, binName)
    writeFileSync(file, '#!/bin/sh\necho 0\n')
    if (process.platform !== 'win32') chmodSync(file, 0o755)

    process.env.JDC_CODEGRAPH_DEV_ROOT = tmp
    const { resolveCodegraphBinary } = await import('../binary.js')
    expect(resolveCodegraphBinary()).toBe(file)
  })

  it('returns null when binary cannot be located', async () => {
    process.env.JDC_CODEGRAPH_DEV_ROOT = tmp
    process.env.PATH = ''
    const { resolveCodegraphBinary } = await import('../binary.js')
    expect(resolveCodegraphBinary()).toBeNull()
  })

  it('isCodegraphAvailable mirrors resolveCodegraphBinary', async () => {
    process.env.JDC_CODEGRAPH_DEV_ROOT = tmp
    process.env.PATH = ''
    const { isCodegraphAvailable } = await import('../binary.js')
    expect(isCodegraphAvailable()).toBe(false)
  })
})
```

- [ ] **Step 2：跑测试，确认失败**

Run: `pnpm --filter @jdcagnet/core test -- binary.test`
Expected: FAIL，找不到 `../binary.js`。

- [ ] **Step 3：实现**

```typescript
// packages/core/src/codegraph/binary.ts
import { existsSync } from 'node:fs'
import path from 'node:path'

function platformKey(): string | null {
  const p = process.platform
  const a = process.arch
  if (p === 'darwin' && a === 'arm64') return 'darwin-arm64'
  if (p === 'darwin' && a === 'x64') return 'darwin-x64'
  if (p === 'win32' && a === 'x64') return 'win32-x64'
  if (p === 'win32' && a === 'arm64') return 'win32-arm64'
  return null
}

function binaryName(): string {
  return process.platform === 'win32' ? 'codegraph.exe' : 'codegraph'
}

function findInResourceTree(root: string): string | null {
  const key = platformKey()
  if (!key) return null
  const candidates = [
    path.join(root, key, 'bin', binaryName()),
    path.join(root, key, binaryName()),
  ]
  return candidates.find(p => existsSync(p)) ?? null
}

function findOnPath(): string | null {
  const PATH = process.env.PATH ?? ''
  if (!PATH) return null
  const sep = process.platform === 'win32' ? ';' : ':'
  for (const dir of PATH.split(sep)) {
    if (!dir) continue
    const candidate = path.join(dir, binaryName())
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function resolveCodegraphBinary(): string | null {
  const isPackaged =
    typeof (process as any).resourcesPath === 'string' &&
    (process as any).resourcesPath.length > 0 &&
    !((process as any).defaultApp)

  if (isPackaged) {
    const root = path.join((process as any).resourcesPath, 'codegraph')
    const found = findInResourceTree(root)
    if (found) return found
  }

  const devRoot = process.env.JDC_CODEGRAPH_DEV_ROOT ?? process.cwd()
  const devTree = path.join(devRoot, 'packages', 'electron', 'resources', 'codegraph')
  const devFound = findInResourceTree(devTree)
  if (devFound) return devFound

  return findOnPath()
}

export function isCodegraphAvailable(): boolean {
  return resolveCodegraphBinary() !== null
}
```

- [ ] **Step 4：跑测试，确认通过**

Run: `pnpm --filter @jdcagnet/core test -- binary.test`
Expected: PASS（3 个 test）。

- [ ] **Step 5：提交**

```bash
git add packages/core/src/codegraph/binary.ts packages/core/src/codegraph/__tests__/binary.test.ts
git commit -m "feat(codegraph): add binary path resolver"
```

---

## Task 3：codegraph/mcp-default.ts —— 默认 MCP 配置

**Files:**
- Create: `packages/core/src/codegraph/mcp-default.ts`
- Test: `packages/core/src/codegraph/__tests__/mcp-default.test.ts`

- [ ] **Step 1：写测试**

```typescript
// packages/core/src/codegraph/__tests__/mcp-default.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'

describe('getDefaultCodegraphMcpConfig', () => {
  afterEach(() => vi.resetModules())

  it('returns null when binary is not available', async () => {
    vi.doMock('../binary.js', () => ({
      resolveCodegraphBinary: () => null,
      isCodegraphAvailable: () => false,
    }))
    const { getDefaultCodegraphMcpConfig, CODEGRAPH_SERVER_NAME } = await import('../mcp-default.js')
    expect(getDefaultCodegraphMcpConfig()).toBeNull()
    expect(CODEGRAPH_SERVER_NAME).toBe('codegraph')
  })

  it('returns stdio config when binary exists', async () => {
    vi.doMock('../binary.js', () => ({
      resolveCodegraphBinary: () => '/opt/codegraph/bin/codegraph',
      isCodegraphAvailable: () => true,
    }))
    const { getDefaultCodegraphMcpConfig } = await import('../mcp-default.js')
    expect(getDefaultCodegraphMcpConfig()).toEqual({
      transport: 'stdio',
      command: '/opt/codegraph/bin/codegraph',
      args: ['serve', '--mcp'],
    })
  })
})
```

- [ ] **Step 2：跑测试，确认失败**

Run: `pnpm --filter @jdcagnet/core test -- mcp-default.test`
Expected: FAIL，找不到 `../mcp-default.js`。

- [ ] **Step 3：实现**

```typescript
// packages/core/src/codegraph/mcp-default.ts
import type { McpStdioConfig } from '../mcp/types.js'
import { resolveCodegraphBinary } from './binary.js'

export const CODEGRAPH_SERVER_NAME = 'codegraph'

export function getDefaultCodegraphMcpConfig(): McpStdioConfig | null {
  const bin = resolveCodegraphBinary()
  if (!bin) return null
  return {
    transport: 'stdio',
    command: bin,
    args: ['serve', '--mcp'],
  }
}
```

- [ ] **Step 4：跑测试**

Run: `pnpm --filter @jdcagnet/core test -- mcp-default.test`
Expected: PASS（2 个）。

- [ ] **Step 5：提交**

```bash
git add packages/core/src/codegraph/mcp-default.ts packages/core/src/codegraph/__tests__/mcp-default.test.ts
git commit -m "feat(codegraph): add default MCP config generator"
```

---

## Task 4：codegraph/prompt.ts —— system prompt 引导

**Files:**
- Create: `packages/core/src/codegraph/prompt.ts`
- Test: `packages/core/src/codegraph/__tests__/prompt.test.ts`

- [ ] **Step 1：写测试**

```typescript
// packages/core/src/codegraph/__tests__/prompt.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { getCodegraphPromptSegment } from '../prompt.js'

describe('getCodegraphPromptSegment', () => {
  let tmp: string

  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'cg-prompt-'))
  })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('returns empty segment when project has no .codegraph/', () => {
    const out = getCodegraphPromptSegment(tmp)
    expect(out.segment).toBe('')
    expect(out.cacheable).toBe(false)
  })

  it('returns guidance segment containing cwd when .codegraph/codegraph.db exists', () => {
    const cgDir = path.join(tmp, '.codegraph')
    mkdirSync(cgDir, { recursive: true })
    writeFileSync(path.join(cgDir, 'codegraph.db'), '')
    const out = getCodegraphPromptSegment(tmp)
    expect(out.cacheable).toBe(false)
    expect(out.segment).toContain('mcp__codegraph__codegraph_')
    expect(out.segment).toContain(tmp)
    expect(out.segment).toContain('projectPath')
  })
})
```

- [ ] **Step 2：跑测试**

Run: `pnpm --filter @jdcagnet/core test -- prompt.test`
Expected: FAIL，找不到 `../prompt.js`。

- [ ] **Step 3：实现**

```typescript
// packages/core/src/codegraph/prompt.ts
import { existsSync } from 'node:fs'
import path from 'node:path'

export interface CodegraphPromptSegment {
  segment: string
  cacheable: false
}

export function getCodegraphPromptSegment(cwd: string): CodegraphPromptSegment {
  const dbPath = path.join(cwd, '.codegraph', 'codegraph.db')
  if (!existsSync(dbPath)) {
    return { segment: '', cacheable: false }
  }
  const segment =
    `\n\n## CodeGraph (本项目已建立索引)\n\n` +
    `本项目根目录下存在 \`.codegraph/\` 索引。回答涉及代码架构、调用链、影响面、` +
    `「X 怎么实现 / X 调用了什么 / 改 X 影响哪些代码」这类问题时，**优先使用** ` +
    `\`mcp__codegraph__codegraph_*\` 工具（context / search / callers / callees / impact / trace / explore / node），` +
    `不要委派 Explore 子代理去 grep + Read 重做这件事。CodeGraph 返回的源码是权威来源，` +
    `不必再次读取相同文件。\n\n` +
    `**调用 \`mcp__codegraph__codegraph_*\` 工具时必须传入 \`projectPath\` 参数**，` +
    `值固定为本会话的项目根目录：\n\n` +
    `\`projectPath: "${cwd}"\`\n\n` +
    `多个项目同时打开时省略此参数会查询到错误的项目。`
  return { segment, cacheable: false }
}
```

- [ ] **Step 4：跑测试**

Run: `pnpm --filter @jdcagnet/core test -- prompt.test`
Expected: PASS（2 个）。

- [ ] **Step 5：提交**

```bash
git add packages/core/src/codegraph/prompt.ts packages/core/src/codegraph/__tests__/prompt.test.ts
git commit -m "feat(codegraph): add system prompt segment generator"
```

---

## Task 5：codegraph/project.ts —— 项目级状态与初始化

**Files:**
- Create: `packages/core/src/codegraph/project.ts`
- Test: `packages/core/src/codegraph/__tests__/project.test.ts`

- [ ] **Step 1：写测试**

```typescript
// packages/core/src/codegraph/__tests__/project.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'

describe('codegraph/project', () => {
  let tmp: string
  beforeEach(() => { tmp = mkdtempSync(path.join(os.tmpdir(), 'cg-proj-')) })
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true })
    vi.resetModules()
  })

  it('isInitialized returns false when no .codegraph/codegraph.db', async () => {
    const { isInitialized } = await import('../project.js')
    expect(isInitialized(tmp)).toBe(false)
  })

  it('isInitialized returns true when .codegraph/codegraph.db exists', async () => {
    mkdirSync(path.join(tmp, '.codegraph'), { recursive: true })
    writeFileSync(path.join(tmp, '.codegraph', 'codegraph.db'), '')
    const { isInitialized } = await import('../project.js')
    expect(isInitialized(tmp)).toBe(true)
  })

  it('init throws when binary unavailable', async () => {
    vi.doMock('../binary.js', () => ({
      resolveCodegraphBinary: () => null,
      isCodegraphAvailable: () => false,
    }))
    const { init } = await import('../project.js')
    await expect(init(tmp)).rejects.toThrow(/binary/i)
  })

  it('init spawns binary with index args and resolves on exit 0', async () => {
    const fakeProc: any = new EventEmitter()
    fakeProc.stdout = new EventEmitter()
    fakeProc.stderr = new EventEmitter()
    fakeProc.kill = vi.fn()

    const spawnMock = vi.fn(() => fakeProc)
    vi.doMock('node:child_process', () => ({ spawn: spawnMock }))
    vi.doMock('../binary.js', () => ({
      resolveCodegraphBinary: () => '/fake/codegraph',
      isCodegraphAvailable: () => true,
    }))

    const { init } = await import('../project.js')
    const lines: string[] = []
    const p = init(tmp, line => lines.push(line))
    fakeProc.stdout.emit('data', Buffer.from('progress: 50/100\n'))
    fakeProc.emit('exit', 0, null)
    await p
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [cmd, args] = spawnMock.mock.calls[0]
    expect(cmd).toBe('/fake/codegraph')
    expect(args).toEqual(['index', tmp])
    expect(lines.some(l => l.includes('progress'))).toBe(true)
  })

  it('init rejects on non-zero exit code', async () => {
    const fakeProc: any = new EventEmitter()
    fakeProc.stdout = new EventEmitter()
    fakeProc.stderr = new EventEmitter()
    fakeProc.kill = vi.fn()
    vi.doMock('node:child_process', () => ({ spawn: vi.fn(() => fakeProc) }))
    vi.doMock('../binary.js', () => ({
      resolveCodegraphBinary: () => '/fake/codegraph',
      isCodegraphAvailable: () => true,
    }))
    const { init } = await import('../project.js')
    const p = init(tmp)
    fakeProc.stderr.emit('data', Buffer.from('boom\n'))
    fakeProc.emit('exit', 2, null)
    await expect(p).rejects.toThrow(/exit code 2/)
  })
})
```

- [ ] **Step 2：跑测试**

Run: `pnpm --filter @jdcagnet/core test -- project.test`
Expected: FAIL，找不到 `../project.js`。

- [ ] **Step 3：实现**

```typescript
// packages/core/src/codegraph/project.ts
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveCodegraphBinary } from './binary.js'

export function isInitialized(cwd: string): boolean {
  return existsSync(path.join(cwd, '.codegraph', 'codegraph.db'))
}

interface RunResult {
  child: ChildProcess
  done: Promise<void>
}

function runCodegraph(args: string[], onProgress?: (line: string) => void): RunResult {
  const bin = resolveCodegraphBinary()
  if (!bin) throw new Error('CodeGraph binary not available on this host')
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const errChunks: Buffer[] = []
  const forwardLines = (buf: Buffer) => {
    if (!onProgress) return
    const text = buf.toString('utf-8')
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (t) onProgress(t)
    }
  }
  child.stdout?.on('data', forwardLines)
  child.stderr?.on('data', (b: Buffer) => {
    errChunks.push(b)
    forwardLines(b)
  })
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`codegraph ${args.join(' ')} exit code ${code}${signal ? ` signal ${signal}` : ''}: ${Buffer.concat(errChunks).toString('utf-8').trim()}`))
    })
  })
  return { child, done }
}

export function init(cwd: string, onProgress?: (line: string) => void): Promise<void> & { cancel: () => void } {
  const { child, done } = runCodegraph(['index', cwd], onProgress)
  const promise = done as Promise<void> & { cancel: () => void }
  promise.cancel = () => { try { child.kill('SIGTERM') } catch { /* ignore */ } }
  return promise
}

export function forceReindex(cwd: string, onProgress?: (line: string) => void): Promise<void> & { cancel: () => void } {
  const { child, done } = runCodegraph(['index', cwd, '--force'], onProgress)
  const promise = done as Promise<void> & { cancel: () => void }
  promise.cancel = () => { try { child.kill('SIGTERM') } catch { /* ignore */ } }
  return promise
}

export interface CodegraphProjectStatus {
  symbols: number
  lastIndexed: number
}

export async function getStatus(cwd: string): Promise<CodegraphProjectStatus | null> {
  if (!isInitialized(cwd)) return null
  try {
    const lines: string[] = []
    const { done } = runCodegraph(['status', cwd, '--json'], l => lines.push(l))
    await done
    const joined = lines.join('\n')
    const start = joined.indexOf('{')
    const end = joined.lastIndexOf('}')
    if (start < 0 || end < 0) return null
    const parsed = JSON.parse(joined.slice(start, end + 1))
    return {
      symbols: typeof parsed.symbols === 'number' ? parsed.symbols : 0,
      lastIndexed: typeof parsed.lastIndexed === 'number' ? parsed.lastIndexed : 0,
    }
  } catch {
    return null
  }
}
```

- [ ] **Step 4：跑测试**

Run: `pnpm --filter @jdcagnet/core test -- project.test`
Expected: PASS（5 个）。

- [ ] **Step 5：提交**

```bash
git add packages/core/src/codegraph/project.ts packages/core/src/codegraph/__tests__/project.test.ts
git commit -m "feat(codegraph): add project init/status/forceReindex helpers"
```

---

## Task 6：codegraph/index.ts —— 桶状导出 + 顶层导出

**Files:**
- Create: `packages/core/src/codegraph/index.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1：创建桶状文件**

```typescript
// packages/core/src/codegraph/index.ts
export { resolveCodegraphBinary, isCodegraphAvailable } from './binary.js'
export { getDefaultCodegraphMcpConfig, CODEGRAPH_SERVER_NAME } from './mcp-default.js'
export { getCodegraphPromptSegment, type CodegraphPromptSegment } from './prompt.js'
export {
  isInitialized,
  init,
  forceReindex,
  getStatus,
  type CodegraphProjectStatus,
} from './project.js'
```

- [ ] **Step 2：在 `packages/core/src/index.ts` 末尾追加一行**

Read file first to find the right location, then add:

```typescript
export * as codegraph from './codegraph/index.js'
```

- [ ] **Step 3：构建验证**

Run: `pnpm --filter @jdcagnet/core build`
Expected: 0 errors。

- [ ] **Step 4：提交**

```bash
git add packages/core/src/codegraph/index.ts packages/core/src/index.ts
git commit -m "feat(codegraph): export module from @jdcagnet/core"
```

---

## Task 7：agent-types.ts —— allowedMcpServers 字段

**Files:**
- Modify: `packages/core/src/agent-types.ts`
- Test: `packages/core/src/__tests__/agent-types.test.ts`（新建或扩充）

- [ ] **Step 1：写测试（如果文件不存在则新建）**

```typescript
// packages/core/src/__tests__/agent-types.test.ts
import { describe, it, expect } from 'vitest'
import { filterToolsForAgent, AGENT_TYPES } from '../agent-types.js'
import type { ToolDefinition } from '../types.js'

const tools: ToolDefinition[] = [
  { name: 'file_read', description: '', inputSchema: {} },
  { name: 'grep', description: '', inputSchema: {} },
  { name: 'mcp__codegraph__codegraph_search', description: '', inputSchema: {} },
  { name: 'mcp__codegraph__codegraph_context', description: '', inputSchema: {} },
  { name: 'mcp__other__do_thing', description: '', inputSchema: {} },
  { name: 'Agent', description: '', inputSchema: {} },
  { name: 'Skill', description: '', inputSchema: {} },
]

describe('filterToolsForAgent — MCP whitelisting', () => {
  it('explore allows mcp__codegraph__* but not mcp__other__*', () => {
    const out = filterToolsForAgent('explore', tools).map(t => t.name)
    expect(out).toContain('mcp__codegraph__codegraph_search')
    expect(out).toContain('mcp__codegraph__codegraph_context')
    expect(out).not.toContain('mcp__other__do_thing')
  })

  it('frontend-designer denies all mcp__* tools', () => {
    const out = filterToolsForAgent('frontend-designer', tools).map(t => t.name)
    expect(out.some(n => n.startsWith('mcp__'))).toBe(false)
  })

  it('general allows all mcp__* tools', () => {
    const out = filterToolsForAgent('general', tools).map(t => t.name)
    expect(out).toContain('mcp__codegraph__codegraph_search')
    expect(out).toContain('mcp__other__do_thing')
  })

  it('FORBIDDEN_FOR_SUBAGENT still applies regardless of MCP whitelist', () => {
    const out = filterToolsForAgent('general', tools).map(t => t.name)
    expect(out).not.toContain('Agent')
    expect(out).not.toContain('Skill')
  })

  it('every AGENT_TYPES entry declares allowedMcpServers explicitly', () => {
    for (const t of AGENT_TYPES) {
      expect(Array.isArray(t.allowedMcpServers)).toBe(true)
    }
  })
})
```

- [ ] **Step 2：跑测试，确认失败**

Run: `pnpm --filter @jdcagnet/core test -- agent-types.test`
Expected: FAIL（`allowedMcpServers` 不存在 / MCP 工具未被过滤）。

- [ ] **Step 3：在 `packages/core/src/agent-types.ts` 修改类型与定义**

3a. 修改 `AgentTypeDefinition` interface：

Edit lines 4-10 of `packages/core/src/agent-types.ts`：

```typescript
export interface AgentTypeDefinition {
  name: string
  description: string
  systemPrompt: string
  allowedTools: string[]
  allowedMcpServers: string[]   // 新增；[] = 全禁；['*'] = 全放行；['name1', 'name2'] = 按名放行
  maxTurns: number
}
```

3b. 给每个 AGENT_TYPES 条目加 `allowedMcpServers`（在 `allowedTools` 后、`maxTurns` 前）：

| name | allowedMcpServers |
|---|---|
| `explore` | `['codegraph']` |
| `plan` | `['codegraph']` |
| `refactor` | `['codegraph']` |
| `security-auditor` | `['codegraph']` |
| `frontend-designer` | `[]` |
| `general` | `['*']` |

例如 `explore` 修改后：

```typescript
{
  name: 'explore',
  description: '...',
  systemPrompt: `...`,
  allowedTools: ['file_read', 'glob', 'grep', 'ls', 'tree', 'web_search', 'web_fetch', 'lsp'],
  allowedMcpServers: ['codegraph'],
  maxTurns: 25,
},
```

3c. 修改 `filterToolsForAgent`（替换 `packages/core/src/agent-types.ts:196-219` 整个函数）：

```typescript
function isMcpTool(name: string): boolean {
  return name.startsWith('mcp__')
}

function mcpServerOf(name: string): string {
  // 'mcp__codegraph__codegraph_search' -> 'codegraph'
  return name.split('__')[1] ?? ''
}

function isMcpAllowed(toolName: string, allowed: string[]): boolean {
  if (!isMcpTool(toolName)) return true
  if (allowed.includes('*')) return true
  return allowed.includes(mcpServerOf(toolName))
}

export function filterToolsForAgent(agentType: string, allTools: ToolDefinition[]): ToolDefinition[] {
  const typeDef = getAgentType(agentType)
  const FORBIDDEN_FOR_SUBAGENT = new Set([
    'Agent',
    'Skill',
    'ask_user',
    'AskUserQuestion',
    'EnterPlanMode',
    'ExitPlanMode',
  ])

  const mcpAllowed = typeDef?.allowedMcpServers ?? []

  if (!typeDef) {
    return allTools.filter(t =>
      !FORBIDDEN_FOR_SUBAGENT.has(t.name) &&
      isMcpAllowed(t.name, mcpAllowed)
    )
  }

  if (typeDef.allowedTools.includes('*')) {
    return allTools.filter(t =>
      !FORBIDDEN_FOR_SUBAGENT.has(t.name) &&
      isMcpAllowed(t.name, mcpAllowed)
    )
  }

  return allTools.filter(t =>
    !FORBIDDEN_FOR_SUBAGENT.has(t.name) &&
    (
      typeDef.allowedTools.includes(t.name) ||
      (isMcpTool(t.name) && isMcpAllowed(t.name, mcpAllowed))
    )
  )
}
```

- [ ] **Step 4：跑测试**

Run: `pnpm --filter @jdcagnet/core test -- agent-types.test`
Expected: PASS（5 个）。

- [ ] **Step 5：构建检查**

Run: `pnpm --filter @jdcagnet/core build`
Expected: 0 errors。

- [ ] **Step 6：提交**

```bash
git add packages/core/src/agent-types.ts packages/core/src/__tests__/agent-types.test.ts
git commit -m "feat(agent-types): add allowedMcpServers to gate MCP tools per sub-agent"
```

---

## Task 8：mcp/manager.ts —— 启动时合并默认 codegraph 配置

**Files:**
- Modify: `packages/core/src/mcp/manager.ts`

- [ ] **Step 1：读 `packages/core/src/mcp/manager.ts:25-36`，改 `loadConfig` 方法**

```typescript
async loadConfig(configs: Record<string, McpServerConfig>): Promise<void> {
  // Inject default codegraph config when user hasn't defined one
  const merged: Record<string, McpServerConfig> = { ...configs }
  if (!merged[CODEGRAPH_SERVER_NAME]) {
    const defaultCfg = getDefaultCodegraphMcpConfig()
    if (defaultCfg) {
      merged[CODEGRAPH_SERVER_NAME] = defaultCfg
    }
  }
  for (const [name, config] of Object.entries(merged)) {
    if (config.disabled) {
      this.servers.set(name, {
        name, config, client: null, transport: null,
        tools: [], status: 'disabled',
      })
      continue
    }
    await this.connectServer(name, config)
  }
}
```

- [ ] **Step 2：在文件顶部 imports 加一行**

Edit `packages/core/src/mcp/manager.ts` 顶部（`import type { McpServerConfig...` 之后）：

```typescript
import { CODEGRAPH_SERVER_NAME, getDefaultCodegraphMcpConfig } from '../codegraph/index.js'
```

- [ ] **Step 3：构建检查**

Run: `pnpm --filter @jdcagnet/core build`
Expected: 0 errors。

- [ ] **Step 4：手动验证（启动前置条件：Task 1 已跑过 `pnpm fetch-codegraph`）**

Run: `pnpm dev`
Expected: 启动后日志可见 codegraph 子进程被启动；Settings → MCP 中存在 `codegraph` 服务，状态 `connected`，工具列表里有 `codegraph_search` / `codegraph_context` 等。

- [ ] **Step 5：提交**

```bash
git add packages/core/src/mcp/manager.ts
git commit -m "feat(mcp): auto-inject default codegraph MCP server when not configured by user"
```

---

## Task 9：tool-runner.ts —— 自动注入 projectPath

**Files:**
- Modify: `packages/core/src/tool-runner.ts`
- Test: `packages/core/src/__tests__/tool-runner.test.ts`（新建或扩充）

- [ ] **Step 1：写测试**

```typescript
// packages/core/src/__tests__/tool-runner.test.ts
import { describe, it, expect, vi } from 'vitest'
import { ToolRunner } from '../tool-runner.js'
import { ToolRegistry } from '../tool-registry.js'
import { PermissionChecker } from '../permissions.js'

function makeRunner(cwd: string) {
  const registry = new ToolRegistry()
  const captured: Record<string, unknown>[] = []
  registry.register({
    definition: {
      name: 'mcp__codegraph__codegraph_search',
      description: '',
      inputSchema: { type: 'object', properties: {} },
    },
    async execute(input) {
      captured.push(input)
      return { content: 'ok' }
    },
  })
  registry.register({
    definition: {
      name: 'mcp__other__thing',
      description: '',
      inputSchema: { type: 'object', properties: {} },
    },
    async execute(input) {
      captured.push(input)
      return { content: 'ok' }
    },
  })
  const runner = new ToolRunner(registry, cwd, new PermissionChecker('relaxed'))
  return { runner, captured }
}

describe('ToolRunner — codegraph projectPath auto-injection', () => {
  it('injects projectPath when missing', async () => {
    const cwd = '/tmp/proj-A'
    const { runner, captured } = makeRunner(cwd)
    await runner.execute('mcp__codegraph__codegraph_search', 'tu1', { query: 'foo' }, () => {})
    expect(captured[0]).toEqual({ query: 'foo', projectPath: cwd })
  })

  it('keeps explicit projectPath when caller provides it', async () => {
    const cwd = '/tmp/proj-A'
    const { runner, captured } = makeRunner(cwd)
    await runner.execute('mcp__codegraph__codegraph_search', 'tu1', { query: 'foo', projectPath: '/other' }, () => {})
    expect(captured[0]).toEqual({ query: 'foo', projectPath: '/other' })
  })

  it('does not inject for non-codegraph MCP tools', async () => {
    const cwd = '/tmp/proj-A'
    const { runner, captured } = makeRunner(cwd)
    await runner.execute('mcp__other__thing', 'tu1', { x: 1 }, () => {})
    expect(captured[0]).toEqual({ x: 1 })
  })
})
```

- [ ] **Step 2：跑测试**

Run: `pnpm --filter @jdcagnet/core test -- tool-runner.test`
Expected: FAIL（projectPath 没注入）。

- [ ] **Step 3：在 `packages/core/src/tool-runner.ts` 的 `execute` 方法、紧跟 line 55 `const handler = this.registry.get(toolName)` 之前插入注入逻辑**

```typescript
// codegraph: auto-inject projectPath when caller omitted it.
// Without this, the codegraph MCP server falls back to its own process.cwd
// (the JDC startup dir), which is wrong for multi-project sessions.
if (
  toolName.startsWith('mcp__codegraph__') &&
  (input == null || (input as Record<string, unknown>).projectPath == null)
) {
  input = { ...(input ?? {}), projectPath: this.cwd }
}
```

放在 `async execute(...)` 函数体最开始、紧贴 line 54 之后（在 `const handler = this.registry.get(toolName)` 前）。

- [ ] **Step 4：跑测试**

Run: `pnpm --filter @jdcagnet/core test -- tool-runner.test`
Expected: PASS（3 个）。

- [ ] **Step 5：构建检查**

Run: `pnpm --filter @jdcagnet/core build`
Expected: 0 errors。

- [ ] **Step 6：提交**

```bash
git add packages/core/src/tool-runner.ts packages/core/src/__tests__/tool-runner.test.ts
git commit -m "feat(tool-runner): auto-inject projectPath for codegraph MCP tools"
```

---

## Task 10：session.ts —— system prompt 注入引导

**Files:**
- Modify: `packages/core/src/session.ts`

- [ ] **Step 1：找到 session 拼 system prompt 的位置**

Run: `grep -n "systemPrompt\|cacheable" packages/core/src/session.ts | head -30`

记录关键行号（基础提示构造、最终 modelConfig.systemPrompt 赋值）。

- [ ] **Step 2：在 session 内拼 prompt 时，把 codegraph 引导追加到 inherited 段尾部**

打开 `packages/core/src/session.ts`，在文件顶部 imports 区追加：

```typescript
import { getCodegraphPromptSegment } from './codegraph/index.js'
```

定位到当前构造 `modelConfig.systemPrompt`（或合并 base prompt + 项目规则 + 内存 等）的位置。在最终生成的 segments 数组**末尾**追加 codegraph 段（仅当返回非空时）：

```typescript
// codegraph guidance: only when project has .codegraph/. Marked uncacheable
// because the cwd embedded in the segment varies per session.
const cgSeg = getCodegraphPromptSegment(this.config.cwd)
if (cgSeg.segment) {
  // 假定现存代码使用 PromptSegment[] 形式构造 systemPrompt：
  segments.push({ content: cgSeg.segment, cacheable: false })
}
```

> 注意：现存代码可能把 systemPrompt 构造在多处（base、compact 后重建、resolveModel 切模型重建）。**所有重建点都要追加**，不能漏。Task 10 在实施时先用 grep 找出所有 modelConfig.systemPrompt 写入点（约 2-3 处），逐个补齐。
> 如果某处的 systemPrompt 还是字符串形式而非 segment 数组，先把它转成数组再追加。

- [ ] **Step 3：构建检查**

Run: `pnpm --filter @jdcagnet/core build`
Expected: 0 errors。

- [ ] **Step 4：手动验证**

启动 dev 模式 → 任意打开一个**未初始化** codegraph 的项目，向 AI 提问 → 检查 session 日志 / debug 面板里 system prompt 不包含 codegraph 段。

把项目 init 一次（任何已索引的目录手动复制 `.codegraph/` 也行，或下游 Task 11 提供按钮后再回归），重提问 → system prompt 末尾出现引导段，含本会话 cwd 字符串。

- [ ] **Step 5：提交**

```bash
git add packages/core/src/session.ts
git commit -m "feat(session): inject codegraph system prompt segment when project has .codegraph/"
```

---

## Task 11：electron — IPC 通道与项目状态推送

**Files:**
- Modify: `packages/electron/src/session-manager.ts`
- Modify: `packages/electron/src/ipc.ts`（或现有 IPC 注册位置；先 grep 确认）

- [ ] **Step 1：确认 IPC 注册文件**

Run: `grep -rn "ipcMain.handle\|ipcMain.on" packages/electron/src | head -20`
记录用于 IPC 注册的文件路径。

- [ ] **Step 2：在 `session-manager.ts` 顶部 imports 加一行**

```typescript
import { codegraph } from '@jdcagnet/core'
```

- [ ] **Step 3：在 SessionManager 类中加新方法**

在 `activateSession` 方法尾部、`return` / 最后一行之前，追加：

```typescript
this.evaluateCodegraphState(meta.cwd)
```

并在类内新增方法：

```typescript
private getDismissedCodegraphCwds(): string[] {
  const cfg = loadAppConfig() as { dismissedCodegraphForCwds?: string[] }
  return Array.isArray(cfg.dismissedCodegraphForCwds) ? cfg.dismissedCodegraphForCwds : []
}

evaluateCodegraphState(cwd: string): void {
  const initialized = codegraph.isInitialized(cwd)
  const dismissed = this.getDismissedCodegraphCwds().includes(cwd)
  this.window?.webContents.send('codegraph:project-state', { cwd, initialized, dismissed })
}

async runCodegraphInit(cwd: string): Promise<void> {
  const onLine = (line: string) => {
    this.window?.webContents.send('codegraph:init-progress', { cwd, line })
  }
  await codegraph.init(cwd, onLine)
  this.evaluateCodegraphState(cwd)
}

async runCodegraphReindex(cwd: string): Promise<void> {
  const onLine = (line: string) => {
    this.window?.webContents.send('codegraph:init-progress', { cwd, line })
  }
  await codegraph.forceReindex(cwd, onLine)
  this.evaluateCodegraphState(cwd)
}

dismissCodegraphForCwd(cwd: string): void {
  const cfg = loadAppConfig() as { dismissedCodegraphForCwds?: string[] }
  const list = Array.isArray(cfg.dismissedCodegraphForCwds) ? cfg.dismissedCodegraphForCwds : []
  if (!list.includes(cwd)) list.push(cwd)
  saveAppConfig({ ...cfg, dismissedCodegraphForCwds: list })
  this.evaluateCodegraphState(cwd)
}
```

> `loadAppConfig` / `saveAppConfig` 是 JDC 现有的 settings 读写 helper；如名字不一致，先 grep 找到再用对应 helper。

- [ ] **Step 4：在 IPC 注册文件中添加新 channel handlers**

```typescript
// packages/electron/src/ipc.ts (or wherever ipcMain.handle calls live)
ipcMain.handle('codegraph:init', async (_evt, cwd: string) => {
  return sessionManager.runCodegraphInit(cwd)
})
ipcMain.handle('codegraph:reindex', async (_evt, cwd: string) => {
  return sessionManager.runCodegraphReindex(cwd)
})
ipcMain.handle('codegraph:dismiss', async (_evt, cwd: string) => {
  sessionManager.dismissCodegraphForCwd(cwd)
})
ipcMain.handle('codegraph:state', async (_evt, cwd: string) => {
  sessionManager.evaluateCodegraphState(cwd)
})
```

- [ ] **Step 5：在 preload（如有）暴露 API**

```typescript
// packages/electron/src/preload.ts
contextBridge.exposeInMainWorld('codegraphApi', {
  init: (cwd: string) => ipcRenderer.invoke('codegraph:init', cwd),
  reindex: (cwd: string) => ipcRenderer.invoke('codegraph:reindex', cwd),
  dismiss: (cwd: string) => ipcRenderer.invoke('codegraph:dismiss', cwd),
  refreshState: (cwd: string) => ipcRenderer.invoke('codegraph:state', cwd),
  onState: (cb: (s: { cwd: string; initialized: boolean; dismissed: boolean }) => void) => {
    const handler = (_e: any, s: any) => cb(s)
    ipcRenderer.on('codegraph:project-state', handler)
    return () => ipcRenderer.removeListener('codegraph:project-state', handler)
  },
  onInitProgress: (cb: (e: { cwd: string; line: string }) => void) => {
    const handler = (_e: any, p: any) => cb(p)
    ipcRenderer.on('codegraph:init-progress', handler)
    return () => ipcRenderer.removeListener('codegraph:init-progress', handler)
  },
})
```

- [ ] **Step 6：构建检查**

Run: `pnpm build`
Expected: 0 errors。

- [ ] **Step 7：提交**

```bash
git add packages/electron/src/session-manager.ts packages/electron/src/ipc.ts packages/electron/src/preload.ts
git commit -m "feat(electron): IPC for codegraph state, init, reindex, dismiss"
```

---

## Task 12：UI — 顶部横条 + Settings 入口

**Files:**
- Create: `packages/ui/src/components/CodegraphBanner.tsx`
- Modify: 主布局组件（先 grep 找到顶部布局，类似 `MainLayout.tsx` 或 `App.tsx`）
- Modify: Settings → MCP 详情组件（先 grep 找到现有 MCP 列表组件）

- [ ] **Step 1：定位 UI 入口**

Run: `grep -rn "mcp:state-changed\|McpServers\|mcp-servers" packages/ui/src | head -20`
Run: `grep -rn "currentSession\|activeSession\|cwd" packages/ui/src/components | head -20`

记录主布局文件、MCP 设置组件的路径。

- [ ] **Step 2：写横条组件**

```tsx
// packages/ui/src/components/CodegraphBanner.tsx
import { useEffect, useState } from 'react'

declare global {
  interface Window {
    codegraphApi?: {
      init: (cwd: string) => Promise<void>
      reindex: (cwd: string) => Promise<void>
      dismiss: (cwd: string) => Promise<void>
      refreshState: (cwd: string) => Promise<void>
      onState: (cb: (s: { cwd: string; initialized: boolean; dismissed: boolean }) => void) => () => void
      onInitProgress: (cb: (e: { cwd: string; line: string }) => void) => () => void
    }
  }
}

interface Props { cwd: string }

type State =
  | { kind: 'idle'; initialized: boolean; dismissed: boolean }
  | { kind: 'indexing'; lastLine: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

export function CodegraphBanner({ cwd }: Props) {
  const api = window.codegraphApi
  const [state, setState] = useState<State>({ kind: 'idle', initialized: false, dismissed: false })

  useEffect(() => {
    if (!api) return
    const offState = api.onState(s => {
      if (s.cwd !== cwd) return
      setState({ kind: 'idle', initialized: s.initialized, dismissed: s.dismissed })
    })
    api.refreshState(cwd)
    const offProgress = api.onInitProgress(e => {
      if (e.cwd !== cwd) return
      setState(prev => prev.kind === 'indexing'
        ? { kind: 'indexing', lastLine: e.line }
        : prev)
    })
    return () => { offState(); offProgress() }
  }, [api, cwd])

  if (!api) return null
  if (state.kind === 'idle' && (state.initialized || state.dismissed)) return null

  const start = async () => {
    setState({ kind: 'indexing', lastLine: '' })
    try {
      await api.init(cwd)
      setState({ kind: 'done' })
      setTimeout(() => api.refreshState(cwd), 5000)
    } catch (e: any) {
      setState({ kind: 'error', message: e?.message ?? String(e) })
    }
  }

  const dismiss = async () => {
    await api.dismiss(cwd)
  }

  if (state.kind === 'indexing') {
    return (
      <div className="bg-blue-50 dark:bg-blue-900/30 border-b border-blue-200 dark:border-blue-800 px-4 py-2 text-sm flex items-center gap-3">
        <span className="font-medium">正在为本项目建立代码索引…</span>
        <span className="text-xs opacity-70 truncate">{state.lastLine}</span>
      </div>
    )
  }
  if (state.kind === 'done') {
    return (
      <div className="bg-green-50 dark:bg-green-900/30 border-b border-green-200 dark:border-green-800 px-4 py-2 text-sm">
        代码索引已建立 — AI 探索性问题将更快。
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className="bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 px-4 py-2 text-sm flex items-center gap-3">
        <span>建立索引失败：{state.message}</span>
        <button className="text-xs underline" onClick={start}>重试</button>
        <button className="text-xs underline opacity-70" onClick={dismiss}>不再提示</button>
      </div>
    )
  }

  return (
    <div className="bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-sm flex items-center justify-between">
      <span>建议为本项目建立代码索引（CodeGraph），让 AI 探索代码更快、更省 token。</span>
      <div className="flex items-center gap-2">
        <button className="px-2 py-1 text-xs rounded bg-amber-600 text-white" onClick={start}>开始</button>
        <button className="px-2 py-1 text-xs underline opacity-70" onClick={dismiss}>不再提示</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3：在主布局组件中挂载横条**

定位主布局文件（Step 1 找到的），在「session 视图顶部、工具栏之下/之上的合理位置」添加：

```tsx
{currentSession && <CodegraphBanner cwd={currentSession.cwd} />}
```

> 具体属性名 `currentSession.cwd` 需按现有 store 结构调整。

- [ ] **Step 4：在 Settings → MCP 详情中暴露「重建索引」按钮**

定位 MCP 详情组件（Step 1 找到的）。当当前选中的 MCP 服务名是 `codegraph` 时，额外渲染一个「为当前项目重建索引」按钮，调用 `window.codegraphApi.reindex(currentSession.cwd)`。点击期间禁用按钮、显示 spinner。

如现有组件层结构复杂，**最小改动**为：在 MCP 详情容器底部加一个块：

```tsx
{server.name === 'codegraph' && currentSession && (
  <div className="mt-3 border-t pt-3">
    <button
      className="px-3 py-1 text-sm rounded border"
      disabled={reindexing}
      onClick={async () => {
        setReindexing(true)
        try { await window.codegraphApi?.reindex(currentSession.cwd) }
        finally { setReindexing(false) }
      }}
    >{reindexing ? '正在重建…' : '重建当前项目索引'}</button>
  </div>
)}
```

`reindexing` 是该组件内 `useState(false)`。

- [ ] **Step 5：dev 跑通**

Run: `pnpm dev`
Expected: 打开未初始化的项目 → 顶部横条出现；点开始 → 横条变成「正在为本项目建立代码索引」+ 末行进度；完成后 5 秒消失。切换到已初始化项目 → 横条不出现。

- [ ] **Step 6：提交**

```bash
git add packages/ui/src/components/CodegraphBanner.tsx packages/ui/src/<modified-files>
git commit -m "feat(ui): codegraph banner and settings reindex action"
```

---

## Task 13：electron-builder.yml —— extraResources

**Files:**
- Modify: `electron-builder.yml`

- [ ] **Step 1：在 `electron-builder.yml` 末尾追加（或合并到现有 extraResources 块）**

```yaml
extraResources:
  - from: packages/electron/resources/codegraph
    to: codegraph
    filter:
      - "**/*"
```

如已有 `extraResources` 段，把新条目合并进数组。

- [ ] **Step 2：本地试打**

Run: `pnpm package`
Expected: 出 dmg / zip 在 `out/`。打开 dmg 装应用 → 应用包内 `Contents/Resources/codegraph/<host>/bin/codegraph` 存在。

> 若本地不愿走完整 codesign，可临时把 `mac.notarize: false` 保持，或把 `CSC_LINK` 留空让 electron-builder 跳过 sign（不影响验证 extraResources）。

- [ ] **Step 3：从 packaged 应用启动**

打开装好的 JDC → Settings → MCP → 应该看到 `codegraph` 状态 `connected`。

- [ ] **Step 4：提交**

```bash
git add electron-builder.yml
git commit -m "build: pack codegraph binaries into extraResources"
```

---

## Task 14：CI release.yml —— 拉取并打入 binary

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1：在 `release-mac` job 的 `pnpm build` 与 `Package` 步骤之间插入**

```yaml
      - name: Fetch CodeGraph binaries
        run: pnpm fetch-codegraph --platforms=darwin-arm64,darwin-x64
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        timeout-minutes: 5
```

- [ ] **Step 2：在 `release-windows` job 同样位置插入**

```yaml
      - name: Fetch CodeGraph binaries
        run: pnpm fetch-codegraph --platforms=win32-x64,win32-arm64
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        timeout-minutes: 5
```

- [ ] **Step 3：本地干跑（dry-run）验证 yaml 合法**

Run: `pnpm dlx js-yaml .github/workflows/release.yml > /dev/null`
Expected: 无报错。

- [ ] **Step 4：提交**

```bash
git add .github/workflows/release.yml
git commit -m "ci: fetch codegraph binaries before packaging on release runners"
```

---

## Task 15：dev 模式自动 fetch（可选但推荐）

**Files:**
- Modify: `package.json`

- [ ] **Step 1：在 `package.json` 的 `scripts` 中改写 `dev`**

旧：
```json
"dev": "tsx scripts/dev.ts"
```

新：
```json
"predev": "node -e \"if(!require('fs').existsSync('packages/electron/resources/codegraph/VERSION')){require('child_process').execSync('pnpm fetch-codegraph',{stdio:'inherit'})}\"",
"dev": "tsx scripts/dev.ts"
```

> 仅当 `resources/codegraph/VERSION` 不存在时才下载，避免每次 dev 都拉。

- [ ] **Step 2：测试**

Run: `rm -rf packages/electron/resources/codegraph && pnpm dev`
Expected: 先看到 `[fetch-codegraph]` 输出，下载完后启动 dev。

```bash
# 第二次启动应跳过下载
pnpm dev
# Expected: 直接启动，无 fetch-codegraph 输出
```

- [ ] **Step 3：提交**

```bash
git add package.json
git commit -m "chore: auto-fetch codegraph in dev when missing"
```

---

## Task 16：端到端验收

**Files:** 无代码改动。在 PR 描述里贴出本节核对结果。

- [ ] **Step 1：清干净环境**

```bash
rm -rf packages/electron/resources/codegraph
rm -rf out
```

- [ ] **Step 2：完整跑一遍打包**

Run: `pnpm fetch-codegraph && pnpm package`
Expected: `out/JDC-Code-*.dmg`（或当前平台对应产物）生成。

- [ ] **Step 3：按以下 10 项手工验收**

依次对照 spec 第 12 节列表勾对：

1. 全新装 JDC → Settings → MCP → 看到 codegraph 服务为 `connected`
2. 打开未初始化项目 → 顶部横条出现 → 点开始 → 进度可见 → 完成横条变绿 5 秒消失
3. 打开已初始化项目 → 不弹横条
4. 切换两个不同项目 A/B → 横条按各自 `.codegraph/` 状态正确显示/隐藏
5. 切到项目 A 提问「session.ts 是怎么工作的」→ 模型调 `mcp__codegraph__codegraph_context` 且 `projectPath` 等于 A 的绝对路径
6. 派 explore 子代理 → 子代理可调 codegraph 工具
7. Team 模式派 worker → worker 可调 codegraph 工具
8. Settings → MCP 把 codegraph 服务禁用 → 重启 → 服务不再启动
9. 删 `.codegraph/` 后再提问 → 模型回退到 grep/Read，无致命错
10. 「不再提示」点击 → 同项目不弹横条；切到别的未初始化项目仍弹

- [ ] **Step 4：把 10 项结果写入 PR 描述**

`✅` 通过 / `⚠️ 描述问题` 不通过。如全部通过则准备合并。

- [ ] **Step 5：合并前最后一次 typecheck + 全套单元测试**

```bash
pnpm build
pnpm test
```

Expected: 0 errors，所有测试通过。

---

## Self-Review

**1. Spec 覆盖：**
- 架构总览 → Task 1（CI fetch）+ Task 2-6（codegraph 模块）+ Task 7-11（集成点）+ Task 12（UI）+ Task 13-14（打包与 CI）✓
- 文件改动清单 → Task 1-15 全部覆盖 ✓
- 核心接口 binary/mcp-default/project/prompt → Task 2-5 ✓
- agent-types allowedMcpServers → Task 7 ✓
- MCP 工具拦截器 projectPath 注入 → Task 9 ✓
- 启动数据流 / 项目打开数据流 / 会话内提问数据流 → Task 8 + 11 + 10 ✓
- CI 改动 → Task 14 ✓
- electron-builder extraResources → Task 13 ✓
- dev 模式回退 → Task 15 ✓
- 错误处理（init 失败、binary 缺失、cancel）→ Task 5（cancel）+ Task 12（error UI）+ Task 2（resolve null）✓
- 测试 → Task 2-7、9 全有单元测试；Task 16 手工验收 ✓
- 回滚（用户禁用、补丁版禁用、目录删除）→ Task 8（disabled config）+ 模块集中保证目录级 revert ✓

**2. Placeholder 扫描：** 通读 16 个 task，没有 TBD / TODO / 「类似 Task N」/ 缺代码的步骤。Task 10 第 2 步标注「现存代码可能多处构造 systemPrompt，全部都要追加」是真实的实施提示，不是 placeholder。Task 11 在 Step 4 中提到 IPC 注册文件位置由 grep 决定，这是基于实际仓库结构的发现性步骤，不是 placeholder。

**3. 类型一致性：** `CODEGRAPH_SERVER_NAME`（Task 3 定义、Task 8 使用）名字一致；`getDefaultCodegraphMcpConfig`（Task 3 定义、Task 8 引用）签名一致；`isInitialized` / `init` / `forceReindex`（Task 5 定义、Task 11 调用）一致；`AgentTypeDefinition.allowedMcpServers`（Task 7 定义并消费）一致；`mcp__codegraph__` 前缀（Task 7、9、prompt 引导）一致。✓

无遗漏。
