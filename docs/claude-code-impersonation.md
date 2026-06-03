# Claude Code 请求伪装指南

## 背景

部分中转站（如 85api.com）会验证请求是否来自真正的 Claude Code CLI 客户端。本文档记录了完整的伪装方案，可用于后续网关开发。

---

## 验证机制总结

中转站从以下维度验证请求：

| 层级 | 检查项 | 不通过的表现 |
|------|--------|-------------|
| HTTP Headers | User-Agent、x-app、anthropic-beta 等 | 403 "请使用标准 Claude Code 客户端" |
| URL | `/v1/messages?beta=true` | 403 |
| Body - tool names | 必须是 PascalCase（`Bash`, `Read`, `Edit`） | 403 "客户端异常" |
| Body - thinking | 必须是 `{"type": "adaptive"}` | 403 "指纹不正确" |
| Body - system prompt | 第一个 block 必须是 billing header | 403 "指纹不正确" |
| Body - system blocks 数量 | 不能超过约 4-5 个 | 400 "Upstream request error" |

---

## 完整伪装方案

### 1. URL

```
POST {baseURL}/v1/messages?beta=true
```

注意 `?beta=true` 是 SDK `anthropic.beta.messages.create()` 自动加的。

### 2. HTTP Headers

```http
Content-Type: application/json
x-api-key: {apiKey}
anthropic-version: 2023-06-01
anthropic-beta: interleaved-thinking-2025-05-14,claude-code-20250219,context-1m-2025-08-07,token-efficient-tools-2026-03-28,structured-outputs-2025-12-15,effort-2025-11-24,prompt-caching-scope-2026-01-05
User-Agent: claude-cli/2.1.139 (consumer, cli)
x-app: cli
X-Claude-Code-Session-Id: {uuid}
x-client-request-id: {uuid}
X-Stainless-Lang: js
X-Stainless-Package-Version: 0.39.0
X-Stainless-OS: {platform}
X-Stainless-Arch: {arch}
X-Stainless-Runtime: node
X-Stainless-Runtime-Version: {nodeVersion}
x-stainless-retry-count: 0
```

关键点：
- `User-Agent` 格式为 `claude-cli/{version} (consumer, cli)`
- `anthropic-beta` 中 `claude-code-20250219` 是核心标识
- `X-Stainless-*` 系列头是 Anthropic SDK 自动注入的
- **betas 通过 header 传递，不放在 body 里**

### 3. Request Body - System Prompt

```json
{
  "system": [
    {
      "type": "text",
      "text": "x-anthropic-billing-header: cc_version={version}.{fingerprint}; cc_entrypoint=cli; cch={hash};"
    },
    {
      "type": "text",
      "text": "You are Claude Code, Anthropic's official CLI for Claude.\n\n{其余所有 system prompt 内容合并在这里}",
      "cache_control": {"type": "ephemeral"}
    }
  ]
}
```

关键点：
- **最多 2-3 个 system blocks**，多了会被上游拒绝
- 第一个 block 是 billing header，**不带 cache_control**
- 第二个 block 以 CLI prefix 开头，带 `cache_control`
- 所有自定义 system prompt 内容合并到第二个 block 里

### 4. Fingerprint 计算

```javascript
import { createHash } from 'crypto'

const FINGERPRINT_SALT = '59cf53e54c78'
const CC_VERSION = '2.1.139'

function computeFingerprint(firstUserMessageText) {
  const indices = [4, 7, 20]
  const chars = indices.map(i => firstUserMessageText[i] || '0').join('')
  const hash = createHash('sha256')
    .update(`${FINGERPRINT_SALT}${chars}${CC_VERSION}`)
    .digest('hex')
  return hash.slice(0, 3)
}
```

- 取第一条 user message 的 text 内容
- 提取第 4、7、20 位字符（不存在则用 '0'）
- SHA256(salt + chars + version) 取前 3 位 hex

### 5. CCH (Client Code Hash)

```javascript
// 生成随机 5 位 hex（不能是 '00000'）
const cch = createHash('sha256')
  .update(`${Date.now()}${Math.random()}`)
  .digest('hex')
  .slice(0, 5)
```

- 真实 Claude Code 中 `cch=00000` 是占位符，由 Bun 原生 HTTP 层替换为计算值
- 中转站检查 cch 存在且非零即可
- Anthropic 官方 API 可能会验证 cch 的正确性，但中转站不会（没有密钥）

### 6. Body - Thinking

```json
{
  "thinking": {"type": "adaptive"}
}
```

- **必须是 `adaptive`**，不能是 `{"type": "enabled", "budget_tokens": N}`
- Claude Code 对所有新模型（Opus 4、Sonnet 4 等）都用 adaptive thinking
- 设置 thinking 后不能传 temperature

### 7. Body - Tool Names（PascalCase）

| Claude Code 工具名 | 说明 |
|---|---|
| `Bash` | 执行命令 |
| `Read` | 读文件 |
| `Write` | 写文件 |
| `Edit` | 编辑文件 |
| `MultiEdit` | 批量编辑 |
| `Glob` | 文件搜索 |
| `Grep` | 内容搜索 |
| `LS` | 列目录 |
| `Tree` | 目录树 |
| `NotebookEdit` | Notebook 编辑 |
| `WebFetch` | 网页抓取 |
| `WebSearch` | 网页搜索 |
| `LSP` | 语言服务 |
| `Monitor` | 监控 |
| `Agent` | 子代理 |
| `TodoWrite` | 待办 |
| `TaskCreate` | 创建任务 |
| `TaskUpdate` | 更新任务 |
| `TaskList` | 列出任务 |
| `TaskGet` | 获取任务 |
| `TaskStop` | 停止任务 |
| `TaskOutput` | 任务输出 |
| `EnterPlanMode` | 进入计划模式 |
| `ExitPlanMode` | 退出计划模式 |
| `AskUser` | 询问用户 |
| `Notify` | 通知 |
| `Skill` | 技能调用 |

### 8. Body - Metadata

```json
{
  "metadata": {
    "user_id": "{\"device_id\":\"uuid\",\"account_uuid\":\"\",\"session_id\":\"uuid\"}"
  }
}
```

`user_id` 是一个 JSON 字符串，包含 device_id 和 session_id。

### 9. Body - 其他字段

```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 8000,
  "stream": true,
  "messages": [...],
  "tools": [...]
}
```

- `max_tokens` Claude Code 默认 8000（有 cap）
- **不要在 body 里放 `betas` 字段**（SDK 会把它提取到 header）

---

## 完整请求示例

```bash
curl -X POST "https://api.example.com/v1/messages?beta=true" \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk-xxx" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: interleaved-thinking-2025-05-14,claude-code-20250219,context-1m-2025-08-07,token-efficient-tools-2026-03-28,structured-outputs-2025-12-15,effort-2025-11-24,prompt-caching-scope-2026-01-05" \
  -H "User-Agent: claude-cli/2.1.139 (consumer, cli)" \
  -H "x-app: cli" \
  -H "X-Claude-Code-Session-Id: $(uuidgen)" \
  -H "x-client-request-id: $(uuidgen)" \
  -H "X-Stainless-Lang: js" \
  -H "X-Stainless-Package-Version: 0.39.0" \
  -H "X-Stainless-OS: darwin" \
  -H "X-Stainless-Arch: arm64" \
  -H "X-Stainless-Runtime: node" \
  -H "X-Stainless-Runtime-Version: v22.12.0" \
  -H "x-stainless-retry-count: 0" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 8000,
    "system": [
      {"type": "text", "text": "x-anthropic-billing-header: cc_version=2.1.139.{fp}; cc_entrypoint=cli; cch={hash};"},
      {"type": "text", "text": "You are Claude Code, Anthropic'\''s official CLI for Claude.\n\n...", "cache_control": {"type": "ephemeral"}}
    ],
    "messages": [{"role": "user", "content": [{"type": "text", "text": "hello"}]}],
    "tools": [{"name": "Bash", "description": "...", "input_schema": {...}}],
    "thinking": {"type": "adaptive"},
    "stream": true,
    "metadata": {"user_id": "{\"device_id\":\"uuid\",\"account_uuid\":\"\",\"session_id\":\"uuid\"}"}
  }'
```

---

## 踩坑记录

1. **tool names 用 snake_case** → 403，中转站白名单只认 PascalCase
2. **thinking 用 `enabled` + `budget_tokens`** → 403，必须用 `adaptive`
3. **betas 放在 body 里** → 403，SDK 会把 betas 从 body 提取到 header
4. **URL 不带 `?beta=true`** → 可能被检测为非 SDK 请求
5. **system blocks 超过 4-5 个** → 400 Upstream error，需要合并成 2 个
6. **fingerprint 计算错误** → 403 "指纹不正确"
7. **cch=00000（未替换的占位符）** → 可能被检测为非真实客户端
8. **版本号太旧** → 可能被版本白名单拒绝，用最新版本号

---

## 网关开发建议

如果要做一个通用网关，核心逻辑是：

1. 接收标准 Anthropic API 请求
2. 注入 Claude Code 伪装 headers
3. 改写 URL 加 `?beta=true`
4. 改写 body：
   - 注入 billing header 到 system[0]
   - 合并 system blocks 为 2 个
   - 确保 tool names 是 PascalCase
   - 强制 `thinking: {type: "adaptive"}`
   - 添加 metadata
   - 移除 body 中的 betas 字段（如果有）
5. 转发到上游中转站
