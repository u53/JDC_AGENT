# Spec 3: 错误处理 + 重试 + 恢复

## 目标

实现 API 错误自动重试、Rate limit 智能等待、网络断连恢复、一键重试、Prompt too long 自动压缩。

## 当前状态

- 错误通过 `query:error` IPC 发送到前端，前端调用 `clearSessionStreamState`
- 没有重试逻辑——任何 API 错误直接终止
- 前端没有错误展示组件（错误后 streaming 状态清除，用户看不到发生了什么）
- Session 的 `runLoop` 有 try-catch 但只是 `events.onError(err)` 然后 break

## 架构

### 后端：重试层

在 provider 调用外包一层 `withRetry` 逻辑：

```
Session.runLoop
  → provider.stream(messages, tools, config, signal)
    → withRetry wrapper
      → 实际 API 调用
      → 失败 → 判断是否可重试
        → 可重试 → 等待 → 重试（指数退避）
        → 不可重试 → 抛出
```

### 可重试错误类型

| 错误 | 重试策略 |
|------|---------|
| 429 Rate Limit | 等待 retry-after header 或指数退避，最多 5 次 |
| 502/503/504 Gateway | 指数退避，最多 3 次 |
| 529 Overloaded | 指数退避，最多 3 次 |
| ECONNRESET/EPIPE | 立即重试 1 次 |
| Request timeout | 立即重试 1 次 |
| Prompt too long | 触发压缩，然后重试 1 次 |

### 不可重试

| 错误 | 处理 |
|------|------|
| 400 Bad Request | 直接报错 |
| 401 Unauthorized | 直接报错 |
| 403 Forbidden | 直接报错 |
| 422 Unprocessable | 直接报错 |

### 前端：错误展示

新增 `ErrorCard` 组件，在对话中显示错误信息：
- 错误类型 + 消息
- 重试倒计时（如果正在自动重试）
- [重试] 按钮（手动重试最后一条消息）
- Rate limit 时显示等待时间

### IPC 事件扩展

```typescript
// 现有 query:error 增强
interface QueryErrorEvent {
  sessionId: string
  error: string
  errorType: 'api' | 'network' | 'rate_limit' | 'prompt_too_long' | 'unknown'
  retrying: boolean
  retryIn?: number      // ms until next retry
  retryAttempt?: number // current attempt number
  maxRetries?: number
}
```

## 文件结构

```
packages/core/src/retry.ts                    — withRetry 逻辑 + 错误分类
packages/core/src/session.ts                  — runLoop 集成重试，prompt-too-long 触发压缩

packages/electron/src/session-manager.ts      — 转发增强的错误事件

packages/ui/src/components/ErrorCard.tsx       — 错误展示组件
packages/ui/src/components/ChatView.tsx        — 集成 ErrorCard + 重试按钮
packages/ui/src/stores/session-store.ts       — 增加 lastError 状态
```

## 不在此 Spec 范围内

- OAuth token 刷新
- 企业级 persistent retry
- Fast mode cooldown
