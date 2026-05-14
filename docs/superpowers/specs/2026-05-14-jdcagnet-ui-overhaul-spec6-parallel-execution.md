# Spec 6: 并行工具执行 + 流式输出

## 目标

将当前串行的工具执行改为读写分离的并行执行模型，提升多工具调用时的响应速度。

## 架构

新增独立的 `ParallelExecutor` 类（`packages/core/src/parallel-executor.ts`），负责批量工具调度。ToolRunner 保持"执行单个工具"的单一职责不变。Session 中的 `for...of` 循环替换为 `parallelExecutor.executeBatch()` 调用。

## 工具分类

静态分类表，硬编码在 ParallelExecutor 中：

**只读工具（可并行）：**
`file_read`, `glob`, `grep`, `ls`, `tree`, `web_fetch`, `web_search`, `lsp`, `task_get`, `task_list`, `task_stop`, `list_mcp_resources`, `read_mcp_resource`, `skill`

**写工具（必须串行）：**
`bash`, `file_edit`, `file_write`, `notebook_edit`, `todo_write`, `task_create`, `task_update`, `agent`, `ask_user`

**兜底规则：** 未在分类表中的工具（如未来新增的工具）默认视为写工具。

## 执行策略

一批 tool_use blocks 到达时：

1. 按分类表分为 `readOps` 和 `writeOps` 两组
2. 先并行执行所有 `readOps`（最多 5 并发）
3. 再串行执行所有 `writeOps`（按原始顺序逐个执行）
4. 任一工具执行失败（`result.isError === true`）→ 通过共享 AbortController 取消所有未完成的工具
5. 返回所有 tool_result，保持与原始 tool_use blocks 相同的顺序

## 并发控制

最大并发数固定为 5，不暴露配置。使用内部实现的简单 semaphore（不引入外部依赖）。

## 超时控制

- 统一超时：每个工具 120 秒
- 实现方式：`AbortSignal.timeout(120_000)` 与 batch-level AbortSignal 通过 `AbortSignal.any([...])` 组合
- bash 工具内部已有自己的 timeout 参数处理，外层超时作为兜底
- 超时触发时视为失败，触发 batch abort

## 错误中止策略

- 任一工具返回 `isError: true` → 立即调用 `batchAbortController.abort()`
- 已完成的工具：结果保留
- 正在执行的工具：通过 signal 传递 abort（bash kill 进程，其他工具 reject promise）
- 尚未开始的工具：直接返回 `{ content: "Cancelled: sibling tool failed", isError: true }`

## 数据流

```
session.ts sendMessage loop
  → 从 assistantContent 提取 tool_use blocks
  → parallelExecutor.executeBatch(blocks, onEvent, sessionAbortSignal)
    → 分类 read/write
    → 并行执行 reads（semaphore 限制 5 并发，共享 batchAbort）
    → 串行执行 writes（共享 batchAbort）
    → 任一失败 → batchAbort.abort()
    → 返回 ToolBatchResult[]（保持原始顺序）
  → 组装 toolMessage（与现有格式一致）
```

## 接口设计

```typescript
// parallel-executor.ts

interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

interface ToolBatchResult {
  tool_use_id: string
  content: string
  is_error?: boolean
}

class ParallelExecutor {
  constructor(private toolRunner: ToolRunner)

  async executeBatch(
    blocks: ToolUseBlock[],
    onEvent: (event: ToolExecutionEvent) => void,
    signal?: AbortSignal
  ): Promise<ToolBatchResult[]>
}
```

## Bash 流式输出（附带项）

后端已有支持：`bash.ts` 在 `proc.stdout.on('data')` 时调用 `context.onProgress()`，触发 `ToolExecutionEvent { type: 'progress' }`。

前端需要在工具事件渲染中处理 `type: 'progress'` 事件，逐行显示 bash 输出。这是 UI 层改动，不影响核心并行执行架构。

## 文件变动

- **新增**: `packages/core/src/parallel-executor.ts` — ParallelExecutor 类 + semaphore 实现
- **修改**: `packages/core/src/session.ts` — 替换 for 循环为 executeBatch 调用
- **修改**: `packages/core/src/index.ts` — 导出 ParallelExecutor（如需要）
- **不改**: `tool-runner.ts`、各工具实现文件

## 不做的事

- 不暴露并发数配置
- 不引入外部依赖（p-limit 等）
- 不改变 ToolRunner 接口
- 不改变各工具的实现
- 不做动态 read/write 分类（如让 AI 标记）
- 不做工具间依赖分析
