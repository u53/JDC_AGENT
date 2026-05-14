# Spec 11b: 能力增强（System Prompt + Background Tasks + Edit + Notifications + Token）

## 概述

5 项独立增强，对齐 Claude Code 的工具能力和行为质量。

## 1. System Prompt 深化

### 1.1 行为 Examples

在 `base-prompt.ts` 的关键 section 中加入 `<examples>` 标签，展示正确/错误行为对比：

- **失败循环检测**：两次相同方法失败后必须换方向，不能无限微调
- **确认 vs 直接做**：简单改动直接做，高风险操作先确认
- **Plan vs Act**：何时规划何时直接执行

### 1.2 验证流程

加入验证要求：
- 代码修改后必须跑 build（`node packages/electron/build.mjs`）
- 如果 build 不跑测试，单独跑相关测试
- 验证失败必须修复后才能报告完成
- 安全敏感改动需声明验证了什么、未验证什么

### 1.3 Git 安全协议

加入 Git 规则：
- 从不 amend 已 push 的 commit
- 从不 force push 到 main/master
- Commit message 用 HEREDOC 格式
- 优先 stage 具体文件而非 `git add .`
- 不跳过 hooks（--no-verify）
- 不用交互式 git 命令（-i）

### 1.4 Compaction 后行为指导

加入上下文压缩后的行为规则：
- 压缩后重新确认当前位置（读文件/跑命令确认状态）
- 不依赖压缩前的记忆
- 继续工作而非停下来

## 2. Background Tasks

### 2.1 Bash run_in_background

`bash` tool 的 input schema 加 `run_in_background: boolean` 参数：
- true 时用 `child_process.spawn` detach 模式执行
- 返回 `task_id` 而非等待完成
- 进程输出写入临时文件 `{configDir}/tasks/{task_id}.log`

### 2.2 BackgroundTaskManager

新建 `packages/core/src/background-tasks.ts`：

```typescript
interface BackgroundTask {
  id: string
  command: string
  pid: number
  status: 'running' | 'completed' | 'failed'
  exitCode?: number
  logFile: string
  startedAt: number
}
```

方法：
- `spawn(command, cwd, signal?)` → BackgroundTask
- `getTask(id)` → BackgroundTask | undefined
- `getOutput(id, tail?: number)` → string
- `stop(id)` → void
- `listRunning()` → BackgroundTask[]

### 2.3 task_output tool

新 tool，查看后台任务输出：

```typescript
{
  name: 'task_output',
  inputSchema: {
    properties: {
      task_id: { type: 'string' },
      tail: { type: 'number', description: 'Only return last N lines (default: all)' }
    },
    required: ['task_id']
  }
}
```

返回任务状态 + 输出内容。

### 2.4 Monitor tool

新 tool，持续监控长时间进程：

```typescript
{
  name: 'monitor',
  inputSchema: {
    properties: {
      command: { type: 'string', description: 'Shell command to run. Each stdout line is an event.' },
      description: { type: 'string', description: 'What you are monitoring' },
      timeout_ms: { type: 'number', description: 'Kill after this time (default: 300000)' }
    },
    required: ['command', 'description']
  }
}
```

实现：
- spawn 进程，每行 stdout 通过 `onProgress` 回调推送给模型
- 进程退出或超时后返回最终结果
- 前端显示为 tool card，实时更新事件

### 2.5 task_stop tool 增强

现有 `task_stop` tool 扩展为也能停止后台 bash 任务和 monitor：

```typescript
// 输入加 task_id 参数
{ task_id: { type: 'string', description: 'Background task or monitor ID to stop' } }
```

## 3. Edit 增强

### 3.1 replace_all 参数

`file_edit` tool 加 `replace_all: boolean` 参数：
- false（默认）：当前行为，old_string 必须唯一
- true：替换所有出现的 old_string，返回替换了多少处

### 3.2 multi_edit tool

新 tool，单文件多处修改：

```typescript
{
  name: 'multi_edit',
  inputSchema: {
    properties: {
      file_path: { type: 'string' },
      edits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            old_string: { type: 'string' },
            new_string: { type: 'string' }
          },
          required: ['old_string', 'new_string']
        }
      }
    },
    required: ['file_path', 'edits']
  }
}
```

实现：按顺序应用所有 edits，每个 edit 的 old_string 必须在当前内容中唯一。如果任何一个 edit 失败，整个操作回滚（原子性）。

## 4. Push Notifications

### 4.1 Electron Notification

新 tool `notify`：

```typescript
{
  name: 'notify',
  inputSchema: {
    properties: {
      message: { type: 'string', description: 'Notification body (max 200 chars)' }
    },
    required: ['message']
  }
}
```

实现：
- 通过 IPC 调用 Electron 的 `Notification` API
- 只在长时间任务完成或需要用户注意时使用
- System prompt 指导：不要为常规进度发通知

### 4.2 IPC 通道

- Tool 执行时发送 `notify:show` IPC 到 main process
- Main process 创建 `new Notification({ title: 'JDCAGNET', body: message })`
- 点击通知聚焦窗口

## 5. Token 估算优化

### 5.1 改进算法

替换 `packages/core/src/token-estimation.ts` 的 `chars / 3.5` 为分类估算：

```typescript
export function estimateTokens(messages: Message[]): number {
  let tokens = 0
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === 'text') tokens += estimateTextTokens(block.text)
      else if (block.type === 'tool_use') tokens += estimateTextTokens(JSON.stringify(block.input)) + block.name.length
      else if (block.type === 'tool_result') tokens += estimateTextTokens(block.content)
      else if (block.type === 'image') tokens += 1000
    }
  }
  return tokens
}

function estimateTextTokens(text: string): number {
  let tokens = 0
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (code > 0x4E00 && code < 0x9FFF) {
      tokens += 1.5  // CJK characters ≈ 1-2 tokens
    } else if (code > 0x7F) {
      tokens += 1    // Other non-ASCII ≈ 1 token
    } else {
      tokens += 0.25 // ASCII ≈ 4 chars per token
    }
  }
  return Math.ceil(tokens)
}
```

不引入新依赖，对所有 provider 同样精度（±15% 误差可接受）。

## 6. 文件变更清单

### 新建文件
- `packages/core/src/background-tasks.ts` — BackgroundTaskManager
- `packages/core/src/tools/task-output.ts` — task_output tool
- `packages/core/src/tools/monitor.ts` — monitor tool
- `packages/core/src/tools/multi-edit.ts` — multi_edit tool
- `packages/core/src/tools/notify.ts` — notify tool

### 修改文件
- `packages/core/src/base-prompt.ts` — Examples + 验证 + Git 安全 + Compaction 指导
- `packages/core/src/tools/bash.ts` — run_in_background 参数
- `packages/core/src/tools/file-edit.ts` — replace_all 参数
- `packages/core/src/token-estimation.ts` — 改进算法
- `packages/core/src/tools/index.ts` — 注册新 tools
- `packages/core/src/index.ts` — 导出新类型
- `packages/electron/src/session-manager.ts` — notify IPC
- `packages/electron/src/ipc-channels.ts` — NOTIFY channel
- `packages/electron/src/main.ts` — Notification handler

## 7. 测试策略

- `background-tasks.test.ts` — spawn/stop/getOutput
- `token-estimation.test.ts` — 中英文混合估算精度
- `multi-edit.test.ts` — 多处替换 + 原子回滚
- `file-edit.test.ts` — replace_all 行为
- 手动测试：后台跑 `sleep 5 && echo done`，用 task_output 查看
