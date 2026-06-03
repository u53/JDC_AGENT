# Spec 10: 会话管理增强

## 目标

添加 /stats 统计命令、改善 /compact 交互反馈、在 compact 时自动提取持久记忆。

## 功能范围

1. `/stats` 斜杠命令 — 显示会话统计卡片
2. `/compact` 反馈增强 — 压缩时显示进度和完成提示
3. 自动记忆提取 — compact 时从即将丢弃的消息中提取关键记忆

## 1. /stats 命令

### 行为

用户输入 `/stats`，在聊天中插入一个统计卡片（不发送给 AI），显示：

- 会话轮次数
- Token 用量（input / output / total）
- 缓存命中率
- 上下文占用百分比
- 文件变更数
- 会话时长（从 session 创建时间到现在）

### 数据来源

- `UsageTracker.getSnapshot()` — token 用量、缓存率、上下文占用
- `FileTracker.getChangedFiles()` — 文件变更数
- Session metadata（createdAt）— 会话时长

### 实现方式

在 ChatView 的斜杠命令处理中，`/stats` 不走 IPC 发消息给 AI，而是：
1. 通过 IPC 获取统计数据（复用现有的 usage + file changes 接口）
2. 在本地 UI 消息列表中插入一个特殊的 "stats" 类型消息
3. 渲染为统计卡片组件

## 2. /compact 反馈增强

### 当前问题

compact 执行时用户没有明确的视觉反馈，不知道发生了什么。

### 目标行为（参考 Claude Code）

- 压缩开始：显示系统提示 `[Compressing context...]`
- 压缩完成：显示完成卡片 `[Context compressed: 从 X 条消息压缩为摘要 + 保留最近 6 条]`

### 实现方式

- compact 开始时：已有 `events.onStreamChunk({ type: 'text_delta', text: '\n[Compressing context...]\n' })`
- compact 完成后：发送一个新的 StreamChunk 类型 `compact_complete`，携带压缩统计：

```typescript
// 新增 StreamChunk type
type: 'compact_complete'
compactInfo?: {
  originalCount: number   // 压缩前消息数
  keptCount: number       // 保留的最近消息数
  memoriesExtracted: number  // 提取的记忆数
}
```

- 前端收到 `compact_complete` 时，渲染为一个系统消息卡片（独立样式，不混入 AI 回复）

## 3. 自动记忆提取

### 触发时机

`compactMessages()` 执行时，在生成摘要的同时提取记忆。

### 提取方式

在 compact prompt 末尾追加记忆提取指令：

```
Additionally, extract any persistent memories worth saving for future sessions.
Only extract:
- User preferences and feedback about how to work (type: "feedback")
- Project decisions and context not derivable from code (type: "project")

Output in <memories> tags as JSON array:
[{"name": "slug-name", "type": "feedback|project", "description": "one line summary", "content": "memory content"}]

If nothing worth saving, output <memories>[]</memories>
```

### 解析和保存

compact 完成后：
1. 从模型输出中解析 `<memories>` 标签内容
2. JSON.parse 得到记忆数组
3. 对每条记忆：
   - 检查 `{memDir}/{name}.md` 是否已存在，存在则跳过
   - 写入 memory 文件（frontmatter + content 格式）
   - 追加一行到 `MEMORY.md` 索引

### Memory 文件格式

```markdown
---
name: {name}
description: {description}
metadata:
  type: {type}
  extractedAt: {ISO date}
  sessionId: {session id}
---

{content}
```

### 去重策略

写入前检查同名文件是否存在。存在则跳过，不覆盖。

### 新增模块

`packages/core/src/memory-extractor.ts` — 独立模块负责：
- 解析 `<memories>` 标签
- 写入 memory 文件
- 更新 MEMORY.md 索引
- 去重检查

## 文件变动

- **新增**: `packages/core/src/memory-extractor.ts` — 记忆解析 + 写入
- **修改**: `packages/core/src/compact.ts` — 追加记忆提取 prompt + 解析 memories + 返回统计
- **修改**: `packages/core/src/session.ts` — compact 后调用 memory extractor + 发送 compact_complete
- **修改**: `packages/core/src/types.ts` — StreamChunk 新增 compact_complete + compactInfo
- **修改**: `packages/ui/src/components/SlashCommandMenu.tsx` — 添加 /stats
- **修改**: `packages/ui/src/components/ChatView.tsx` — /stats 处理 + compact 完成卡片
- **新增**: `packages/ui/src/components/StatsCard.tsx` — 统计卡片组件
- **新增**: `packages/ui/src/components/CompactCard.tsx` — 压缩完成卡片组件

## 不做的事

- 不做 Away summary
- 不做 Session resume 额外增强
- 不做记忆编辑 UI
- 不做记忆冲突合并（同名跳过）
- 不做定时记忆提取（只在 compact 时）
- 不做记忆数量限制
