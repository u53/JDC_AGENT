# 图像生成工具（GenerateImage / EditImage）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 JDC CODE 新增 `GenerateImage`（文生图）与 `EditImage`（图生图/编辑）两个内置工具，由独立的 `imageModel` 配置开关控制是否注册，后台异步生成、图片落盘到项目目录、聊天里可无损复制。

**Architecture:** 独立配置段 `config.imageModel` 决定工具是否注册（决策 A）。OpenAI 兼容 images API 客户端从参考项目 `/Users/chenmingxu/Documents/gpt_image` 移植。工具向 `BackgroundTaskManager`（新增 `image` 任务类型）注册任务后立即返回 task_id，后台跑完落盘并发两类信号：纯文本 `<task-notification>` 给模型（模型靠路径引用图，不把图字节进上下文）+ `image:generated` IPC 事件给 UI 渲染图片卡。用户参考图也落盘到 `.jdc-image-input/`，三种图片来源统一用路径引用（决策 A1）。

**Tech Stack:** TypeScript (ESM, `.js` 扩展名 import), Node `node:https`/`node:fs`, Vitest, Electron IPC, React + Zustand, Tailwind。

**参考项目参数权威来源**（实现时必须照此为准）：
- `gpt_image/src/images/image-api-client.ts` — API 客户端 + 响应抽取逻辑
- `gpt_image/src/images/image-presets.ts` — 尺寸预设全表 / quality / format / 默认模型
- `gpt_image/src/images/points-cost.ts` — `resolveOutputSize` 尺寸校验（16 倍数、比例 ≤3:1）
- `gpt_image/src/images/images.service.ts` — payload 组装、edits 约束、落盘、并发

---

## 完整参数参考（来自参考项目，工具描述与校验必须完整覆盖）

### 尺寸预设（SIZE_PRESETS，13 个 + auto + custom）

| label | value | 说明 |
|---|---|---|
| 1K 方图 1:1 | `1024x1024` | |
| 2K 方图 1:1 | `2048x2048` | |
| 1K 横图 16:9 | `1792x1008` | |
| 2K 横图 16:9 | `2048x1152` | |
| 2.5K 横图 16:9 | `2560x1440` | |
| 3K 横图 16:9 | `3072x1728` | |
| 4K 横图 16:9 | `3840x2160` | 用户说"4K横屏"→这个 |
| 1K 竖图 9:16 | `1008x1792` | |
| 2K 竖图 9:16 | `1152x2048` | |
| 4K 竖图 9:16 | `2160x3840` | 用户说"4K竖屏"→这个 |
| 1K 横图 3:2 | `1536x1024` | |
| 1K 竖图 2:3 | `1024x1536` | |
| auto | `auto` | 模型自动选；payload 不传 size |
| 自定义 | 任意 `宽x高` | 走 resolveOutputSize 校验 |

### 自定义尺寸校验规则（resolveOutputSize）

- 格式必须匹配 `/^(\d+)x(\d+)$/i`，否则报错"尺寸格式必须是 宽x高，例如 1024x1024"
- 宽高必须 > 0，否则"宽高必须大于 0"
- 宽高必须都是 16 的倍数（`% 16 !== 0` 报错"宽高必须是 16 的倍数"）
- `max/min` 比例不能超过 3:1，否则"宽高比例不能超过 3:1"
- `auto` 或空 → 不校验，payload 不传 size

### 其它参数

| 参数 | 合法值 | 默认 | payload 规则 |
|---|---|---|---|
| quality | `auto`/`low`/`medium`/`high`（QUALITY_OPTIONS） | `auto` | 始终写入 payload.quality |
| output_format | `png`/`jpeg`/`webp`（FORMAT_OPTIONS） | `png` | 始终写入 payload.output_format |
| compression | 整数 0-100（clampInteger） | 100 | **仅** output_format 为 jpeg/webp 时写入 payload.output_compression |
| background | `transparent`/`opaque`/`auto` | `transparent` | 非空写入 payload.background；transparent 须配 png/webp |
| model | 配置里的 model | 配置值 | 始终写入 payload.model |

### edits（图生图）约束

- 有输入图 → endpoint = `edits`；无 → `generations`
- 最多 4 张输入图（>4 报错）
- 单张 < 4MB（参考项目 Python：`4 * 1024 * 1024`）
- 每张读成 data url：`data:<mime>;base64,<b64>`，mime 由扩展名推断（png/jpg/jpeg/webp）
- payload.images = `[{ image_url: dataUrl }, ...]`

### 端点与请求

- URL：`${baseUrl.replace(/\/$/,'')}/v1/images/${endpoint}`
- POST，header：`Content-Type: application/json` + `Authorization: Bearer <key>`
- 超时 600000ms（600s）
- 非 2xx → 抛 `HTTP <code>: <body前200字符>`

### 响应抽取（extractImageApiResult 递归顺序）

1. 字符串：先试 base64（含 `data:...base64,` 前缀剥离 + 严格 base64 校验），再试 http(s) url
2. 数组：逐项递归
3. 对象：依次查 key `b64_json`/`b64`/`base64`/`image_base64` → `data`/`result`/`images`/`output`（递归）→ `url`/`image_url`（preferUrl）→ 兜底遍历所有 value
4. remote_url 结果 → 下载转 base64（30s 超时），失败则保留 url + downloadError

### 落盘文件名

- 本地图：`img_<timestamp>_<idx>.<ext>`，timestamp = `YYYYMMDD_HHmmss_SSS`
- 目录不存在先 mkdir recursive

---

## File Structure

新增（core）：
- `packages/core/src/images/image-api-client.ts` — OpenAI 兼容 images 客户端（移植）
- `packages/core/src/images/image-config.ts` — `imageModel` 配置读取 + 校验
- `packages/core/src/images/image-presets.ts` — 尺寸预设、quality/format 选项、尺寸校验（移植 presets + points-cost 的 resolveOutputSize）
- `packages/core/src/tools/image-tools.ts` — `createImageTools(deps)` → GenerateImage + EditImage
- `packages/core/src/images/image-api-client.test.ts`
- `packages/core/src/images/image-presets.test.ts`
- `packages/core/src/tools/image-tools.test.ts`

新增（ui）：
- `packages/ui/src/stores/image-store.ts` — 收集 `image:generated` 事件
- `packages/ui/src/components/GeneratedImageCard.tsx` — 图片卡

改写（core）：
- `packages/core/src/background-tasks.ts` — `TaskType` 加 `image`；`registerImage`/`completeImage`/`failImage`；`BackgroundTask.images` 字段
- `packages/core/src/session.ts` — 条件注册 image 工具；`pendingNotifications` 联合类型 + image_complete 分支；`drainNotifications` image_complete 渲染；`onImageGenerated?` 回调
- `packages/core/src/index.ts` — 导出新公共 API

改写（electron）：
- `packages/electron/src/session-manager.ts` — 转发 `image:generated`；`sendMessage` 参考图落盘到 `.jdc-image-input/`
- `packages/electron/src/ipc-handlers.ts` — `images:copyToClipboard` / `images:showInFolder` 处理
- `packages/electron/src/preload.ts` — 暴露 `copyImageFile` / `showImageInFolder` / `onImageGenerated`

改写（ui）：
- `packages/ui/src/lib/ipc-client.ts` — 新 IPC 方法类型
- `packages/ui/src/lib/clipboard.ts` — `copyImageFile(path)`
- `packages/ui/src/components/SettingsOverlay.tsx` — 新增「图像」Tab（ImageModelTab）
- `packages/ui/src/stores/settings-store.ts` — `SettingsTab` 加 `'image'`
- `packages/ui/src/components/ConversationTurn.tsx` — 挂载 GeneratedImageCard

---

## Task 1: 移植尺寸预设与校验（image-presets.ts）

**Files:**
- Create: `packages/core/src/images/image-presets.ts`
- Test: `packages/core/src/images/image-presets.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/core/src/images/image-presets.test.ts
import { describe, it, expect } from 'vitest'
import { resolveOutputSize, QUALITY_OPTIONS, FORMAT_OPTIONS, SIZE_PRESETS } from './image-presets.js'

describe('resolveOutputSize', () => {
  it('auto / 空返回 null', () => {
    expect(resolveOutputSize('auto')).toEqual({ width: null, height: null })
    expect(resolveOutputSize('')).toEqual({ width: null, height: null })
  })
  it('合法尺寸返回宽高', () => {
    expect(resolveOutputSize('3840x2160')).toEqual({ width: 3840, height: 2160 })
  })
  it('格式非法报错', () => {
    expect(() => resolveOutputSize('1024*1024')).toThrow('尺寸格式必须是 宽x高')
  })
  it('非 16 倍数报错', () => {
    expect(() => resolveOutputSize('1000x1000')).toThrow('16 的倍数')
  })
  it('比例超过 3:1 报错', () => {
    expect(() => resolveOutputSize('4096x1024')).toThrow('3:1')
  })
})

describe('presets 常量', () => {
  it('包含 4K 横竖图', () => {
    const values = SIZE_PRESETS.map((p) => p.value)
    expect(values).toContain('3840x2160')
    expect(values).toContain('2160x3840')
  })
  it('quality/format 选项完整', () => {
    expect(QUALITY_OPTIONS).toEqual(['auto', 'low', 'medium', 'high'])
    expect(FORMAT_OPTIONS).toEqual(['png', 'jpeg', 'webp'])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && npx vitest run src/images/image-presets.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// packages/core/src/images/image-presets.ts
export interface SizePreset { label: string; value: string }

export const SIZE_PRESETS: SizePreset[] = [
  { label: '1K 方图 1:1 1024x1024', value: '1024x1024' },
  { label: '2K 方图 1:1 2048x2048', value: '2048x2048' },
  { label: '1K 横图 16:9 1792x1008', value: '1792x1008' },
  { label: '2K 横图 16:9 2048x1152', value: '2048x1152' },
  { label: '2.5K 横图 16:9 2560x1440', value: '2560x1440' },
  { label: '3K 横图 16:9 3072x1728', value: '3072x1728' },
  { label: '4K 横图 16:9 3840x2160', value: '3840x2160' },
  { label: '1K 竖图 9:16 1008x1792', value: '1008x1792' },
  { label: '2K 竖图 9:16 1152x2048', value: '1152x2048' },
  { label: '4K 竖图 9:16 2160x3840', value: '2160x3840' },
  { label: '1K 横图 3:2 1536x1024', value: '1536x1024' },
  { label: '1K 竖图 2:3 1024x1536', value: '1024x1536' },
  { label: 'auto 模型自动选择', value: 'auto' },
]

export const QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high'] as const
export const FORMAT_OPTIONS = ['png', 'jpeg', 'webp'] as const
export const BACKGROUND_OPTIONS = ['transparent', 'opaque', 'auto'] as const

const MAX_RATIO = 3

export interface ResolvedOutputSize { width: number | null; height: number | null }

export function resolveOutputSize(size: string): ResolvedOutputSize {
  const raw = size?.trim()
  if (!raw || raw === 'auto') return { width: null, height: null }
  const match = raw.match(/^(\d+)x(\d+)$/i)
  if (!match) throw new Error('尺寸格式必须是 宽x高，例如 1024x1024')
  const width = Number(match[1])
  const height = Number(match[2])
  if (width <= 0 || height <= 0) throw new Error('宽高必须大于 0')
  if (width % 16 !== 0 || height % 16 !== 0) throw new Error('宽高必须是 16 的倍数')
  const ratio = Math.max(width, height) / Math.min(width, height)
  if (ratio > MAX_RATIO) throw new Error('宽高比例不能超过 3:1')
  return { width, height }
}

export function clampCompression(value: number): number {
  const integer = Math.floor(Number(value))
  if (!Number.isFinite(integer)) return 100
  return Math.min(100, Math.max(0, integer))
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/core && npx vitest run src/images/image-presets.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/images/image-presets.ts packages/core/src/images/image-presets.test.ts
git commit -m "feat(images): add size presets and size validation"
```

---

## Task 2: 移植 API 客户端（image-api-client.ts）

**Files:**
- Create: `packages/core/src/images/image-api-client.ts`
- Test: `packages/core/src/images/image-api-client.test.ts`

- [ ] **Step 1: 写失败测试**（覆盖 buildRequest 的 endpoint/payload 规则 + 响应抽取）

```ts
// packages/core/src/images/image-api-client.test.ts
import { describe, it, expect } from 'vitest'
import { ImageApiClient, extractImageApiResult, resolveImageApiResult } from './image-api-client.js'

const client = new ImageApiClient('https://api.example.com/', 'key')

describe('buildRequest', () => {
  it('无图走 generations，auto 不传 size', () => {
    const r = client.buildRequest({ prompt: 'cat', size: 'auto', quality: 'auto', model: 'gpt-image-2', outputFormat: 'png', compression: 100 })
    expect(r.url).toBe('https://api.example.com/v1/images/generations')
    expect(r.payload.size).toBeUndefined()
    expect(r.payload).toMatchObject({ model: 'gpt-image-2', prompt: 'cat', quality: 'auto', output_format: 'png' })
  })
  it('有图走 edits，带 images', () => {
    const r = client.buildRequest({ prompt: 'x', size: '1024x1024', quality: 'high', model: 'm', outputFormat: 'png', compression: 100, imageDataUrls: ['data:image/png;base64,AAAA'] })
    expect(r.url).toBe('https://api.example.com/v1/images/edits')
    expect(r.payload.images).toEqual([{ image_url: 'data:image/png;base64,AAAA' }])
    expect(r.payload.size).toBe('1024x1024')
  })
  it('jpeg 才传 output_compression', () => {
    const png = client.buildRequest({ prompt: 'x', size: 'auto', quality: 'auto', model: 'm', outputFormat: 'png', compression: 80 })
    expect(png.payload.output_compression).toBeUndefined()
    const jpeg = client.buildRequest({ prompt: 'x', size: 'auto', quality: 'auto', model: 'm', outputFormat: 'jpeg', compression: 80 })
    expect(jpeg.payload.output_compression).toBe(80)
  })
  it('background 非空写入', () => {
    const r = client.buildRequest({ prompt: 'x', size: 'auto', quality: 'auto', model: 'm', outputFormat: 'png', compression: 100, background: 'transparent' })
    expect(r.payload.background).toBe('transparent')
  })
})

describe('extractImageApiResult', () => {
  it('抽取 b64_json', () => {
    expect(extractImageApiResult({ data: [{ b64_json: 'QUJDRA==' }] })).toEqual({ type: 'base64', base64: 'QUJDRA==' })
  })
  it('抽取 url', () => {
    expect(extractImageApiResult({ data: [{ url: 'https://x/y.png' }] })).toEqual({ type: 'remote_url', url: 'https://x/y.png' })
  })
  it('无图返回 null', () => {
    expect(extractImageApiResult({ foo: 'bar' })).toBeNull()
  })
})

describe('resolveImageApiResult', () => {
  it('remote_url 下载成功转 base64', async () => {
    const out = await resolveImageApiResult({ url: 'https://x/y.png' }, async () => Buffer.from('hello'))
    expect(out).toEqual({ type: 'base64', base64: Buffer.from('hello').toString('base64') })
  })
  it('下载失败保留 url + downloadError', async () => {
    const out = await resolveImageApiResult({ url: 'https://x/y.png' }, async () => { throw new Error('boom') })
    expect(out).toMatchObject({ type: 'remote_url', url: 'https://x/y.png' })
    expect((out as any).downloadError).toContain('boom')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && npx vitest run src/images/image-api-client.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**（从 `/Users/chenmingxu/Documents/gpt_image/src/images/image-api-client.ts` 移植，保持逻辑一致；下面是关键骨架，完整内容照参考项目搬运）

照搬参考文件全部内容到 `packages/core/src/images/image-api-client.ts`，**唯一改动**：`BuildImageRequestInput` 增加 `background?: 'transparent' | 'opaque' | 'auto'`，并在 `buildRequest` 里：

```ts
// 在 payload 组装中追加（紧跟 output_format 之后）：
if (input.background) {
  payload.background = input.background
}
```

其余（`postJson` 600s 超时、`extractImageApiResult` 递归、`resolveImageApiResult` 下载降级、`describeImageApiError`、`normalizeBase64Value`、`isHttpUrl`、`downloadBinary`）原样移植。注意：import 用 `node:https`/`node:http`/`node:url`，ESM 写法与参考一致。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/core && npx vitest run src/images/image-api-client.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/images/image-api-client.ts packages/core/src/images/image-api-client.test.ts
git commit -m "feat(images): port OpenAI-compatible image API client with background param"
```

---

## Task 3: 图像模型配置读取（image-config.ts）

**Files:**
- Create: `packages/core/src/images/image-config.ts`
- Test: 并入 `packages/core/src/tools/image-tools.test.ts`（Task 6），此处无独立测试

- [ ] **Step 1: 实现**

```ts
// packages/core/src/images/image-config.ts
import { loadAppConfig } from '../config.js'

export interface ImageModelConfig {
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
}

export function loadImageModelConfig(): ImageModelConfig | null {
  const raw = (loadAppConfig().imageModel ?? null) as Partial<ImageModelConfig> | null
  if (!raw) return null
  const enabled = raw.enabled === true
  const baseUrl = (raw.baseUrl ?? '').trim()
  const apiKey = (raw.apiKey ?? '').trim()
  const model = (raw.model ?? '').trim()
  if (!enabled || !baseUrl || !apiKey || !model) return null
  return { enabled, baseUrl, apiKey, model }
}

export function isImageModelConfigured(): boolean {
  return loadImageModelConfig() !== null
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/core/src/images/image-config.ts
git commit -m "feat(images): add imageModel config reader"
```

---

## Task 4: BackgroundTaskManager 支持 image 任务

**Files:**
- Modify: `packages/core/src/background-tasks.ts`
- Test: `packages/core/src/background-tasks.image.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

```ts
// packages/core/src/background-tasks.image.test.ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BackgroundTaskManager } from './background-tasks.js'

describe('image background task', () => {
  it('registerImage + completeImage 触发 onComplete 带 images', () => {
    const mgr = new BackgroundTaskManager(mkdtempSync(join(tmpdir(), 'bgimg-')))
    let done: any = null
    mgr.setOnComplete((t) => { done = t })
    const task = mgr.registerImage('cat')
    expect(task.type).toBe('image')
    expect(task.status).toBe('running')
    mgr.completeImage(task.id, { images: [{ path: '/x/a.png', bytes: 10, format: 'png', background: 'transparent', transparent: true }] })
    expect(done.status).toBe('completed')
    expect(done.images?.[0]?.path).toBe('/x/a.png')
  })
  it('failImage 标记 failed', () => {
    const mgr = new BackgroundTaskManager(mkdtempSync(join(tmpdir(), 'bgimg-')))
    let done: any = null
    mgr.setOnComplete((t) => { done = t })
    const task = mgr.registerImage('cat')
    mgr.failImage(task.id, 'boom')
    expect(done.status).toBe('failed')
    expect(done.result).toBe('boom')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd packages/core && npx vitest run src/background-tasks.image.test.ts`
Expected: FAIL（registerImage 不存在）

- [ ] **Step 3: 实现** — 修改 `packages/core/src/background-tasks.ts`

3a. `TaskType` 加 `image`：

```ts
export type TaskType = 'shell' | 'agent' | 'team' | 'image'
```

3b. `ImageOutput` 接口 + `BackgroundTask` 增加字段（在 `toolsUsed?: string[]` 之后）：

```ts
export interface ImageOutput {
  path: string
  width?: number
  height?: number
  bytes: number
  format: string
  background: string
  transparent: boolean
  downloadError?: string
}
```

在 `BackgroundTask` 接口里追加：

```ts
  images?: ImageOutput[]
  prompt?: string  // 已存在，复用为生成 prompt
```

3c. 新增三个方法（放在 `failAgent` 之后，`registerTeam` 之前）：

```ts
  registerImage(prompt: string): BackgroundTask {
    const id = uuid().slice(0, 8)
    const logFile = path.join(this.logDir, `${id}.log`)
    writeFileSync(logFile, '')
    const task: BackgroundTask = {
      id, type: 'image', prompt, pid: 0, status: 'running', logFile, startedAt: Date.now(),
    }
    this.tasks.set(id, task)
    return task
  }

  completeImage(id: string, opts: { images: ImageOutput[] }): void {
    const task = this.tasks.get(id)
    if (!task || task.type !== 'image') return
    task.status = 'completed'
    task.completedAt = Date.now()
    task.images = opts.images
    this.onComplete?.(task)
  }

  failImage(id: string, error: string): void {
    const task = this.tasks.get(id)
    if (!task || task.type !== 'image') return
    task.status = 'failed'
    task.completedAt = Date.now()
    task.result = error
    this.onComplete?.(task)
  }
```

> 注意：image 任务**不**走 `acquireAgentSlot`（满足"不限制一次几个任务"）。

- [ ] **Step 4: 运行确认通过**

Run: `cd packages/core && npx vitest run src/background-tasks.image.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/background-tasks.ts packages/core/src/background-tasks.image.test.ts
git commit -m "feat(images): add image task type to BackgroundTaskManager"
```

---

## Task 5: GenerateImage + EditImage 工具（image-tools.ts）

**Files:**
- Create: `packages/core/src/tools/image-tools.ts`
- Test: `packages/core/src/tools/image-tools.test.ts`（Task 6）

工具职责：校验配置/参数 → `backgroundTasks.registerImage(prompt)` → **立即返回** task_id → 后台 worker 调 API、落盘、`completeImage`/`failImage`。后台执行通过 `deps.runImageJob` 注入（便于测试），默认实现用真实 ImageApiClient。

- [ ] **Step 1: 实现 deps 与共享逻辑**

```ts
// packages/core/src/tools/image-tools.ts
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises'
import { join, isAbsolute, extname } from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import type { BackgroundTaskManager, ImageOutput } from '../background-tasks.js'
import type { ImageModelConfig } from '../images/image-config.js'
import { ImageApiClient, type OutputFormat } from '../images/image-api-client.js'
import { resolveOutputSize, clampCompression, QUALITY_OPTIONS, FORMAT_OPTIONS, BACKGROUND_OPTIONS } from '../images/image-presets.js'

const MAX_INPUT_IMAGES = 4
const MAX_INPUT_BYTES = 4 * 1024 * 1024
const PER_JOB_CONCURRENCY = 3

export interface ImageToolDeps {
  getImageConfig: () => ImageModelConfig | null
  backgroundTasks: BackgroundTaskManager
  onImageGenerated?: (taskId: string, images: ImageOutput[]) => void
  /** 注入点，测试可替换 */
  runImageJob?: (params: RunImageJobParams) => Promise<void>
}

interface RunImageJobParams {
  taskId: string
  cfg: ImageModelConfig
  prompt: string
  size: string
  quality: string
  format: OutputFormat
  compression: number
  background: 'transparent' | 'opaque' | 'auto'
  count: number
  outputDir: string
  imageDataUrls: string[]
  backgroundTasks: BackgroundTaskManager
  onImageGenerated?: (taskId: string, images: ImageOutput[]) => void
}

function timestamp(): string {
  const now = new Date()
  const pad = (v: number, n = 2) => String(v).padStart(n, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}_${pad(now.getMilliseconds(), 3)}`
}

function mimeFromExt(p: string): string {
  const ext = extname(p).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

function resolveDir(cwd: string, outputPath?: string): string {
  if (!outputPath || !outputPath.trim()) return cwd
  const p = outputPath.trim()
  return isAbsolute(p) ? p : join(cwd, p)
}
```

- [ ] **Step 2: 实现默认 runImageJob（真实后台执行）**

```ts
async function defaultRunImageJob(params: RunImageJobParams): Promise<void> {
  const { taskId, cfg, prompt, size, quality, format, compression, background, count, outputDir, imageDataUrls, backgroundTasks, onImageGenerated } = params
  try {
    const client = new ImageApiClient(cfg.baseUrl, cfg.apiKey)
    await mkdir(outputDir, { recursive: true })
    const outputs: ImageOutput[] = []
    const transparent = background === 'transparent'

    const tasks = Array.from({ length: count }, (_, index) => async () => {
      const result = await client.generate({
        prompt,
        size,
        quality,
        model: cfg.model,
        outputFormat: format,
        compression,
        background,
        imageDataUrls: imageDataUrls.length ? imageDataUrls : undefined,
      })
      if (!result) return
      if (result.type === 'remote_url') {
        outputs.push({ path: result.url, bytes: 0, format, background, transparent, downloadError: result.downloadError })
        return
      }
      const raw = Buffer.from(result.base64, 'base64')
      const filename = `img_${timestamp()}_${index + 1}.${format}`
      const full = join(outputDir, filename)
      await writeFile(full, raw)
      outputs.push({ path: full, bytes: raw.byteLength, format, background, transparent })
    })

    await runLimited(tasks, PER_JOB_CONCURRENCY)

    if (outputs.length === 0) {
      backgroundTasks.failImage(taskId, '生成失败：无图片数据')
      return
    }
    backgroundTasks.completeImage(taskId, { images: outputs })
    onImageGenerated?.(taskId, outputs)
  } catch (error) {
    backgroundTasks.failImage(taskId, error instanceof Error ? error.message : String(error))
  }
}

async function runLimited(tasks: Array<() => Promise<void>>, concurrency: number): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const current = cursor
      cursor += 1
      try { await tasks[current]() } catch { /* 单张失败不影响其它张 */ }
    }
  })
  await Promise.all(workers)
}
```

- [ ] **Step 3: 实现参数归一化 + 输入图读取 + 工具工厂**

```ts
interface NormalizedParams {
  prompt: string
  size: string
  quality: string
  format: OutputFormat
  compression: number
  background: 'transparent' | 'opaque' | 'auto'
  count: number
  outputDir: string
  formatAdjusted: boolean
}

function normalizeParams(input: Record<string, unknown>, cwd: string): NormalizedParams {
  const prompt = String(input.prompt ?? '').trim()
  if (!prompt) throw new Error('prompt 不能为空')

  const size = String(input.size ?? 'auto').trim() || 'auto'
  resolveOutputSize(size) // 抛错即非法尺寸

  const quality = QUALITY_OPTIONS.includes(input.quality as any) ? String(input.quality) : 'auto'
  let format: OutputFormat = (FORMAT_OPTIONS.includes(input.format as any) ? input.format : 'png') as OutputFormat
  const background = (BACKGROUND_OPTIONS.includes(input.background as any) ? input.background : 'transparent') as 'transparent' | 'opaque' | 'auto'

  // 透明背景强约束：jpeg 无透明通道 → 强制 png
  let formatAdjusted = false
  if (background === 'transparent' && format === 'jpeg') {
    format = 'png'
    formatAdjusted = true
  }

  const compression = clampCompression(typeof input.compression === 'number' ? input.compression : 100)
  const count = Math.min(10, Math.max(1, Math.floor(Number(input.count ?? 1)) || 1))
  const outputDir = resolveDir(cwd, input.output_path as string | undefined)
  return { prompt, size, quality, format, compression, background, count, outputDir, formatAdjusted }
}

async function readInputImages(images: unknown, cwd: string): Promise<string[]> {
  if (!Array.isArray(images) || images.length === 0) return []
  if (images.length > MAX_INPUT_IMAGES) throw new Error(`最多 ${MAX_INPUT_IMAGES} 张输入图片`)
  const urls: string[] = []
  for (const item of images) {
    const p = String(item)
    const full = isAbsolute(p) ? p : join(cwd, p)
    const info = await stat(full).catch(() => null)
    if (!info) throw new Error(`输入图片不存在: ${p}`)
    if (info.size > MAX_INPUT_BYTES) throw new Error(`输入图片过大 (${(info.size / 1024 / 1024).toFixed(1)}MB)，需 < 4MB: ${p}`)
    const data = await readFile(full)
    urls.push(`data:${mimeFromExt(full)};base64,${data.toString('base64')}`)
  }
  return urls
}
```

- [ ] **Step 4: 工具工厂主体**

```ts
const SHARED_PROPS = {
  prompt: { type: 'string', description: '图像描述（生成或编辑指令）' },
  size: { type: 'string', description: '尺寸。常用预设：1024x1024(1K方) / 1536x1024(3:2) / 3840x2160(4K横16:9) / 2160x3840(4K竖9:16) / 2048x1152(2K横) / auto(模型自动)。自定义须为 宽x高、宽高均为16倍数、比例≤3:1。默认 auto。用户说"4K横屏"传 3840x2160，"4K竖屏"传 2160x3840。' },
  quality: { type: 'string', enum: ['auto', 'low', 'medium', 'high'], description: '质量，默认 auto' },
  format: { type: 'string', enum: ['png', 'jpeg', 'webp'], description: '输出格式，默认 png。透明背景必须 png/webp。' },
  background: { type: 'string', enum: ['transparent', 'opaque', 'auto'], description: '背景。默认 transparent（可抠图）：图标/Logo/单个物体/人物/贴纸等都用 transparent。只有画面本身是带场景/环境的完整图（风景/海报/带背景插画）才用 opaque。不确定用 auto。注意：transparent 会自动用 png。' },
  compression: { type: 'number', description: '压缩 0-100，仅 jpeg/webp 生效，默认 100' },
  output_path: { type: 'string', description: '输出目录。默认当前项目根目录。相对路径相对项目根解析；也可传绝对路径。' },
  count: { type: 'number', description: '生成张数，默认 1，最多 10' },
}

const ASYNC_NOTE = '\n\n这是后台异步执行：调用后立即返回 task_id，生成完成会收到 <task-notification>（含落盘路径）。不要轮询。生成可能耗时较久。不限制同时发起多个生成任务。'

export function createImageTools(deps: ImageToolDeps): ToolHandler[] {
  const runJob = deps.runImageJob ?? defaultRunImageJob

  const start = async (
    input: Record<string, unknown>,
    context: ToolContext,
    imagesParam: unknown,
  ): Promise<ToolResult> => {
    const cfg = deps.getImageConfig()
    if (!cfg) return { content: '图像模型未配置。请在 设置 → 图像 中配置 baseUrl / apiKey / model 并启用。', isError: true }
    let params: NormalizedParams
    let imageDataUrls: string[]
    try {
      params = normalizeParams(input, context.cwd)
      imageDataUrls = await readInputImages(imagesParam, context.cwd)
    } catch (err) {
      return { content: `参数错误：${err instanceof Error ? err.message : String(err)}`, isError: true }
    }
    const task = deps.backgroundTasks.registerImage(params.prompt)
    void runJob({
      taskId: task.id, cfg, prompt: params.prompt, size: params.size, quality: params.quality,
      format: params.format, compression: params.compression, background: params.background,
      count: params.count, outputDir: params.outputDir, imageDataUrls,
      backgroundTasks: deps.backgroundTasks, onImageGenerated: deps.onImageGenerated,
    })
    const adjust = params.formatAdjusted ? '（透明背景已自动改用 png）' : ''
    return { content: `图像生成已在后台启动 (task_id=${task.id})，将生成 ${params.count} 张到 ${params.outputDir}${adjust}。完成后会通知你，不要轮询。` }
  }

  const generateImageTool: ToolHandler = {
    definition: {
      name: 'GenerateImage',
      description: '文生图：根据 prompt 生成图片。' + ASYNC_NOTE,
      inputSchema: { type: 'object', properties: { ...SHARED_PROPS }, required: ['prompt'] },
    },
    execute: (input, context) => start(input, context, undefined),
  }

  const editImageTool: ToolHandler = {
    definition: {
      name: 'EditImage',
      description: '图生图/编辑：基于一张或多张参考图（最多4张，单张<4MB）按 prompt 生成/修改。images 传图片路径，可引用：①之前生成的图的落盘路径 ②项目里已有的图（相对路径）③用户在输入框发的参考图（已落盘的路径）。' + ASYNC_NOTE,
      inputSchema: {
        type: 'object',
        properties: {
          ...SHARED_PROPS,
          images: { type: 'array', items: { type: 'string' }, description: '输入图片路径数组，最多 4 张，单张 < 4MB' },
        },
        required: ['prompt', 'images'],
      },
    },
    execute: (input, context) => start(input, context, input.images),
  }

  return [generateImageTool, editImageTool]
}
```

- [ ] **Step 5: 提交**（测试在 Task 6）

```bash
git add packages/core/src/tools/image-tools.ts
git commit -m "feat(images): add GenerateImage and EditImage tools"
```

---

## Task 6: 工具逻辑测试（image-tools.test.ts）

**Files:**
- Create: `packages/core/src/tools/image-tools.test.ts`

- [ ] **Step 1: 写测试**（用注入的 runImageJob 假执行，避免真网络）

```ts
// packages/core/src/tools/image-tools.test.ts
import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { createImageTools } from './image-tools.js'
import { BackgroundTaskManager } from '../background-tasks.js'
import type { ImageModelConfig } from '../images/image-config.js'

const cfg: ImageModelConfig = { enabled: true, baseUrl: 'https://x', apiKey: 'k', model: 'gpt-image-2' }
function setup(getConfig: () => ImageModelConfig | null = () => cfg) {
  const backgroundTasks = new BackgroundTaskManager(mkdtempSync(join(tmpdir(), 'imgtool-')))
  const runImageJob = vi.fn(async () => {})
  const [gen, edit] = createImageTools({ getImageConfig: getConfig, backgroundTasks, runImageJob })
  return { gen, edit, runImageJob, backgroundTasks }
}
const ctx = { cwd: process.cwd() } as any

describe('GenerateImage', () => {
  it('未配置时报错', async () => {
    const { gen } = setup(() => null)
    const r = await gen.execute({ prompt: 'cat' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toContain('未配置')
  })
  it('成功启动后台任务并返回 task_id', async () => {
    const { gen, runImageJob } = setup()
    const r = await gen.execute({ prompt: 'cat' }, ctx)
    expect(r.isError).toBeFalsy()
    expect(r.content).toMatch(/task_id=/)
    expect(runImageJob).toHaveBeenCalledOnce()
  })
  it('透明背景 + jpeg → 强制 png', async () => {
    const { gen, runImageJob } = setup()
    await gen.execute({ prompt: 'icon', background: 'transparent', format: 'jpeg' }, ctx)
    expect(runImageJob.mock.calls[0][0]).toMatchObject({ format: 'png', background: 'transparent' })
  })
  it('非法尺寸报错', async () => {
    const { gen } = setup()
    const r = await gen.execute({ prompt: 'x', size: '1000x1000' }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toContain('16 的倍数')
  })
  it('count 越界被夹紧', async () => {
    const { gen, runImageJob } = setup()
    await gen.execute({ prompt: 'x', count: 99 }, ctx)
    expect(runImageJob.mock.calls[0][0].count).toBe(10)
  })
  it('空 prompt 报错', async () => {
    const { gen } = setup()
    const r = await gen.execute({ prompt: '  ' }, ctx)
    expect(r.isError).toBe(true)
  })
})

describe('EditImage', () => {
  it('输入图不存在报错', async () => {
    const { edit } = setup()
    const r = await edit.execute({ prompt: 'x', images: ['nope.png'] }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toContain('不存在')
  })
  it('>4 张报错', async () => {
    const { edit } = setup()
    const r = await edit.execute({ prompt: 'x', images: ['a','b','c','d','e'] }, ctx)
    expect(r.isError).toBe(true)
    expect(r.content).toContain('最多 4')
  })
  it('合法输入图启动任务', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'imginput-'))
    const p = join(dir, 'ref.png')
    writeFileSync(p, Buffer.from('hello'))
    const { edit, runImageJob } = setup()
    const r = await edit.execute({ prompt: 'x', images: [p] }, { cwd: dir } as any)
    expect(r.isError).toBeFalsy()
    expect(runImageJob.mock.calls[0][0].imageDataUrls[0]).toMatch(/^data:image\/png;base64,/)
  })
})
```

- [ ] **Step 2: 运行确认通过**

Run: `cd packages/core && npx vitest run src/tools/image-tools.test.ts`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/core/src/tools/image-tools.test.ts
git commit -m "test(images): cover image tool validation and async dispatch"
```

---

## Task 7: Session 接线（条件注册 + 通知）

**Files:**
- Modify: `packages/core/src/session.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: index.ts 导出**

在 `packages/core/src/index.ts` 适当位置追加：

```ts
export { createImageTools, type ImageToolDeps } from './tools/image-tools.js'
export { loadImageModelConfig, isImageModelConfigured, type ImageModelConfig } from './images/image-config.js'
export type { ImageOutput } from './background-tasks.js'
```

- [ ] **Step 2: session.ts —— import**

在文件顶部 import 区（靠近 `import { createAgentTool } from './tools/agent.js'`）加：

```ts
import { createImageTools } from './tools/image-tools.js'
import { loadImageModelConfig } from './images/image-config.js'
import type { ImageOutput } from './background-tasks.js'
```

- [ ] **Step 3: session.ts —— pendingNotifications 联合类型**

把 `private pendingNotifications` 的 `type` 联合（session.ts:159）改为追加 `'image_complete'`，并加字段：

```ts
    type: 'shell_complete' | 'agent_complete' | 'team_progress' | 'team_complete' | 'image_complete'
```

在该对象类型里追加（与 `teamEvent?` 同级）：

```ts
    images?: ImageOutput[]
```

- [ ] **Step 4: session.ts —— setOnComplete 增加 image 分支**

在 `setOnComplete` 回调里（session.ts:194 起），把现有 `if (task.type === 'shell') {...} else {...}` 改为先处理 image：

```ts
    this.backgroundTasks.setOnComplete((task) => {
      if (task.type === 'image') {
        this.pendingNotifications.push({
          type: 'image_complete',
          taskId: task.id,
          status: task.status as 'completed' | 'failed',
          prompt: task.prompt,
          result: task.result,
          images: task.images,
        })
        this.onNotificationReady?.()
        return
      }
      if (task.type === 'shell') {
        // ...（保持原有逻辑不变）
```

- [ ] **Step 5: session.ts —— drainNotifications 渲染 image_complete**

在 `drainNotifications`（session.ts:834）的 map 里，为 image_complete 生成 notification（在返回 agent_complete 的兜底之前加分支）：

```ts
      if (n.type === 'image_complete') {
        if (n.status === 'failed') {
          return `<task-notification>\n<task-id>${n.taskId}</task-id>\n<type>image_complete</type>\n<status>failed</status>\n<error>${n.result || 'unknown'}</error>\n</task-notification>`
        }
        const lines = (n.images || []).map((img) => {
          const dim = img.width && img.height ? `${img.width}x${img.height}` : 'auto'
          const sz = img.bytes ? `${(img.bytes / 1024).toFixed(0)}KB` : 'remote'
          const err = img.downloadError ? ` | 下载失败(可用url): ${img.downloadError}` : ''
          return `${img.path} | ${dim} | ${img.format} | ${img.background}${img.transparent ? '(可抠图)' : ''} | ${sz}${err}`
        }).join('\n')
        return `<task-notification>\n<task-id>${n.taskId}</task-id>\n<type>image_complete</type>\n<status>completed</status>\n<images>\n${lines}\n</images>\nImages are on disk. To make variants or edits, call EditImage with these paths. Do NOT re-read the image into context.\n</task-notification>`
      }
```

- [ ] **Step 6: session.ts —— 条件注册工具 + onImageGenerated 回调**

6a. 类增加字段（与 `_teamEventHandler?` 同级附近）：

```ts
  /** UI 转发：图像生成完成（含磁盘路径），不进上下文 */
  onImageGenerated?: (taskId: string, images: ImageOutput[]) => void
```

6b. 在构造函数注册 AgentTool 之后（session.ts:396 之后合适处）追加：

```ts
    // Image tools — only when imageModel is configured
    if (loadImageModelConfig()) {
      for (const tool of createImageTools({
        getImageConfig: loadImageModelConfig,
        backgroundTasks: this.backgroundTasks,
        onImageGenerated: (taskId, images) => {
          this.onImageGenerated?.(taskId, images)
        },
      })) {
        this.toolRegistry.register(tool)
      }
    }
```

- [ ] **Step 7: 验证 core 构建 + 全量测试**

Run: `cd packages/core && npx tsc --noEmit && npx vitest run src/images src/tools/image-tools.test.ts src/background-tasks.image.test.ts`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add packages/core/src/session.ts packages/core/src/index.ts
git commit -m "feat(images): wire image tools into Session with disk-path notifications"
```

---

## Task 8: Electron 转发 image:generated + 参考图落盘

**Files:**
- Modify: `packages/electron/src/session-manager.ts`

- [ ] **Step 1: 转发 onImageGenerated 到渲染进程**

在 `activateSession` 创建 `session` 之后（紧跟 `session.registerTool(createNotifyTool(onNotify))` 附近，session-manager.ts:311 之后）追加：

```ts
    session.onImageGenerated = (taskId: string, images: any[]) => {
      this.window?.webContents.send('image:generated', { sessionId, taskId, images })
    }
```

- [ ] **Step 2: sendMessage 里参考图落盘到 .jdc-image-input/**

在 `sendMessage` 处理 `images` 的循环里（session-manager.ts:436 起，构造 `extraContent` 处），把每张压缩后的图额外写盘，并把路径作为一段隐藏文本附加到用户消息。具体：在 `extraContent` 计算完成后、`session.sendMessage(text, events, extraContent)` 之前插入：

```ts
    // Persist user-attached reference images to .jdc-image-input/ so the model
    // can reference them by PATH in EditImage (decision A1: everything is a path).
    let inputImageNote = ''
    if (extraContent?.length) {
      try {
        const cwd = this.getSessionCwd(sessionId) || process.cwd()
        const inputDir = path.join(cwd, '.jdc-image-input')
        const { mkdirSync, writeFileSync } = await import('node:fs')
        mkdirSync(inputDir, { recursive: true })
        const paths: string[] = []
        extraContent.forEach((img, i) => {
          const ext = img.source.media_type === 'image/jpeg' ? 'jpg'
            : img.source.media_type === 'image/webp' ? 'webp'
            : img.source.media_type === 'image/gif' ? 'gif' : 'png'
          const file = path.join(inputDir, `input_${Date.now()}_${i + 1}.${ext}`)
          writeFileSync(file, Buffer.from(img.source.data, 'base64'))
          paths.push(file)
        })
        if (paths.length) {
          inputImageNote = `\n\n<image-input-paths>\n${paths.join('\n')}\n</image-input-paths>`
        }
      } catch (err) {
        console.warn('[IMAGE] persist input image failed:', (err as Error).message)
      }
    }
```

然后把发送调用改为附加 note：

```ts
      await session.sendMessage(text + inputImageNote, events, extraContent)
```

> 说明：`<image-input-paths>` 让模型在需要"基于用户发的图编辑"时拿到磁盘路径传给 EditImage。图本身仍作为 ImageContent 进上下文（模型看得到），路径用于工具引用。

- [ ] **Step 3: 验证 electron 构建**

Run: `cd packages/electron && npx tsc --noEmit`
Expected: PASS（无类型错误）

- [ ] **Step 4: 提交**

```bash
git add packages/electron/src/session-manager.ts
git commit -m "feat(images): forward image:generated event and persist reference images"
```

---

## Task 9: Electron IPC —— 复制图片 / 在文件夹显示

**Files:**
- Modify: `packages/electron/src/preload.ts`
- Modify: `packages/electron/src/ipc-handlers.ts`

- [ ] **Step 1: preload 暴露方法**

在 `packages/electron/src/preload.ts` 的 `api` 对象里（`writeClipboard` 附近）追加：

```ts
  copyImageFile: (filePath: string) => ipcRenderer.invoke('images:copy-to-clipboard', { filePath }),
  showImageInFolder: (filePath: string) => ipcRenderer.invoke('images:show-in-folder', { filePath }),
  onImageGenerated: (callback: (payload: { sessionId: string; taskId: string; images: any[] }) => void) => {
    const listener = (_e: unknown, payload: any) => callback(payload)
    ipcRenderer.on('image:generated', listener)
    return () => { ipcRenderer.removeListener('image:generated', listener) }
  },
```

- [ ] **Step 2: ipc-handlers 注册 handler**

在 `packages/electron/src/ipc-handlers.ts` 顶部确保从 electron import `clipboard, nativeImage, shell`（若已有 import electron，则补充这几个成员）。在注册 ipc 的函数体内追加：

```ts
  ipcMain.handle('images:copy-to-clipboard', (_e, { filePath }: { filePath: string }) => {
    try {
      const img = nativeImage.createFromPath(filePath)
      if (img.isEmpty()) return { success: false, error: '图片为空或无法读取' }
      clipboard.writeImage(img)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
  ipcMain.handle('images:show-in-folder', (_e, { filePath }: { filePath: string }) => {
    shell.showItemInFolder(filePath)
    return { success: true }
  })
```

> 查 ipc-handlers.ts 现有 import 行，把 `nativeImage`、`shell`、`clipboard` 加入既有 `from 'electron'` 解构（避免重复 import）。

- [ ] **Step 3: 验证构建**

Run: `cd packages/electron && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add packages/electron/src/preload.ts packages/electron/src/ipc-handlers.ts
git commit -m "feat(images): IPC for copy-image-to-clipboard and show-in-folder"
```

---

## Task 10: UI ipc-client 类型 + clipboard helper

**Files:**
- Modify: `packages/ui/src/lib/ipc-client.ts`
- Modify: `packages/ui/src/lib/clipboard.ts`

- [ ] **Step 1: ipc-client 加方法**

在 `packages/ui/src/lib/ipc-client.ts` 的导出对象里追加（与 `config` 同级）：

```ts
  images: {
    copyToClipboard: (filePath: string) =>
      invoke('images:copy-to-clipboard', { filePath }) as Promise<{ success: boolean; error?: string }>,
    showInFolder: (filePath: string) =>
      invoke('images:show-in-folder', { filePath }) as Promise<{ success: boolean }>,
  },
```

- [ ] **Step 2: clipboard.ts 加 copyImageFile**

在 `packages/ui/src/lib/clipboard.ts` 末尾追加：

```ts
export async function copyImageFile(filePath: string): Promise<void> {
  const api = (window as any).electronAPI
  if (api?.copyImageFile) {
    const res = await api.copyImageFile(filePath)
    if (res && res.success === false) throw new Error(res.error || '复制图片失败')
    return
  }
  // 浏览器兜底：fetch file:// 通常受限，尝试 navigator.clipboard
  const resp = await fetch(`file://${filePath}`)
  const blob = await resp.blob()
  await (navigator.clipboard as any).write([new (window as any).ClipboardItem({ [blob.type]: blob })])
}
```

- [ ] **Step 3: 验证 UI 构建**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add packages/ui/src/lib/ipc-client.ts packages/ui/src/lib/clipboard.ts
git commit -m "feat(images): UI ipc-client image methods and copyImageFile helper"
```

---

## Task 11: image-store + GeneratedImageCard

**Files:**
- Create: `packages/ui/src/stores/image-store.ts`
- Create: `packages/ui/src/components/GeneratedImageCard.tsx`

- [ ] **Step 1: image-store**

```ts
// packages/ui/src/stores/image-store.ts
import { create } from 'zustand'

export interface GeneratedImage {
  path: string
  width?: number
  height?: number
  bytes: number
  format: string
  background: string
  transparent: boolean
  downloadError?: string
}

interface ImageState {
  // sessionId -> taskId -> images
  byTask: Record<string, Record<string, GeneratedImage[]>>
  addGenerated: (sessionId: string, taskId: string, images: GeneratedImage[]) => void
  getForSession: (sessionId: string) => Record<string, GeneratedImage[]>
}

export const useImageStore = create<ImageState>((set, get) => ({
  byTask: {},
  addGenerated: (sessionId, taskId, images) =>
    set((s) => ({
      byTask: {
        ...s.byTask,
        [sessionId]: { ...(s.byTask[sessionId] ?? {}), [taskId]: images },
      },
    })),
  getForSession: (sessionId) => get().byTask[sessionId] ?? {},
}))
```

- [ ] **Step 2: 在 app 入口订阅 image:generated**

在挂载根组件处（搜索现有 `onMcpStateChanged` 或 `electronAPI.on` 订阅的地方，通常 `App.tsx` 或 `ProjectPage.tsx` 的 useEffect），追加：

```ts
useEffect(() => {
  const off = (window as any).electronAPI?.onImageGenerated?.((payload: { sessionId: string; taskId: string; images: any[] }) => {
    useImageStore.getState().addGenerated(payload.sessionId, payload.taskId, payload.images)
  })
  return () => { off?.() }
}, [])
```

> 实现时确认订阅放在一个全局且只挂载一次的组件里（如 `App.tsx`），避免重复监听。

- [ ] **Step 3: GeneratedImageCard 组件**

```tsx
// packages/ui/src/components/GeneratedImageCard.tsx
import { useState } from 'react'
import type { GeneratedImage } from '../stores/image-store'
import { copyImageFile, copyToClipboard } from '../lib/clipboard'
import { ipc } from '../lib/ipc-client'

export function GeneratedImageCard({ images }: { images: GeneratedImage[] }) {
  if (!images?.length) return null
  return (
    <div className="mb-3 rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] p-3">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--accent)]">Generated Images</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {images.map((img) => <ImageTile key={img.path} img={img} />)}
      </div>
    </div>
  )
}

function ImageTile({ img }: { img: GeneratedImage }) {
  const [toast, setToast] = useState('')
  const isRemote = img.bytes === 0 && /^https?:\/\//.test(img.path)
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 1500) }

  const doCopyImage = async () => {
    try { await copyImageFile(img.path); flash('已复制图片') } catch (e) { flash('复制失败') }
  }
  const doCopyPath = async () => { await copyToClipboard(img.path); flash('已复制路径') }
  const doShow = async () => { await ipc.images.showInFolder(img.path) }

  return (
    <div className="overflow-hidden rounded-[6px] border border-[var(--border)]">
      <div className="relative bg-[repeating-conic-gradient(#0002_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
        {isRemote
          ? <a href={img.path} target="_blank" rel="noreferrer" className="flex h-32 items-center justify-center text-[12px] text-[var(--accent)]">远程图片，点击打开</a>
          : <img src={`file://${img.path}`} alt="" className="max-h-48 w-full object-contain" />}
      </div>
      <div className="flex flex-wrap gap-1 p-2 text-[11px]">
        {!isRemote && <button onClick={doCopyImage} className="rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--accent)]">复制图片</button>}
        <button onClick={doCopyPath} className="rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--accent)]">复制路径</button>
        {!isRemote && <button onClick={doShow} className="rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--accent)]">在文件夹显示</button>}
        {toast && <span className="self-center text-[var(--accent)]">{toast}</span>}
      </div>
      <div className="px-2 pb-2 text-[10px] text-[var(--muted)]">
        {img.width && img.height ? `${img.width}x${img.height} · ` : ''}{img.format}{img.transparent ? ' · 透明' : ''}
        {img.downloadError ? ` · 下载失败` : ''}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 验证构建**

Run: `cd packages/ui && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/ui/src/stores/image-store.ts packages/ui/src/components/GeneratedImageCard.tsx
git commit -m "feat(images): image store and GeneratedImageCard component"
```

---

## Task 12: 在会话流挂载 GeneratedImageCard

**Files:**
- Modify: `packages/ui/src/components/ConversationTurn.tsx`

- [ ] **Step 1: 挂载图片卡**

在 `ConversationTurn.tsx` 的 Assistant section 末尾（`{/* Streaming text */}` 块之后、闭合 `</div>` 之前）渲染本轮关联的生成图片。由于图片通过 taskId 关联，简单策略：在会话级别渲染（取该 session 全部已生成图）。在组件内通过 store 取数据：

```tsx
import { useImageStore } from '../stores/image-store'
// 组件内（需要 sessionId prop；若无，从上层传入）：
const generated = useImageStore((s) => (props.sessionId ? s.byTask[props.sessionId] : undefined))
```

在 assistant section 内合适位置渲染：

```tsx
{generated && Object.entries(generated).map(([taskId, imgs]) => (
  <GeneratedImageCard key={taskId} images={imgs} />
))}
```

> 实现时确认 `ConversationTurn` 能拿到 `sessionId`：若当前 props 没有，沿调用链（`ChatView` → `ConversationTurn`）补传 `sessionId`。若改动过大，替代方案：在 `ChatView` 底部统一渲染一个 `<GeneratedImagesPanel sessionId=.. />` 遍历 `byTask[sessionId]`，避免逐轮关联。二选一，推荐后者（更简单、不需改 ConversationTurn 的 props）。

- [ ] **Step 2: 验证构建 + UI 测试**

Run: `cd packages/ui && npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add packages/ui/src/components/
git commit -m "feat(images): render generated images in chat view"
```

---

## Task 13: 设置页「图像」Tab

**Files:**
- Modify: `packages/ui/src/stores/settings-store.ts`
- Modify: `packages/ui/src/components/SettingsOverlay.tsx`

- [ ] **Step 1: settings-store 加 tab**

在 `packages/ui/src/stores/settings-store.ts` 的 `SettingsTab` 联合类型里加 `'image'`。

- [ ] **Step 2: SettingsOverlay TABS + 渲染**

2a. 在 `TABS` 数组（SettingsOverlay.tsx:69）加：

```ts
  { key: 'image', label: '图像' },
```

2b. 在 tab 渲染处（`{activeTab === 'tools' && <ToolsTab />}` 附近）加：

```tsx
          {activeTab === 'image' && <ImageModelTab />}
```

2c. 新增 `ImageModelTab` 组件（仿 `ToolsTab` 写法，文件内）：

```tsx
function ImageModelTab() {
  const [enabled, setEnabled] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('gpt-image-2')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    ipc.config.get().then((cfg: any) => {
      const im = cfg?.imageModel || {}
      setEnabled(im.enabled === true)
      setBaseUrl(im.baseUrl || '')
      setApiKey(im.apiKey || '')
      setModel(im.model || 'gpt-image-2')
    })
  }, [])

  const handleSave = async () => {
    await ipc.config.set({ imageModel: { enabled, baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() } } as any)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const inputCls = 'w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-[6px] px-3 py-2 text-[13px] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent)]'
  const labelCls = 'text-[12px] text-[var(--muted)] mb-1'

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-[14px] font-medium text-[var(--text)] mb-3">图像生成模型</h3>
        <label className="flex items-center gap-2 mb-4 text-[13px] text-[var(--text)]">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          启用图像生成（GenerateImage / EditImage 工具）
        </label>
        <div className="mb-3">
          <div className={labelCls}>Base URL</div>
          <input className={inputCls} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://www.codexapis.com" />
        </div>
        <div className="mb-3">
          <div className={labelCls}>API Key</div>
          <input type="password" className={inputCls} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." />
        </div>
        <div className="mb-3">
          <div className={labelCls}>Model</div>
          <input className={inputCls} value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-image-2" />
        </div>
        <button onClick={handleSave} className="rounded-[6px] border border-[var(--accent)] px-3 py-1.5 text-[13px] text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]">
          {saved ? '已保存' : '保存'}
        </button>
        <p className="mt-3 text-[11px] text-[var(--muted)]">保存后需新建会话生效（工具在会话创建时注册）。所有生成参数（尺寸/质量/格式/背景等）由 AI 按你的需求自动决定。</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 验证构建 + 设置页测试**

Run: `cd packages/ui && npx tsc --noEmit && npx vitest run src/components/SettingsOverlay.test.tsx`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add packages/ui/src/stores/settings-store.ts packages/ui/src/components/SettingsOverlay.tsx
git commit -m "feat(images): add image model settings tab"
```

---

## Task 14: 全量验证

- [ ] **Step 1: core 测试 + 类型**

Run: `cd packages/core && npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 2: electron + ui 类型**

Run: `cd packages/electron && npx tsc --noEmit && cd ../ui && npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 3: 手动验证清单（需用户在真机执行）**

1. 设置 → 图像：填 baseUrl/apiKey/model，启用，保存；新建会话。
2. 让模型「生成一个透明背景的猫咪图标」→ 确认后台启动、完成通知、聊天里出现图片卡、棋盘格透明底、文件落在项目根、`复制图片`粘贴到其它应用是原图。
3. 让模型「根据刚才那张图再生成 3 张变体」→ 确认走 EditImage、用的是上一张的路径、出 3 张。
4. 在输入框发一张参考图 + 「基于这张图改成蓝色背景」→ 确认参考图落盘到 `.jdc-image-input/`、EditImage 用该路径、`opaque` 背景。
5. 让模型「生成 4K 横屏风景图」→ 确认 size=3840x2160、background=opaque（带场景）。
6. 未配置图像模型的会话里，确认模型工具列表没有 GenerateImage/EditImage。

> 无头环境无法跑真机截图，此步需用户实测确认。

- [ ] **Step 4: 提示加 .gitignore（可选）**

向用户建议把 `.jdc-image-input/` 加入项目 `.gitignore`（避免参考图入库）。生成图默认落在项目根，路径由模型/用户控制，不强制 ignore。

---

## Self-Review 记录

- **Spec 覆盖**：配置段(Task3/13)、API客户端(Task2)、两工具+全参数(Task1/5)、后台异步(Task4/5/7)、通知不进上下文(Task7)、UI图片卡+复制(Task9/10/11/12)、参考图落盘A1(Task8)、条件注册(Task7)、不限并发(Task4/5)、透明默认+强制png(Task1/5) — 均有对应任务。
- **参数完整性**：尺寸预设全表、自定义校验(16倍数/3:1)、quality/format/compression/background、edits约束(≤4张/<4MB)、payload组装规则 — 全部写入计划顶部参考表 + Task1/2/5。
- **类型一致性**：`ImageOutput`(background-tasks)贯穿 Task4/5/7/11；`ImageModelConfig` 贯穿 Task3/5/7/13；`runImageJob` 注入签名 Task5 定义、Task6 复用；`registerImage/completeImage/failImage` Task4 定义、Task5 调用一致。
- **占位符**：无 TBD/TODO；每个代码步骤含完整代码。

