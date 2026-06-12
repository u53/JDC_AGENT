# JDC Context Engine 5 分钟快照缓存设计

## 背景

JDC Context Engine 当前会在主会话、子会话、Team PM 等请求前调用 `buildContextBundle()`，再把渲染后的 `<jdc-context-engine>` 片段追加到 `systemPrompt`。这保持了 Engine 的动态性，但也让 provider 端缓存不稳定：同一轮工作中，即便用户仍在处理同一个任务，Engine 内容也可能因为 git、runtime、provider health、时间戳、诊断等细微变化而改变。

Anthropic 受影响最明显。当前 Anthropic stream prompt 会把稳定 system 内容合并为 cacheable block，把 JDC Context Engine 动态段作为非 cacheable block 放在后面。动态段每轮变化不会直接标记 cache_control，但仍会增加请求差异，降低短时间连续请求的缓存收益，也会让同一任务的上下文表现更抖。

用户希望为 JDC Context Engine 存入 5 分钟快照：5 分钟内同一请求语义对应的 Engine 内容不允许变化，并继续像现在一样拼到 system 中。

## 目标

- 为 JDC Context Engine 注入内容增加 5 分钟短期快照。
- 5 分钟内命中同一项目、同一 actor、同一 mode、同一归一化用户意图的请求时，复用完全相同的 rendered prompt。
- 继续通过 `appendContextPromptSegment()` 把 `<jdc-context-engine>` 片段拼进 `systemPrompt`，保持现有 provider 语义。
- 不引入 Engine token 小上限，不截断、不摘要、不减少 Engine 的 relevance-first 选择能力。
- 不改变 Anthropic/OpenAI request shape，不新增 cache_control breakpoint。
- Context Engine 失败仍然降级为无注入或原 system prompt，不能阻断 runLoop。

## 非目标

- 不把所有 context 变成长期持久缓存。
- 不把 5 分钟快照作为 durable memory 或 accepted fact。
- 不改变 `.jdcagnet/context-engine/context.db` 的事实、证据、harvest 生命周期。
- 不在本设计中实现 provider overflow retry。
- 不把 Engine 段标为 `cacheable: true`。这可以作为后续优化单独评估。

## 推荐方案

在 Context Engine 注入边界增加一个进程内 `ContextPromptSnapshotCache`，缓存 `buildContextBundle()` 的最终结果，核心值是 rendered prompt。

缓存位置在调用者与 `buildContextBundle()` 之间，而不是 provider adapter 中：

- 主会话：`Session.injectContextForRunLoop()` 使用快照。
- 子会话：`buildSubSessionContextPrompt()` 使用同一个 helper。
- Team PM：`TeamManagerAI.buildPMSystemPrompt()` 使用同一个 helper。

命中快照时不重新调用 providers，不重新组 bundle，不保存新的 bundle snapshot，直接复用 cached `renderedPrompt` 并追加到 system prompt。未命中或过期时，按现有流程调用 `buildContextBundle()`，并把非空 `renderedPrompt` 写入快照。

## 快照粒度

快照 key 使用以下字段：

```text
projectRoot + actorKey + mode + normalizedIntentHash + modelFamilyKey
```

字段定义：

- `projectRoot`：使用 request 的 `cwd`，按现有项目根规范化逻辑处理。不同项目绝不共享快照。
- `actorKey`：由 actor profile 推导。主会话使用 `session:<sessionId>`；子会话使用 `sub:<subSessionId>` 或 `agent:<agentType>`；Team PM 使用 `team-pm:<teamId>`。没有 actor profile 时回退到 `session:<sessionId>`。
- `mode`：`chat`、`plan`、`review` 等 Context Engine mode。
- `normalizedIntentHash`：归一化后的用户意图 hash。归一化规则为 trim、压缩空白、转小写、保留前后语义文本，不包含时间戳和随机 ID。
- `modelFamilyKey`：优先使用 provider protocol + model id。不同模型可能有不同能力 profile 和 context behavior，不共享快照。

TTL 固定为 5 分钟，默认不可配置。后续如需调试开关，可只在 Context Engine debug config 中暴露，不进入普通 UI。

## 快照内容

最小缓存值：

```ts
interface ContextPromptSnapshot {
  key: string
  renderedPrompt: string
  bundleId?: string
  createdAt: number
  expiresAt: number
  source: 'fresh'
}
```

实现时可以额外缓存轻量诊断信息，例如 section count、used token estimate、provider health summary，用于测试或日志。但命中路径只依赖 `renderedPrompt`。

不缓存 raw evidence、facts、message transcript、tool result、model thinking 或 secrets。`renderedPrompt` 已经经过 `renderContextBundle()` 的 redaction 与 XML escaping。

## 数据流

未命中：

1. 调用者构造 `ContextRequest`。
2. 快照 helper 计算 key，发现 miss 或 expired。
3. 调用 `buildContextBundle()`。
4. 如果 `result.renderedPrompt` 非空，写入 5 分钟快照。
5. 通过 `appendContextPromptSegment()` 拼入 system prompt。

命中：

1. 调用者构造 `ContextRequest`。
2. 快照 helper 计算 key，发现未过期 snapshot。
3. 跳过 `buildContextBundle()`。
4. 直接把 cached `renderedPrompt` 通过 `appendContextPromptSegment()` 拼入 system prompt。

注入仍然是 system prompt 片段，和当前行为一致。快照只稳定 Engine 内容，不改变 messages、tools、provider metadata、cache key 或 cache user。

命中快照时不保存新的 `ContextBundle` snapshot。Context Inspector 仍显示最近一次真实组包结果；如果后续 UI 需要展示快照命中状态，应通过轻量诊断或运行时事件单独呈现，不伪造 bundle。

## 失效规则

快照在以下情况失效：

- 超过 5 分钟 TTL。
- `cwd`、actor、mode、normalized intent、model key 任一字段改变。
- Context Engine config disabled 或 injection disabled 时不读写快照。
- 调用方明确传入 `forceRefresh`，用于未来的 context refresh IPC 或测试。

不因普通文件修改、git 状态变化、provider health 变化立即失效。这是设计目标：5 分钟内 Engine 内容稳定，避免动态信号导致缓存抖动。需要最新状态时，模型仍然可以通过工具读取文件、git、诊断；5 分钟后 Engine 自然刷新。

## 错误处理

- 快照命中不会访问 store/provider，因此不产生新的 Context Engine 错误。
- 未命中时沿用 `buildContextBundle()` 的降级语义：失败返回空 rendered prompt，不阻断 runLoop。
- 空 rendered prompt 不写入快照，避免 5 分钟内锁住一次临时空注入。
- 如果写入快照发生异常，忽略并返回 fresh result。

## 测试计划

- `session-context.test.ts`：同一主会话、同一 normalized intent、5 分钟内连续两次请求只 build 一次 context，system prompt 中 Engine 片段完全相同。
- `session-context.test.ts`：超过 5 分钟后重新 build，新的 rendered prompt 可以变化。
- `session-context.test.ts`：不同 user intent hash 不共享快照。
- `sub-session` 或 Team PM 测试：actor key 不同不共享快照。
- `provider-prompt-contract.test.ts` 或 Anthropic focused test：快照不会给 JDC Context Engine 段新增 cache_control，Anthropic system block shape 不变。
- `context-orchestrator` focused test：快照层不改变 no-artificial-cap 行为；未命中仍可注入完整 relevance-first bundle。

## 验证命令

```bash
pnpm --filter @jdcagnet/core exec vitest run src/session-context.test.ts src/providers/provider-prompt-contract.test.ts src/context/context-orchestrator.test.ts --no-file-parallelism
```

```bash
pnpm --filter @jdcagnet/core build
```

```bash
git diff --check
```

## 后续可选优化

如果 5 分钟 rendered prompt 快照仍不足以提高 Anthropic 缓存收益，可以单独设计第二阶段：在 Anthropic system block 额度允许时，把稳定快照段并入 cacheable prefix 或为它分配 cache_control breakpoint。该优化必须先通过 provider prompt contract tests，确认不会超过 Anthropic cache_control 数量，也不会破坏中转站兼容 request shape。
