# Spec 5: 文件操作增强

## 目标

为 JDCAGNET 添加完整的文件变更追踪系统：修改前自动备份、per-turn diff 展示、rewind 回退、session 级变更列表、commit attribution。

## 架构

```
file_edit / file_write 工具
  → FileTracker.beforeWrite(filePath) 保存快照
  → 执行写入
  → FileTracker.afterWrite(filePath) 记录变更
    → 存入 SQLite (file_snapshots 表)
    → 推送 file:changed 事件到前端

前端:
  → FileChangesPanel 展示本 session 所有变更文件
  → Per-turn diff 视图（点击文件查看 before/after）
  → Rewind 按钮（恢复到任意快照点）
  → Commit helper（列出变更文件用于 git commit）
```

## 1. FileTracker（packages/core）

新文件 `packages/core/src/file-tracker.ts`

### 数据模型

```typescript
interface FileSnapshot {
  id: string
  sessionId: string
  filePath: string
  contentBefore: string | null  // null = 新建文件
  contentAfter: string
  toolUseId: string
  turnIndex: number
  timestamp: number
}

interface FileChange {
  filePath: string
  changeType: 'created' | 'modified'
  snapshotCount: number
  lastModified: number
}
```

### 核心方法

```typescript
class FileTracker {
  constructor(history: ConversationHistory, sessionId: string)

  // 在 file_edit/file_write 执行前调用
  async captureBeforeState(filePath: string): Promise<string | null>

  // 在 file_edit/file_write 执行后调用
  async recordChange(filePath: string, contentBefore: string | null, toolUseId: string, turnIndex: number): Promise<void>

  // 获取 session 所有变更文件列表
  getChangedFiles(): FileChange[]

  // 获取某文件的所有快照历史
  getFileHistory(filePath: string): FileSnapshot[]

  // 回退文件到指定快照
  async rewindFile(snapshotId: string): Promise<void>

  // 回退所有文件到指定 turn
  async rewindToTurn(turnIndex: number): Promise<void>

  // 获取指定 turn 的 diff 列表
  getTurnDiffs(turnIndex: number): FileSnapshot[]
}
```

## 2. SQLite Schema 扩展

在 `history.ts` 的 migrate 中添加：

```sql
CREATE TABLE IF NOT EXISTS file_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content_before TEXT,
  content_after TEXT NOT NULL,
  tool_use_id TEXT NOT NULL,
  turn_index INTEGER NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_snapshots_session ON file_snapshots(session_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_snapshots_file ON file_snapshots(session_id, file_path);
```

## 3. 工具集成

修改 `file_edit` 和 `file_write`：
- 执行写入前：读取文件当前内容作为 `contentBefore`
- 执行写入后：调用 `FileTracker.recordChange()`
- 通过 ToolContext 传入 FileTracker 引用

### ToolContext 扩展

```typescript
interface ToolContext {
  // ...existing
  fileTracker?: FileTracker
  turnIndex?: number
}
```

## 4. Session 集成

- Session 持有 FileTracker 实例
- 在 runLoop 中维护 turnIndex 计数器
- 创建 ToolRunner 时传入 fileTracker
- 每个 turn 开始时 turnIndex++

## 5. IPC 事件

- `file:changed` — 文件变更通知（sessionId, filePath, changeType）
- `session:get-file-changes` — 获取 session 变更文件列表（invoke）
- `session:get-file-history` — 获取文件快照历史（invoke）
- `session:rewind-file` — 回退单个文件（invoke）
- `session:rewind-turn` — 回退到指定 turn（invoke）

## 6. 前端组件

### FileChangesPanel

位置：ChatView 底部或侧边可展开面板

内容：
- 本 session 所有被修改的文件列表
- 每个文件显示：路径、变更类型（新建/修改）、修改次数
- 点击文件展开 diff 视图（before/after 对比）
- Rewind 按钮（恢复到修改前）

### Per-Turn Diff

在 tool card 完成后，显示该 turn 修改了哪些文件的摘要：
- `CHANGED: 3 files (src/a.ts, src/b.ts, +1 new)`

### Commit Helper

- `/commit` 斜杠命令
- 列出所有变更文件
- 生成建议的 git add 命令
- 可选：自动生成 commit message

## 7. Diff 展示

使用简单的行级 diff（不引入外部库）：
- 对比 contentBefore 和 contentAfter
- 显示 added/removed 行数
- 展开时显示完整 unified diff 格式

或者使用 `diff` 命令行工具生成 unified diff。

## 文件清单

**新建：**
- `packages/core/src/file-tracker.ts` — FileTracker 类
- `packages/ui/src/components/FileChangesPanel.tsx` — 变更文件面板

**修改：**
- `packages/core/src/history.ts` — 添加 file_snapshots 表 + CRUD 方法
- `packages/core/src/tool-registry.ts` — ToolContext 添加 fileTracker/turnIndex
- `packages/core/src/tools/file-edit.ts` — 集成快照
- `packages/core/src/tools/file-write.ts` — 集成快照
- `packages/core/src/session.ts` — 持有 FileTracker，传入 ToolRunner
- `packages/electron/src/session-manager.ts` — 转发 file 事件 + 新 IPC handlers
- `packages/electron/src/ipc-handlers.ts` — 新增 file 相关 handlers
- `packages/ui/src/components/ChatView.tsx` — 集成 FileChangesPanel
- `packages/ui/src/components/tool-cards/FileEditCard.tsx` — 显示 diff 摘要

## 非目标

- 二进制文件追踪（只追踪文本文件）
- 跨 session 文件历史（每个 session 独立）
- 实时文件监控（只追踪通过工具的修改）
