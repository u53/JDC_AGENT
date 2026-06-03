# Team / Subagent 模型解析修复 与 Sub-session 上下文 Compaction 设计

> 本文是 JDCAGNET 中「显式模型指定解析」与「sub-session 上下文管理」两条工作线的设计契约。
> A 线是 bug 修复(必须),B 线是能力增强(可选)。两线相互独立,可分开落地。
> 文中所有行号基于 2026-06-02 诊断时的代码快照;动手前需重新核对,因为 working tree 有未提交改动会导致偏移。

## 文档状态

- 产品范围:Team Mode 的 PM/worker 模型分配,Agent 工具的 subagent 模型分配,sub-session 上下文压缩
- 运行时:本地桌面 agent 运行时(Electron + core)
- 协议:Anthropic Messages / OpenAI Chat / OpenAI Responses
- 主要语言:TypeScript
- 测试:Vitest
- 诊断状态:已完成,根因已定位,未动任何代码

## 核心原则(不可违背)

- **默认继承不动**。不指定模型时,PM、worker、subagent 全部跟随主会话模型 —— 这是当前行为,是正确的,任何改动都不得破坏它。
- **不引入写死的默认模型**。不存在「PM 默认 DS」「worker 默认 opus」这种硬编码。只有用户**显式指定**时才覆盖。
- **显式指定必须正确命中**。这是 A 线要修的唯一问题:用户指定时不能静默失败、不能跨组撞车、不能解析到错误的供应商。
- **指定失败必须可见**。当前的静默 fallback 会让用户以为指定生效了,实际跑的是主会话模型。失败要让用户看得到。
- **context 失败不得中断 worker**。B 线的 compaction 一旦失败,worker 必须能继续跑(退化为不压缩),不能因压缩崩溃而丢任务。

---

# A 线:模型解析修复(必修 bug)

## A.1 背景:三个 id 字段的混淆

`ModelEntry`(`packages/ui/src/stores/model-store.ts:5-7`)有三个容易混淆的字段:

```ts
interface ModelEntry {
  id: string        // crypto.randomUUID() —— 系统内部主键(配置存储用)
  modelId: string   // "claude-opus-4-8" —— 真正发给 API 的模型名
  name: string      // "Opus 4.8" —— UI 上展示给用户看的显示名
}
```

模型归属于 group(`ModelGroup`,带独立的 `protocol`/`baseUrl`/`apiKey`)。**同一个 `modelId` 可以存在于多个 group**(例:官方组 + 中转组都配了 `claude-opus-4-8`)—— 这正是用户描述的「分组不同但模型相同」场景。

## A.2 根因:存在两套不一致的 resolveModel 实现

**实现 1 — `resolveModelById`(`packages/electron/src/session-manager.ts:155`),精确但用途窄**

支持复合键 `"groupId:modelId"`,先定位 group 再找模型,跨组不撞车。但它**只在激活 session / setSessionModel / 配置变更时被调用**(`:209` `:235` `:370`),worker 和 subagent 不走它。

**实现 2 — `session.resolveModel` 注入副本(`packages/electron/src/session-manager.ts:277-293`),buggy,worker + subagent 实际走它**

```js
session.resolveModel = (modelId) => {
  for (const group of data.groups) {
    const model = group.models?.find(m => m.id === modelId || m.modelId === modelId)
    if (model) return { provider, modelConfig }   // 第一个命中就返回
  }
  return null
}
```

三个缺陷:

1. **不认 `name`**。只比对 `m.id`(UUID)和 `m.modelId`(API名)。用户/PM 填显示名 `"Opus 4.8"` → 两个字段都不等 → **匹配失败**。
2. **不认复合键**。整串 `"groupId:claude-opus-4-8"` 拿去比对 `m.id`/`m.modelId` → 匹配失败。复合键是消除跨组重名歧义的唯一手段,这里直接废掉。
3. **跨组重名撞车**。`for...find` 取第一个命中的 group。当 `modelId` 在多组重名时,可能命中错误的 group → 错误的 `baseUrl`/`apiKey` → 跑到另一家供应商或直接报错。

## A.3 受影响的调用方(共用同一个 buggy 引用,一处修复全覆盖)

| 调用方 | 位置 | 现状 |
|---|---|---|
| Team worker | `team-member.ts:217-218` | `this.opts.resolveModel(this.modelId)`,指向 buggy 副本 |
| Subagent(Agent 工具) | `agent.ts:77-78` | `deps.resolveModel(requestedModelId)`,同一个 buggy 副本 |

两者都经 `session.ts:142` / `session.ts:211` 注入,最终都是 `session-manager.ts:277` 那个副本。**修一处,worker 和 subagent 同时修好。**

## A.4 失败静默的坑

worker 解析失败时只发一条 `member_progress` 事件(`team-member.ts:232`):

```
[modelId resolve] requested "Opus 4.8" not found — falling back to main session model
```

然后 `effectiveModelConfig` 保持主会话模型继续跑。**结果:用户在 UI 看到 worker 标着 `Opus 4.8`,以为生效了,实际跑的是主会话模型。** 这就是用户「这能对上吗我不懂」的真相 —— 大概率没对上。subagent 路径(`agent.ts`)同样是静默 fallback。

## A.5 PM 模型现状

PM 模型写死 = 主会话模型:`tools/team.ts:251` 的 `aiPM` 直接吃 `deps.provider`/`deps.modelConfig`,而它们在 `session.ts:30-31` 来自 `this.provider`/`this.config.modelConfig`。**没有任何「显式指定时换 PM 模型」的入口。** 用户说「让 PM 用 DS」目前无法生效。

## A.6 PM 从未拿到可用模型清单

PM 的 system prompt(`team-manager-ai.ts`)全文只有一句关于 modelId 的话(`:331`):

```
DO NOT include a "modelId" field in spec unless the user EXPLICITLY asked for a specific model.
```

team 工具 schema 对 `modelId` 的描述(`tools/team.ts:99-101`)也只说「用户明确要求才填、别从记忆里猜」。**从未注入过任何真实模型清单(有哪些 group、哪些 modelId)。** 所以即便放开禁令,PM 也是盲填 —— 它不知道 `claude-opus-4-8` 存在、不知道 groupId。这是「指定要正确」的隐含前提:谁来指定、指定值从哪来,必须有可靠来源。

## A.7 修复设计

**A-fix-1:统一解析逻辑(核心)**

让 worker/subagent 走的 resolveModel 与 `resolveModelById` 对齐,支持四种命中形式,且跨组不撞车:

1. 复合键 `"groupId:modelId"` —— 最高优先级,精确消歧
2. `m.id`(UUID)
3. `m.modelId`(API名)
4. `m.name`(显示名)—— **新增**,让 `"Opus 4.8"` 能命中

实现方式二选一(动手时定):
- **(推荐)删除 `session-manager.ts:277` 的副本,改为复用 `resolveModelById`**,并在 `resolveModelById` 里补 `name` 匹配。单一事实来源,彻底消除两套逻辑漂移。
- 或:保留副本但补齐复合键 + name 匹配,与 `resolveModelById` 行为严格对齐(次选,仍有双实现漂移风险)。

跨组重名时:无复合键的裸名匹配若命中多个 group,应有确定性策略(优先精确 `modelId`/`id`,再 `name`;多组命中时记一条诊断并取第一个,或要求复合键)。具体策略动手时定。

**A-fix-2:失败不再静默**

解析失败时,除 `member_progress` 外,升级为更显眼的事件(如 `manager_decision` 或带 warning 级别),让用户在主时间线看到「指定的 X 没找到,实际用了主会话模型」。subagent 路径同样处理。

**A-fix-3:PM 模型 override 通道(对应「让 PM 用 DS」)**

仅当用户显式要求时才换 PM 模型,不填继承主会话:
- 在 team 工具入参加一个可选 `pmModelId`(或等价机制),`tools/team.ts:251` 构造 `aiPM` 时用统一 resolveModel 解析成独立 provider/modelConfig
- 不填 → 保持现状(= 主会话模型)
- 指令来源(用户怎么把「PM 用 DS」传到 team 工具)动手时定 —— 见 Open Questions

**A-fix-4(可选):给 PM 注入可用模型清单**

若希望 PM 能自主为 worker 选模型(而非用户逐个指定),需在 state dump 或 PM system prompt 注入 `groupId:modelId | name | 简介`,并放开/改写 `:331` 的禁令。**默认不做** —— 仅当产品方向是「PM 自主选模」时才需要。按核心原则,默认是「用户显式指定」,此项非必需。

## A.8 A 线测试计划

- 复合键 `groupId:modelId` 精确命中正确 group(构造跨组重名场景)
- 显示名 `"Opus 4.8"` 能命中并解析出正确的 `modelId`/provider
- UUID、API名 各自命中
- 跨组重名时裸名匹配的确定性行为符合既定策略
- 不指定时 worker/subagent/PM 均继承主会话模型(回归保护,最重要)
- 指定一个不存在的 model → 失败事件可见 + 安全 fallback,不崩
- `pmModelId` 指定生效 / 不指定继承主会话

---

# B 线:Sub-session 上下文 Compaction + maxTurns(增强,可选)

## B.1 背景:三层上下文机制对比

| 层 | 代码 | 上下文控制 | 会自动 compact? |
|---|---|---|---|
| 主 Session | `session.ts` | `UsageTracker` 真实 token + `shouldCompact`(默认 90%)触发 `compactMessages`;`microCompact` 在 50% 清旧 tool 结果 | **是** |
| Worker / Subagent | `sub-session.ts` | 仅 `while (turns < effectiveMaxTurns)`,默认 1000;消息只增不减 | **否** |
| PM | `team-manager-ai.ts` | 硬滑动窗口 `length>16 → slice(-12)` + 入库即摘要;每轮重建 state dump | 否(但不会爆) |

## B.2 问题:worker/subagent 消息无界增长

`sub-session.ts:128` 主循环每轮无条件 `messages.push`(`:135` `:239` `:334`),**全程无 compact、无 contextWindow 检查、无裁剪**。长任务(几十上百轮 Read/Bash/Edit)会让 `messages` 线性膨胀,直到**撞上模型真实上下文上限被 API 硬拒**(prompt too large),走 worker `onFail`,而非优雅压缩。

注意:这类「上下文超限」错误**不在 stream-retry 的可重试集合内**(已于本会话实现,见文末),会直接失败 —— 所以 B 线无法靠重试兜底。

## B.3 可复用的现成资产

- `compactMessages(messages, provider, config, onChunk?, signal?)`(`compact.ts:127`)—— 完整的「LLM 总结历史 + 保留近期」实现,含 tool_use/tool_result 边界处理(`pickCutIndex` `:254`)、sanitize(`:270`)
- `UsageTracker.shouldCompact(compressAt)`(`usage-tracker.ts`)—— 用真实 API token 判断,sub-session 已在 `message_end` 收到 `chunk.usage`(`sub-session.ts:218`)
- `estimateTokens(messages)`(`token-estimation.ts`)—— 字符级估算,首轮无 API 数据时兜底(含 CJK 加权)
- 常量:`KEEP_RECENT=6`、`MIN_COMPACT_LENGTH=8`(`compact.ts:108-109`)

`modelConfig` 已带 `contextWindow`/`compressAt`(worker 经 resolveModel 拿到的 model 配置即含,`session-manager.ts:170-174`)。

## B.4 设计

**B-design-1:支持调高/可配 maxTurns**

现状默认 1000(`sub-session.ts:84` `:95`),agent 定义各异(`agent-types.ts`:explore 25 / general 150 等)。允许显式调高,但 maxTurns 不是上下文的根本解法 —— 必须配合 B-design-2。

**B-design-2:sub-session 内接入 compaction**

在 `sub-session.ts` 主循环每轮开头(push 新消息前)插入检查:
- 用 `UsageTracker`(累计 worker 的 `chunk.usage`)或 `estimateTokens` 估算占用
- 超过 `modelConfig.contextWindow * (modelConfig.compressAt ?? 0.9)` → 调 `compactMessages` 原地替换 `messages`
- 复用主 session 的触发阈值与 KEEP_RECENT 策略,保持一致

**B-design-3:失败安全**

`compactMessages` 失败(stream_error/empty)→ 记诊断,**保持原 messages 继续跑**(退化为不压缩),绝不中断 worker。对应核心原则。

## B.5 注意点

- **心跳**:compaction 是一次额外 LLM 调用,耗时可能长。须在压缩期间刷新 worker 心跳(类似 `onStreamHeartbeat`,`team-member.ts:277`),否则 per-task idle timeout 会误杀正在压缩的 worker。
- **turn 边界**:压缩必须在完整 turn 边界做,不能切断 tool_use ↔ tool_result 配对(`pickCutIndex` 已处理此事,复用即可)。
- **harvest 不能误删**:`harvestAssistantMessages`/`harvestToolEvents`(`sub-session.ts:120-121`)是独立累积、用于 enqueue harvest 的,**与 compaction 后的 `messages` 是两套数据**。压缩 `messages` 不得影响 harvest 累积,否则 sub-session context 收割会丢数据。

## B.6 B 线测试计划

- 构造超阈值的长 messages → 触发压缩 → messages 被替换且 turn 边界完整
- 压缩失败 → worker 继续跑,不崩
- 压缩期间心跳刷新,不被 idle timeout 误杀
- harvest 累积不受压缩影响
- maxTurns 可调且生效

---

# C 线:Team 归档路径 handoff(必修,handoff 完整性)

## C.1 背景:team 结束即归档,`.team/` 消失

team 完成时 `completeTeam`(`team-runtime.ts:1081`)调用 `workspace.archive()`(`team-workspace.ts:104-111`),把整个 `.team/` 目录 **rename** 到 `.team-archive/<teamId>-<ts>/`。原地的 `.team/` 自此不存在。

## C.2 现状:归档路径只是 summary 末尾一行自由文本

archive 完成后,路径被拼到 summary 尾部(`team-runtime.ts:1114`):

```
${summary}\n\nArchived to: ${archivePath}
```

这个 finalSummary 经 `team_completed` 事件 → `onTeamEvent`(`session.ts:219`)→ `team_complete` 通知(`session.ts:225`)→ `<task-notification>`(`session.ts:751`)一路传到主会话。**路径技术上到了主会话**,但只是一行尾随文本:没有结构化字段,也没有任何「`.team/` 已经不在了」的明确指令。

## C.3 问题:主会话会去已不存在的 `.team/` 找

1. **HANDOFF CONTRACT 没提归档**。team 工具返回的 handoff 契约(`tools/team.ts:287-296`)只说「等 team_complete、基于 synthesized result 做后续」,**只字未提 `.team/` 已归档、详细产物要去 archive 路径读**。
2. **PM summary 与 worker 产物里的路径全是 `.team/...`**。worker 全程把产物写在 `.team/tasks/T*/artifacts/`,PM prompt 也反复出现 `.team/`(`team-runtime.ts:1161-1162`)。主会话想深挖细节时会自然去 `.team/tasks/...` 读 —— 归档后这些**全是死路**。
3. **快照里也没有产物指针**。`captureTeamFinalSnapshot`(`session.ts:1251`)只快照 task 元数据(id/title/status),**没有 archivePath、没有任何产物文件位置**。

## C.4 修复设计

**C-fix-1:归档路径结构化,进 handoff 契约**

`onComplete(summary)` 当前只传一个拼接字符串。改为让归档路径成为**结构化字段**一路传到主会话,而非埋在 summary 文本里:

- `completeTeam` 已有 `archivePath`(`team-runtime.ts:1113`)—— 让它单独传出,不仅拼进 summary。可在 `onComplete` 回调签名或 `team_completed` 事件上加 `archivePath` 字段。
- `session.ts:225` 构造 `team_complete` 通知文本时,显式加一句:**「`.team/` 已归档到 `<archivePath>`。需要细节产物(各 task 的 artifacts/result/contracts)请去该目录读,**不要**再访问 `.team/`,它已不存在。」**

**C-fix-2:HANDOFF CONTRACT 补归档说明**

team 工具返回的 handoff 契约(`tools/team.ts:287-296`)增加一条:team 完成后 `.team/` 会被归档到 `.team-archive/`,team_complete 通知里会带归档路径;深挖产物去归档目录,不要假设 `.team/` 还在。

**C-fix-3(可选):快照带产物指针**

`captureTeamFinalSnapshot`(`session.ts:1251`)增加 `archivePath` 字段,并可选地为每个 task 记录其归档后的 `result.md`/`artifacts/` 相对路径,让 `getTeamStatus` 在 runtime 移除后仍能给出可读路径。**非必需** —— C-fix-1 已能让主会话拿到根路径,自行拼子路径即可。

## C.5 C 线测试计划

- team 正常完成 → `team_complete` 通知含归档绝对路径,且文案明确指示「别再读 `.team/`」
- 归档失败(rename 抛错)→ 通知如实说明归档失败(现有 `catch` 分支,`team-runtime.ts:1118`),不误导主会话去找不存在的路径
- 主会话拿到归档路径后,能在 `.team-archive/<teamId>-<ts>/tasks/T*/` 下读到产物(端到端)
- 不破坏现有 summary 内容(归档路径是**附加**结构化字段,summary 正文不变)

---

## 涉及文件清单(2026-06-02 行号,动手前重新核对)

A 线:
- `packages/electron/src/session-manager.ts:155`(`resolveModelById`,精确实现)/ `:277-293`(buggy 注入副本,元凶)
- `packages/core/src/team/team-member.ts:215-241`(worker 解析 + 静默 fallback)
- `packages/core/src/tools/agent.ts:71-78`(subagent 解析)
- `packages/core/src/tools/team.ts:99-101`(modelId schema)/ `:251`(aiPM 写死主会话模型)
- `packages/core/src/team/team-manager-ai.ts:331`(PM modelId 禁令)

B 线:
- `packages/core/src/sub-session.ts:84` `:95` `:128`(maxTurns / 主循环)/ `:120-121` `:218` `:245` `:340`(harvest / usage / 返回)
- `packages/core/src/compact.ts`(复用)
- `packages/core/src/usage-tracker.ts`、`packages/core/src/token-estimation.ts`(复用)

C 线:
- `packages/core/src/team/team-runtime.ts:1081-1126`(`completeTeam` + archive 拼接)/ `:1161-1162`(PM prompt 里的 `.team/`)
- `packages/core/src/team/team-workspace.ts:104-111`(`archive()` rename `.team/` → `.team-archive/`)
- `packages/core/src/session.ts:214-243`(`onTeamEvent` 构造 team_complete 通知)/ `:751`(notification 文本)/ `:1251-1280`(`captureTeamFinalSnapshot`,缺 archivePath)
- `packages/core/src/tools/team.ts:258-261`(`onComplete` 回调)/ `:287-296`(HANDOFF CONTRACT,缺归档说明)

## 优先级建议

1. **A-fix-1 + A-fix-2** —— 必修 bug。显式指定能正确命中、失败可见。一处修复覆盖 worker + subagent。
2. **C-fix-1 + C-fix-2** —— 必修 handoff 完整性。归档路径结构化进通知 + handoff 契约,主会话不再去已消失的 `.team/` 找产物。改动小、收益直接。
3. **A-fix-3** —— 若需要「PM 用独立模型」。
4. **B-design-1/2/3** —— 增强,worker 跑长任务才需要。
5. **C-fix-3 / A-fix-4 / A.6 清单注入** —— 锦上添花。仅在对应产品方向(快照带产物指针 / PM 自主选模)成立时才做。默认不做。

## Open Questions(动手前需用户拍板)

- **A-Q1**:显式指定的「来源」是什么?用户在主会话说一句自然语言(「worker 用 opus」),由主会话 Claude 转成 team 工具参数?还是 UI 上配?指定值用显示名还是 modelId?
- **A-Q2**:「让 PM 用 DS」这个指令怎么传到 `aiPM`?新增 team 工具入参 `pmModelId`,还是别的机制?
- **A-Q3**:跨组裸名重名时的确定性策略 —— 取第一个 + 诊断,还是强制要求复合键?
- **B-Q1**:maxTurns 默认是否调整,还是仅允许显式调高?
- **B-Q2**:compaction 触发阈值复用主 session 的 `compressAt`(0.9),还是 worker 单独配一个更激进的值?
- **C-Q1**:归档路径用哪种结构化通道传到主会话 —— 给 `onComplete` 回调加参、给 `team_completed` 事件加 `archivePath` 字段、还是两者都加?(影响 `team-runtime.ts` → `tools/team.ts` → `session.ts` 三处签名)

## 本会话已完成的相关修复(已在 main)

与本设计同源排查,已落地两个 commit:

- `3409805` fix(providers): retry transient stream drops before first chunk —— 三个 provider 统一的流式重试(仅首 chunk 前重试),`stream-retry.ts`。**注意:不覆盖上下文超限错误**,见 B.2。
- `7ec8b87` fix(team): guard assignTask against duplicate proactive assignment —— proactive 周期竞态导致同一任务被双重分配的幂等守卫。
