# 图像生成工具（GenerateImage / EditImage）设计

## 背景与目标

JDC CODE 目前没有生成图片的能力。本设计新增两个内置工具——`GenerateImage`（文生图）与 `EditImage`（图生图/编辑），让模型可以按用户需求生成和修改图片。

参考实现：`/Users/chenmingxu/Documents/gpt_image`，它是一个 OpenAI 兼容的 images API 客户端
（`POST {baseUrl}/v1/images/generations` 与 `/v1/images/edits`，Bearer key，payload
`{model, prompt, quality, size, output_format, output_compression, background, images}`，
响应里递归抽取 base64 或 remote url）。本设计直接复用其已验证的 `image-api-client.ts` 逻辑。

### 核心需求（来自用户确认）

1. 独立配置：图像模型在配置中单独设置一个段，**只有成功配置后才注册这两个工具**。
2. 生成耗时长 → **默认后台（异步）执行**，用户不必盯着，完成后通知 + 在聊天里呈现。
3. 两个工具都要：`GenerateImage`（文生图）+ `EditImage`（图生图/编辑）。
4. 默认输出路径 = **当前项目（cwd）**，除非用户指定其它路径。
5. 生成的图片用户可以**复制**（无损原图复制）。
6. **默认透明背景（可抠图）**：图标、人物、单个物体、贴纸等默认 `transparent`；
   只有画面本身带场景/背景（风景、海报、带背景插画）时才用 `opaque`；不确定用 `auto`。
7. 所有生成参数（size/quality/format/background/输出路径/数量）**全部由模型按用户需求传入**，
   配置里不放默认值。用户说"生成 4K 横屏"，模型就传 4K 横屏对应的参数。
8. 用户可以"根据这张图再生成 N 张 / 修改一下"——支持引用①生成历史里的图、②项目里已有图、
   ③用户在输入框新发的参考图。
9. **不限制模型一次发起几个生成任务**（可并发多任务）。

## 整体架构（5 层）

```
配置层      ~/.jdcagnet/config.json → imageModel { enabled, baseUrl, apiKey, model }
  │
  ├─ 设置 UI：独立「图像生成模型」区块（4 字段 + 启用开关 + 测试连接）
  │
工具层      createImageTools(deps) → [GenerateImage, EditImage]
  │         （仅当 imageModel 有效配置时由 Session 注册）
  │
客户端层    packages/core/src/images/image-api-client.ts（移植参考项目）
  │
执行层      后台异步：工具立即返回 task_id → BackgroundTaskManager 跑 API
  │         → 图片落盘到 cwd → 完成通知（纯文本给模型）+ image:generated 事件（给 UI）
  │
呈现层      聊天流插入「生成图片卡」：缩略图 + 复制图片 + 在文件夹显示 + 复制路径
```

设计原则（决策 A）：**图片落盘，模型靠"路径"引用图，不把图字节塞进 LLM 上下文。**
模型生成/编辑完成只需要知道"成功了、图在哪"，不需要重新"看"自己画的图。这样 4K 大图不污染
上下文、不烧 token，且复制的是磁盘原图、无损。

## 1. 配置层

### config.json 新增段

```jsonc
{
  "imageModel": {
    "enabled": true,
    "baseUrl": "https://www.codexapis.com",
    "apiKey": "sk-...",
    "model": "gpt-image-2"
  }
}
```

- 独立于 `modelGroups`。图像 API 是另一类接口（不是 chat completion），不混进对话模型组，
  不污染模型选择下拉框。
- 只有 4 个字段；其余生成参数全部由模型运行时传入。

### core 侧读写

- `packages/core/src/config.ts` 已有 `loadAppConfig()/saveAppConfig()`（浅合并、读写
  `~/.jdcagnet/config.json`）。新增一个轻量读取器：
  ```ts
  // packages/core/src/images/image-config.ts
  export interface ImageModelConfig {
    enabled: boolean; baseUrl: string; apiKey: string; model: string
  }
  export function loadImageModelConfig(): ImageModelConfig | null
  // 返回 null 当 !enabled || !apiKey || !baseUrl
  export function isImageModelConfigured(): boolean
  ```

### 设置 UI

- 设置页新增「图像生成模型」区块：baseUrl / apiKey(password) / model 三个输入 + 启用开关
  + 「测试连接」按钮（调一个最小 generations 请求或 HEAD 验证 key）。
- 通过现有 settings IPC 写入 `config.imageModel`。
- 与 MCP 配置一致的提示：保存后需新会话生效（工具在 Session 构造时注册）。

## 2. API 客户端（移植）

`packages/core/src/images/image-api-client.ts` —— 几乎照搬参考项目，调整点：

- `BuildImageRequestInput` 增加 `background?: 'transparent' | 'opaque' | 'auto'` 字段，
  非空时写入 payload.background。
- `buildRequest()`：`images.length > 0 ? 'edits' : 'generations'`；
  payload 组装 `{model, prompt, quality, output_format, [size], [output_compression],
  [background], [images]}`。
- `generate()`：POST，600s 超时，Bearer key，非 2xx 抛错。
- `resolveImageApiResult()/extractImageApiResult()`：递归抽 base64 或 remote url，
  remote url 自动下载转 base64。直接复用参考项目逻辑（已验证）。
- 单元测试移植参考项目的 `image-api-client.spec.ts` / `image-api-error.spec.ts`
  / `remote-image-url-output.spec.ts`（用假 fetch/downloadFn）。

## 3. 两个工具

### 工厂

```ts
// packages/core/src/tools/image-tools.ts
export interface ImageToolDeps {
  getImageConfig: () => ImageModelConfig | null
  backgroundTasks: BackgroundTaskManager
}
export function createImageTools(deps: ImageToolDeps): ToolHandler[]
// 返回 [generateImageTool, editImageTool]
```

### 共享参数（全部由模型传，描述里写清默认值与判断规则）

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `prompt` | string | 必填 | 生成/编辑描述 |
| `size` | string | `auto` | 如 `1024x1024` / `3840x2160`(4K横) / `2160x3840`(4K竖) / `1536x1024` / `auto`。描述里列常用预设 |
| `quality` | enum | `auto` | `auto` / `low` / `medium` / `high` |
| `format` | enum | `png` | `png` / `jpeg` / `webp` |
| `background` | enum | `transparent` | **默认 transparent 可抠图**；带场景背景传 `opaque`；不确定 `auto` |
| `compression` | number | 100 | 仅 jpeg/webp 生效 |
| `output_path` | string | cwd | 输出目录，相对 cwd 解析；用户指定绝对路径则用绝对路径 |
| `count` | number | 1 | 一次生成几张 |

`EditImage` 额外：

| 参数 | 类型 | 说明 |
|---|---|---|
| `images` | string[] | 输入图路径数组（最多 4 张）。接受：①生成历史里的路径 ②项目相对路径 ③composer 落盘后的路径。工具内部读文件转 base64 data url |

### 透明背景强约束

当 `background === 'transparent'` 且 `format` 不是 png/webp（即 jpeg）时，**强制覆盖 format
为 png**（jpeg 无透明通道），并在结果文本里注明"已将格式调整为 png 以支持透明背景"。

### 工具描述要点（写进 inputSchema description）

- 说明默认透明可抠图的判断规则（图标/人物/单物体→transparent；带场景背景→opaque）。
- 说明这是后台异步执行：返回 task_id，完成后会收到 `<task-notification>`，**不要轮询**。
- 说明 `EditImage` 的 images 可引用生成历史路径 / 项目图 / 用户发的参考图。
- 说明默认输出到当前项目；多张用 count。

## 4. 执行层（后台异步）

### 流程

1. 模型调 `GenerateImage`/`EditImage`。
2. 工具校验配置（`getImageConfig()` 为 null → isError 提示去配置）+ 参数（path 安全、
   输入图存在且 <4MB、count 范围）。
3. 工具向 `BackgroundTaskManager` 注册一个 **image 类型任务**，立即返回
   `"图像生成已在后台启动 (task_id=xxx)，完成后会通知你。不要轮询。"`。
4. 后台 worker：调 `ImageApiClient.generate()`（×count，串行或受限并发），每张落盘到
   `output_path`，文件名 `img_<timestamp>_<idx>.<ext>`，目录不存在则 mkdir。
5. 完成 → 任务标记 completed/failed，触发 `setOnComplete`。

### BackgroundTaskManager 扩展

- `TaskType` 增加 `'image'`。
- 新增 `registerImage(spec)` / `completeImage(id, {images, error})`，与现有 agent/team
  注册模式一致（无子进程的内存任务）。
- `BackgroundTask` 增加可选 `images?: Array<{ path: string; width?: number; height?: number;
  bytes: number; background: string; format: string; transparent: boolean }>`。
- **不限制并发**：image 任务不走 `acquireAgentSlot`（满足"不限制一次几个任务"）。
  各任务内部对 count 多张可做小并发限制（如 ≤3）防打爆 API，但任务之间不排队。

### Session 接线

- `session.ts` 构造时：`if (isImageModelConfigured()) { for (const t of
  createImageTools({ getImageConfig: loadImageModelConfig, backgroundTasks:
  this.backgroundTasks })) this.toolRegistry.register(t) }`。
- `pendingNotifications` 联合类型增加 `'image_complete'`。`setOnComplete` 里
  `task.type === 'image'` 分支：push 一条 image_complete 通知（**纯文本**：每张的路径、
  尺寸、格式、是否透明、字节数）。
- `drainNotifications()` 为 image_complete 生成 `<task-notification>`：
  ```
  <task-notification>
  <task-id>..</task-id><type>image_complete</type><status>completed</status>
  <images>
  ./generated/img_x_1.png | 3840x2160 | png | transparent | 1.2MB
  </images>
  </task-notification>
  ```
  → 模型据此知道"成功了、图在哪"，后续可把路径喂给 `EditImage`。

### UI 事件（呈现用，不进上下文）

- `setOnComplete` 的 image 分支额外通过 window 推一条 `image:generated`
  IPC 事件 `{ sessionId, taskId, images: [{path, width, height, transparent, ...}] }`。
- electron `session-manager.ts`：在 onNotificationReady / setOnComplete 链路里转发该事件
  到 `window.webContents.send('image:generated', ...)`（参照 background:state-changed）。

## 5. 呈现层（聊天里的图片卡 + 复制）

### 新增组件 `GeneratedImageCard.tsx`

- 监听 `image:generated`（经 preload 暴露 + 一个 `image-store` 收集，按 sessionId/taskId）。
- 在对应轮次的工具卡之后（或会话流末尾）渲染缩略图网格。
- 每张图操作：
  - **复制图片**（无损原图）：electron 侧 `clipboard.writeImage(nativeImage.createFromPath(p))`，
    通过 preload 暴露 `electronAPI.copyImageFile(path)`。`packages/ui/src/lib/clipboard.ts`
    增加 `copyImageFile(path)`，优先走 electron，无则 fetch→blob→`navigator.clipboard.write`。
  - **在文件夹中显示**：`shell.showItemInFolder(path)`（新 IPC）。
  - **复制路径**：复用现有 `copyToClipboard(path)`。
- 缩略图 `src` 用 `file://` 路径或经一个安全的 `image://` 协议加载（避免把 base64 进 DOM 过大；
  优先 `file://<abs path>`，Electron 渲染进程可加载本地文件）。

### preload / IPC 新增

- `image:generated`（main→renderer 事件）。
- `images:copyImageToClipboard(path)`（renderer→main）。
- `images:showInFolder(path)`（renderer→main）。
- `images:testConnection(config)`（设置页测试连接，可选）。

## "根据这张图再生成/修改" 的三种来源（决策 A1：一切皆路径）

1. **基于刚生成的图**：完成通知里带落盘路径，路径作为文本留在历史。用户说"再来 5 张变体/改背景"
   → 模型把该路径传给 `EditImage`，`count: 5`。模型不需重看图。
2. **引用项目里已有图**：cwd 相对路径，`EditImage` 直接读。
3. **用户在输入框新发参考图**：composer 附带的图除了作为 `ImageContent` 进对话外，
   **同时落盘到会话临时目录 `<cwd>/.jdc-image-input/`**（A1）。模型在历史里看到这张图、
   也拿到它的路径，引用时把路径传给 `EditImage`。三种来源统一成"传路径"。
   - 落盘点：`session-manager.ts` 的 `sendMessage` 处理 `images` 时，压缩后额外写盘一份，
     把路径作为一段文本附加进用户消息（或通过隐藏的 `<image-input path=..>` 标注），
     供模型引用。
   - `.jdc-image-input/` 建议加入 `.gitignore` 提示（不强制）。

## 文件改动清单

新增：
- `packages/core/src/images/image-api-client.ts` —— 移植参考项目。
- `packages/core/src/images/image-config.ts` —— imageModel 配置读取。
- `packages/core/src/tools/image-tools.ts` —— GenerateImage + EditImage 工厂。
- `packages/core/src/images/image-api-client.test.ts` —— 移植参考项目测试。
- `packages/core/src/tools/image-tools.test.ts` —— 工具逻辑测试（透明强制 png、路径解析、
  配置缺失报错、count 校验、后台任务注册）。
- `packages/ui/src/components/GeneratedImageCard.tsx` —— 图片卡。
- `packages/ui/src/stores/image-store.ts` —— 收集 image:generated 事件。

改写：
- `packages/core/src/background-tasks.ts` —— TaskType 加 image，registerImage/completeImage，
  BackgroundTask.images 字段，image 任务不走并发槽。
- `packages/core/src/session.ts` —— 条件注册 image 工具；pendingNotifications 联合类型 +
  image_complete 分支；drainNotifications 的 image_complete 渲染。
- `packages/electron/src/session-manager.ts` —— 转发 image:generated 事件；sendMessage 里
  参考图落盘到 .jdc-image-input/。
- `packages/electron/src/ipc-handlers.ts` / `preload.ts` / `ipc-channels.ts` ——
  copyImageToClipboard / showInFolder / testConnection / image:generated。
- `packages/ui/src/lib/clipboard.ts` —— copyImageFile(path)。
- `packages/ui/src/components/ConversationTurn.tsx` 或 ChatView —— 挂载 GeneratedImageCard。
- 设置页组件 —— 图像生成模型区块。

## 验证

- `pnpm --filter @jdcagnet/core test`（image-api-client + image-tools）。
- `tsc --noEmit`（core / electron / ui）。
- 手动：配置图像模型 → 让模型生成一张透明图标（确认落盘 + 透明 + 复制按钮无损）→
  让模型"根据这张图再生成 3 张" → 发一张参考图让模型基于它编辑。
- 无头环境跑不了真机截图，最后一步需用户实测。

## 不做（边界）

- 不把生成的图字节注入 LLM 上下文（决策 A）。
- 不在对话模型组里混入图像模型（独立配置段，决策 A）。
- 不做生成参数的"默认值配置"——参数全交模型按需传。
- 不做图片编辑器/画布；只做生成 + 编辑 API 调用 + 落盘 + 复制。
- 不限制任务并发数（满足用户要求）；仅单任务内 count 多张做小限流防打爆 API。

## 风险

- 4K 多张 base64 在 worker 内存里可能较大 → 落盘后即释放，不缓存在内存/上下文。
- remote url 下载失败 → 复用参考项目的 downloadError 降级（结果带错误说明，不中断其它张）。
- 参考图落盘到 .jdc-image-input/ 会在项目里产生文件 → 文档提示可加 .gitignore，文件名带时间戳避免冲突。
- 工具仅在 Session 构造时注册 → 配置后需新会话生效，设置页需提示（与 MCP 一致）。
