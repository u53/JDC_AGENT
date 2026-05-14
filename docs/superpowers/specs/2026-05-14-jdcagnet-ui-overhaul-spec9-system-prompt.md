# Spec 9: 系统提示词增强

## 目标

重构系统提示词为带缓存标记的分段结构，支持 provider 级别的 prompt caching。新增 system reminders 机制防止模型在长对话中遗忘指令。新增语言偏好和 custom instructions 配置。注入 MCP server instructions。

## 架构

`assembleSystemPrompt()` 从返回 `string` 改为返回 `PromptSegment[]`。每个 segment 标记是否可缓存。Provider 层各自决定如何利用缓存标记。新增 system reminder 注入逻辑在 tool_result 消息中。

## Prompt 分段结构

```typescript
interface PromptSegment {
  content: string
  cacheable: boolean
}
```

分段划分：

| 段 | cacheable | 内容 |
|----|-----------|------|
| identity + system + tools + coding + git-rules + safety | true | 核心指令，启动后不变 |
| MCP section（tools + server instructions） | true | MCP 连接后不变 |
| skills listing | true | 启动后不变 |
| memory index | true | 会话内不变 |
| global instructions + project instructions + rules | true | 启动后不变 |
| language + custom instructions | true | 配置后不变 |
| git status + date | false | 每次可能变化 |

## Provider 层缓存适配

**Anthropic:**
- `system` 参数改为 content blocks 数组
- cacheable 段加 `cache_control: { type: 'ephemeral' }`
- 非 cacheable 段不加标记

```typescript
// Anthropic system parameter
system: segments.map(seg => ({
  type: 'text',
  text: seg.content,
  ...(seg.cacheable ? { cache_control: { type: 'ephemeral' } } : {}),
}))
```

**OpenAI Chat / Responses:**
- 所有段拼接为单一 system message 字符串（OpenAI 自动缓存，不需要显式标记）
- 拼接时用 `\n\n---\n\n` 分隔（保持现有格式）

## System Reminders

### 触发时机

每次 tool_result 消息组装时，在 content 末尾追加 reminder 文本。

### 注入位置

在 `session.ts` 的 `runLoop` 中，组装 `toolResults` 数组时，给每个 tool_result 的 content 追加 reminder。

### Reminder 内容

```
<system-reminder>
当前日期: {YYYY-MM-DD}
{language ? `语言: ${languageLabel}` : ''}
{customInstructions ? customInstructions : ''}
</system-reminder>
```

### 条件

- 只在有语言偏好或 custom instructions 配置时注入
- 如果两者都没配置，不注入（避免无意义的空 reminder）
- Reminder 文本追加在 tool_result content 末尾，用 `\n\n` 分隔

## MCP Server Instructions

### 来源

MCP 协议的 `initialize` 响应中包含可选的 `instructions` 字段。

### 获取方式

`McpManager` 在连接 server 时，从 initialize 响应中提取 `instructions` 字段并保存到 server state。

### 注入方式

在 system prompt 的 MCP section 中，每个 server 的信息扩展为：

```
## MCP Server: {serverName}
Tools: tool1, tool2, ...
{server.instructions ? `\nInstructions: ${server.instructions}` : ''}
```

## 语言偏好 + Custom Instructions

### 存储

app config（`~/.jdcagnet/config.json`）：

```json
{
  "language": "zh-CN",
  "customInstructions": "回复简洁，代码不加注释"
}
```

### 注入到 System Prompt

作为独立的 cacheable segment：

```
# User Preferences

Language: 中文 (zh-CN)

Custom Instructions:
回复简洁，代码不加注释
```

如果没有配置则不生成此段。

### 语言标签映射

```typescript
const LANGUAGE_LABELS: Record<string, string> = {
  'zh-CN': '中文',
  'en': 'English',
  'ja': '日本語',
  'ko': '한국어',
}
```

不在映射中的值直接使用原始字符串。

## 接口变更

```typescript
// context.ts
interface ContextOptions {
  cwd: string
  toolDefs: ToolDefinition[]
  toolNames: string[]
  mcpServers?: { name: string; toolCount: number; tools?: string[]; instructions?: string }[]
  permissionMode?: string
  skills?: { name: string; description: string }[]
  language?: string
  customInstructions?: string
}

function assembleSystemPrompt(opts: ContextOptions): Promise<PromptSegment[]>
```

```typescript
// types.ts — ModelConfig
interface ModelConfig {
  // ... existing fields
  systemPrompt?: string | PromptSegment[]  // 兼容两种格式
}
```

```typescript
// providers — 各 provider 处理 systemPrompt
// Anthropic: PromptSegment[] → cache_control content blocks
// OpenAI: PromptSegment[] → joined string
// 如果是 string（兼容旧代码）→ 直接使用
```

## 文件变动

- **重构**: `packages/core/src/context.ts` — 返回 PromptSegment[]，新增 language/customInstructions 段
- **修改**: `packages/core/src/types.ts` — PromptSegment 类型，ModelConfig.systemPrompt 兼容
- **修改**: `packages/core/src/providers/anthropic.ts` — 处理 PromptSegment[]，加 cache_control
- **修改**: `packages/core/src/providers/openai-chat.ts` — PromptSegment[] 拼接为 string
- **修改**: `packages/core/src/providers/openai-responses.ts` — 同上
- **修改**: `packages/core/src/session.ts` — tool_result 注入 system reminder + 传递 language/customInstructions
- **修改**: `packages/core/src/mcp/` — 保存 server instructions 到 state
- **修改**: `packages/core/src/base-prompt.ts` — getMcpSection 支持 instructions 字段

## 不做的事

- 不做 Hooks section（模型不需要提前知道）
- 不做 prompt 热重载（重启会话生效）
- 不做 prompt 预览 UI
- 不做 per-session 语言/风格配置
- 不做 reminder 频率控制（每次都注入）
