# Team Workspace Design Spec

## Date: 2026-05-22

## Summary

给 Team Mode 增加一个物理化的协作工作区:在 `<workspace>/.team/` 下用 markdown 文件持久化团队的契约 (contracts)、产物 (artifacts)、问题 (issues)、决策 (objective/log) 和任务结构 (tasks/T*)。Worker 通过 PM 智能注入 + 现有 Read/Grep 工具直接消费上下文,完成时整套目录归档到 `.team-archive/<team-id>-<ts>/`。

这套机制把 team 协作从"事件流 + mailbox"升级为"事件流 + mailbox + 共享文件系统",解决三个核心断层:产物在 worker 之间不可见、契约不可锁定、QA 验收无法闭环。

## Goals

1. **产物可见**:每个 worker 完成时必须结构化上交产物(含 frontmatter `summary`),后续相关任务自动看到上游产物清单
2. **契约锁定**:对接类任务 (前后端 API、UI 设计、文档大纲、协议、数据 schema) PM 自动先派契约 task,产出 contracts/X.md,后续任务 prompt 强注入契约全文
3. **QA 闭环**:写入类 task 完成时 PM 智能派 QA worker 验收,问题持久化为 issues/ISSUE-N.md,关联原 task,PM 自动派定向返工
4. **持久化 + 可审计**:所有协作上下文都是 md 文件,用户可随时 cat / Read / git diff
5. **复用现有原语**:Read/Grep/Edit 工具不动,只新增一个轻量 `team_artifact` 工具
6. **与单会话 team 限制兼容**:一个 session 一个活跃 team,`.team/` 目录直接归 active team 所有

## Non-Goals

- 不做关系数据库:cross-reference 全靠文件名约定 (M001/ISSUE-001/T001)
- 不实现自动同步索引:文件系统就是 single source of truth
- 不做跨 team 共享(每个 team 独享自己的 .team/,完成即归档)
- 不强制契约模式(PM 全动态判断,小任务可走轻结构化)
- 不在 Phase 1 实现 issue/QA(留到 Phase 3)
- 不做实时协作编辑(每份 artifact 文件名带唯一 ID,串行化即可)

---

## Architecture Overview

```
<workspace>/
├── .team/                              # 当前活跃 team 的协作工作区
│   ├── README.md                       # PM 维护:索引 + 任务图 + 状态总览
│   ├── objective.md                    # 目标/约束/全局决策(PM 写)
│   ├── log.md                          # append-only 协作日志
│   │
│   ├── contracts/                      # 全局共享契约(跨任务)
│   │   ├── api-v1.md
│   │   └── ui-spec.md
│   │
│   ├── issues/                         # 全局 issue 仓库
│   │   ├── ISSUE-001.md
│   │   └── ISSUE-002.md
│   │
│   └── tasks/
│       ├── T001/
│       │   ├── task.md                 # 描述 + frontmatter
│       │   ├── result.md               # worker 完成时写
│       │   └── artifacts/
│       │       ├── M001-design.md
│       │       └── M001-impl-notes.md
│       └── T002/...
│
└── .team-archive/                      # team 完成后归档
    └── <team-id>-<ts>/                 # 整个 .team/ 移过来
```

### Data Flow

```
PM 拆任务
   │
   ▼
判断契约模式? ───是──► 先派 contract task ──► 产出 contracts/X.md
   │                       │
   │                       ▼
   │                  后续 task depends_on,prompt 强注入契约全文
   │
   └──否──► 各 task 独立,完成时写 artifacts/M*.md(含 summary)
                                │
                                ▼
                          下游 task assignTask 时,PM 注入上游 artifacts 摘要
                                │
                                ▼
                          完成 → PM 判断要不要 QA → 派 QA task
                                                      │
                                                      ▼
                                          QA 用 team_artifact 创建 ISSUE
                                                      │
                                                      ▼
                                          PM 看到 issue → reopen 原 task
                                                      │
                                                      ▼
                                          原作者修复 → status=resolved
```

---

## File Schemas

### Task (`.team/tasks/T<n>/task.md`)

```markdown
---
id: T001
title: 设计用户列表 API
status: completed              # todo | assigned | running | completed | failed | reopened
assignee: member_xxx
depends_on: []                 # 上游 task ID
contracts: [api-v1.md]         # 这个 task 产出的契约
issues_open: []                # 关联未解决的 issue ID
created_at: 2026-05-22T10:00:00Z
updated_at: 2026-05-22T10:30:00Z
---

## Description
{自然语言描述}

## Acceptance Criteria  (PM 可选填,QA 用)
- ...
```

### Task Result (`.team/tasks/T<n>/result.md`)

```markdown
---
task_id: T001
completed_by: member_xxx
completed_at: 2026-05-22T10:30:00Z
summary: 设计了 GET /users 的字段格式,包含分页和过滤参数
artifacts: [M001-design.md, M001-impl-notes.md]
contracts_produced: [api-v1.md]
---

## Result
{worker 完成时填的总结}

## Key Decisions
- ...
```

### Artifact (`.team/tasks/T<n>/artifacts/<id>.md`)

```markdown
---
id: M001-design
type: report                   # report | code | design | decision | data
created_by: member_xxx
on_task: T001
summary: 用户列表 API 字段设计,包含 id/name/email/created_at,分页 limit+offset
related_contracts: []
created_at: 2026-05-22T10:25:00Z
---

## Details
{完整内容}
```

### Contract (`.team/contracts/<name>.md`)

```markdown
---
name: api-v1
version: 1
locked_by_task: T001           # 谁锁定了这份契约
related_tasks: [T002, T003]    # 依赖此契约的任务
created_at: 2026-05-22T10:30:00Z
updated_at: 2026-05-22T10:30:00Z
---

# API v1 Contract

## GET /users
- Query: ?limit=20&offset=0&filter=active
- Response: { data: User[], total: number }
- ...
```

锁定后,只允许通过 `team_artifact action=update_contract` 修改(PM 显式批准),普通 worker 不能用 Edit 改。

### Issue (`.team/issues/ISSUE-<n>.md`)

```markdown
---
id: ISSUE-001
title: GET /users 接口缺 created_at 字段
status: open                   # open | in_progress | resolved | wontfix
severity: high
opened_by: member_qa_xxx
on_task: T002                  # QA 在哪个 task 验收时发现
related_contract: api-v1.md
assigned_to: null              # PM 决定时填
opened_at: 2026-05-22T11:00:00Z
resolved_at: null
---

## Reproduction / Evidence
- 检查 packages/api/src/users.ts:24
- 实际返回:{ id, name, email }
- 契约要求:{ id, name, email, created_at }

## Resolution (返工后填)
{修复说明}
```

---

## Components & Changes

### New: `packages/core/src/team/team-workspace.ts`

封装 `.team/` 目录的全部 IO。提供:

```typescript
class TeamWorkspace {
  constructor(opts: { rootDir: string; archiveDir?: string; teamId: string })

  // 初始化:创建 .team/ 骨架,写 README.md / objective.md
  init(objective: string): Promise<void>

  // 路径解析(全部相对 rootDir)
  taskDir(taskId: string): string
  taskFile(taskId: string): string
  resultFile(taskId: string): string
  artifactFile(taskId: string, artifactId: string): string
  contractFile(name: string): string
  issueFile(issueId: string): string

  // 读取(全部含 frontmatter parse)
  readTask(taskId: string): Promise<TaskFrontmatter & { body: string }>
  readArtifactSummaries(taskId: string): Promise<ArtifactSummary[]>
  readContract(name: string): Promise<{ frontmatter: ContractFrontmatter; body: string }>
  readIssue(issueId: string): Promise<IssueFrontmatter & { body: string }>

  // 写入(走 file lock)
  writeTask(taskId: string, fm: TaskFrontmatter, body: string): Promise<void>
  writeResult(taskId: string, fm: ResultFrontmatter, body: string): Promise<void>
  writeArtifact(taskId: string, artifactId: string, fm: ArtifactFrontmatter, body: string): Promise<void>
  writeContract(name: string, fm: ContractFrontmatter, body: string): Promise<void>
  writeIssue(issueId: string, fm: IssueFrontmatter, body: string): Promise<void>
  appendLog(line: string): Promise<void>

  // 状态变更
  updateTaskStatus(taskId: string, status: TaskStatus): Promise<void>
  updateIssueStatus(issueId: string, status: IssueStatus, resolution?: string): Promise<void>

  // 归档
  archive(): Promise<string>  // 返回归档目录路径
}
```

并发保护:
- artifact / issue 文件名带唯一 ID,无 worker 间冲突
- contracts/ 走 `acquireFileLock(contractFile(name))` 串行化
- log.md append-only 走 `acquireFileLock('log.md')`

### New: `packages/core/src/tools/team-artifact.ts`

唯一新工具,4 个 action:

```typescript
team_artifact({
  action: 'create_artifact' | 'create_contract' | 'create_issue' | 'update_status',

  // create_artifact
  task_id?: string
  artifact_id?: string         // 可选,默认 <memberId>-<topic>
  type?: 'report' | 'code' | 'design' | 'decision' | 'data'
  summary?: string             // 必填(LLM 一句话总结)
  content?: string             // 正文 markdown

  // create_contract
  contract_name?: string
  // ...

  // create_issue
  issue_title?: string
  on_task?: string
  related_contract?: string
  severity?: 'low' | 'medium' | 'high' | 'critical'
  evidence?: string

  // update_status
  target_id?: string           // T001 / ISSUE-001
  new_status?: string
  resolution?: string          // resolved 时填
})
```

工具内部:
1. 校验必填字段
2. 调 `TeamWorkspace.write*` 写文件
3. append `log.md` 一行
4. `create_issue` 自动调 `team_report`(intent: blocker)通知 PM
5. 返回工具结果,告诉 worker 文件路径

### Changed: `packages/core/src/team/team-runtime.ts`

```typescript
constructor(opts: TeamRuntimeOptions) {
  // ...
  this.workspace = new TeamWorkspace({
    rootDir: opts.subSessionDeps.cwd,           // workspace cwd
    archiveDir: opts.archivePath,               // 可选覆盖
    teamId: this.id,
  })
}

async start() {
  await this.workspace.init(this.objective)
  // PM 也拿到 workspace 引用,后续拆任务时调用
  if ('setWorkspace' in this.manager) {
    (this.manager as TeamManagerAI).setWorkspace(this.workspace)
  }
  // 把 plan 里的 tasks 都落到 .team/tasks/T*/task.md
  for (const [i, task] of this.opts.plan.tasks.entries()) {
    const taskId = `T${String(i + 1).padStart(3, '0')}`
    await this.workspace.writeTask(taskId, {...}, task.description)
  }
  // ...rest of start logic
}

private completeTeam(summary: string) {
  // ...existing
  this.workspace.archive().then(archivePath => {
    this.recordEvent({ type: 'team_completed', summary: `${summary}\n\nArchived to: ${archivePath}`, timestamp: Date.now() })
  })
}
```

`assignTask` 增强:从 workspace 读取上下文拼到 taskPrompt(注意:当前实现是 sync,Phase 1 改为 async,因为要读 fs):

```typescript
private async assignTask(taskId: string, memberId: string): Promise<void> {
  const task = this.manager.getTask(taskId)
  const member = this.memberById.get(memberId)
  if (!task || !member) return

  // 读取上下文
  const taskFm = await this.workspace.readTask(taskId)
  const contracts = await Promise.all(
    (taskFm.contracts ?? []).map(name => this.workspace.readContract(name))
  )
  const upstreamArtifacts = await this.collectUpstreamArtifacts(taskFm.depends_on ?? [])

  // 构造增强 prompt
  const enrichedPrompt = formatTaskPrompt({
    task: taskFm,
    contracts,                          // 全文注入
    upstreamArtifacts,                  // 摘要注入
    isReopened: task.status === 'reopened',
    issues: taskFm.issues_open,         // reopened 时全文注入
  })

  // ...rest of assignTask, 把 enrichedPrompt 给 TeamMember
}
```

注意:`assignTask` 改 async 后,`executeActions` 中调用处改为 fire-and-forget(`this.assignTask(...).catch(err => ...)`),因为 tick loop 本身是 sync;失败 worker 走原有 onFail 路径标记 task failed。

### Changed: `packages/core/src/team/team-manager-ai.ts`

system prompt 增加两段:

**契约判断段** (常驻):
```
当你拆解任务后,审视 task 间的依赖关系。如果两个 task 之间有"输出格式即输入约束"
(API、协议、UI 设计、数据 schema、文档大纲等),先派一个 task 产出 contracts/X.md,
后续 task 都 depends_on 这个 task,任务描述强调"严格依据 contracts/X.md"。

如果只是顺序依赖、无对接(先调研后总结),走轻结构化即可,不必创建 contract。
```

**QA 判断段** (task_completed 触发):
```
任务 T<n> 已完成。审视产物:
- 涉及代码改动 / 接口变更 / 写入文件 / 产生契约 → 派一个 QA task (general agent),
  depends_on T<n>,描述明确"基于 contracts/X.md(若有) 验证 T<n> 的产出,
  问题写到 .team/issues/ISSUE-N.md"
- 调研 / 阅读 / 总结类 → 不需要 QA

看到新 issue 通知:
- 派原作者 reopen 原 task (常见情况)
- 原作者无法处理 (能力不匹配/ 多次失败) → 派新人
- 误报 → 改 status=wontfix,在 log.md 记录原因
```

`decideTick` / `processAction` 中:
- `add_member` action 不变
- 新增内部 helper `assignWithContext`,在生成 `assign_task` action 时附带 contracts / artifacts 列表(由 runtime 在 assignTask 时读取)

### Changed: `packages/core/src/team/team-member.ts`

`TeamMemberOptions` 新增可选字段 `workspace?: TeamWorkspace`(由 TeamRuntime 在 assignTask 时传入)。

`extraTools` 增加 `team_artifact`:

```typescript
async run() {
  const extraTools: SubSessionOptions['extraTools'] = []

  if (this.opts.teamMailbox) {
    extraTools.push(/* existing team_report */)
  }

  if (this.opts.workspace) {
    const artifactTool = createTeamArtifactTool({
      memberId: this.id,
      taskId: this.opts.taskId,
      workspace: this.opts.workspace,
      teamMailbox: this.opts.teamMailbox,
    })
    extraTools.push(artifactTool)
  }

  // ... rest unchanged
}
```

system prompt 注入 (在 sub-session 拼 prompt 处):
```
你正在 team 中执行任务 T<n>。团队工作区在 .team/ 目录:
- 你的产物写到: .team/tasks/T<n>/artifacts/ (用 team_artifact 工具)
- 完成时调 team_artifact action=update_status 把任务标 completed
- 上游产物清单见任务 prompt 顶部
- 契约文件在 .team/contracts/ (只读,严格遵守)
- 问题报到 .team/issues/ (用 team_artifact action=create_issue)
- 进度/疑问继续用 team_report 给 PM
```

### Changed: `packages/core/src/tools/team.ts`

新增 `archive_path` 可选参数,转发到 TeamRuntime:

```typescript
inputSchema: {
  properties: {
    // ...existing
    archive_path: { type: 'string', description: '完成后归档目录(默认 .team-archive)' }
  }
}
```

---

## taskPrompt Format (示例)

```
TASK: T002 - 实现用户列表 API

================================
DESCRIPTION:
实现 GET /users 接口,支持分页和过滤。严格依据 contracts/api-v1.md。

================================
🔒 CONTRACTS (你必须严格遵守的契约 - 全文如下):

--- contracts/api-v1.md ---
{full file content with frontmatter}
--- end contracts/api-v1.md ---

================================
📎 RELATED ARTIFACTS (上游产物 - 摘要,详情用 Read 查看):

- .team/tasks/T001/result.md
  Summary: 设计了 GET /users 的字段格式,包含分页和过滤参数

- .team/tasks/T001/artifacts/M001-design.md
  Summary: 用户列表 API 字段设计,包含 id/name/email/created_at

================================
📂 OUTPUTS:
- 你的产物写到: .team/tasks/T002/artifacts/<your-id>-<topic>.md
- 完成时调用 team_artifact action=create_artifact 归档结果
- 完成时调用 team_artifact action=update_status target=T002 new_status=completed

================================
TOOLS AVAILABLE:
- 标准工具: Read / Grep / Glob / Edit / Write / Bash
- team_report: 给 PM 发 finding/question/blocker
- team_artifact: 写产物 / 创建 issue / 更新状态
```

Reopened 时多一段:

```
================================
⚠️ ISSUES TO FIX (来自 QA 验收):

--- ISSUE-003 ---
Title: GET /users 缺 created_at 字段
Severity: high
Evidence:
- packages/api/src/users.ts:24 实际返回 { id, name, email }
- 契约要求 { id, name, email, created_at }

Resolution required:
- 修复实现
- 修复后调 team_artifact action=update_status target=ISSUE-003 new_status=resolved
--- end ISSUE-003 ---
```

---

## Phased Implementation

### Phase 1: Workspace Foundation + 产物可见

**Scope**:
- 新建 `team-workspace.ts`(全套 IO)
- 新建 `team-artifact` 工具,只实现 `create_artifact` / `update_status` 两个 action
- TeamRuntime 启动时初始化 workspace,完成时归档
- TeamRuntime.assignTask 注入"上游 artifact 摘要"到 taskPrompt
- TeamMember.run 注入 team_artifact 工具
- Worker 完成 task 前必须调 `team_artifact action=update_status target=T<n> new_status=completed summary=<...>`,工具内部同时:
  - 把 task.md frontmatter 的 status 改为 completed
  - 把 summary 和 worker 写过的 artifact 列表渲染到 `tasks/T<n>/result.md`
- 如果 worker 直接 return 没调 update_status,TeamRuntime 兜底写一份 result.md(只含 worker 自由文本 summary,artifacts 列表为空)

**Verification**:
1. 创建 2-task 链 (A 调研 → B 综合)
2. A 完成 → `.team/tasks/T001/result.md` 存在,带 summary
3. B 启动 → prompt 顶部能看到 T001 的 result summary
4. team 完成 → `.team/` 移到 `.team-archive/<team-id>-<ts>/`

**Not in scope**:contracts、issues、QA、reopen

### Phase 2: Contracts + PM Prompt 升级

**Scope**:
- `team_artifact` 增加 `create_contract` action
- TeamManagerAI system prompt 增加契约判断段
- TeamRuntime.assignTask 把相关 contracts/*.md 全文注入 taskPrompt
- PM 拆任务时,LLM 决定要不要先派 contract task

**Verification**:
1. 让 PM 处理"前后端 API 对接"objective
2. PM 自动产出 contracts/api-v1.md
3. 后续 backend / frontend task 的 prompt 里都包含 api-v1.md 全文

### Phase 3: Issues + QA + Reopen

**Scope**:
- `team_artifact` 增加 `create_issue` action,自动 team_report 通知 PM
- task status 增加 `reopened`
- TeamRuntime.assignTask 检测 reopened,把 issue 全文注入 prompt
- TeamManagerAI system prompt 增加 QA 判断段 + reopen 决策段
- PM 看到 issue 通知 → decide: assign_to_original / assign_to_new / mark_wontfix

**Verification**:
1. 写代码类 task 完成 → PM 派 QA task
2. QA 发现问题 → ISSUE-001 创建,PM 收到通知
3. PM 派原作者 reopen 原 task,prompt 里有 issue 全文
4. 修复 → ISSUE-001 status=resolved
5. team 完成时 .team/issues/ 也归档

---

## Trade-offs

| 关注点 | 决策 | 理由 |
|---|---|---|
| md 文件爆炸 | 唯一 ID 文件名 + log.md append-only + 完成归档 | 短 team 不会大,长 team 归档清空 |
| Token 成本 | 契约全文注入 + artifact 摘要 | 关键依赖必看,详情按需 Read,LLM 自主取舍 |
| Worker 学习 | team_artifact 4 action,prompt 里给例子 | 单工具单参数,prompt 即文档 |
| git 干扰 | .team/ 默认 .gitignore | 用户主动 add 才入库 |
| 并发写 | 唯一文件名 + contracts/log.md 走 file lock | 复用现成机制,简单可靠 |
| PM 增加判断 | 两段 prompt + 一次 task_completed 回调 | 不动架构,只加文本 |

## Open Questions (写完 spec 后还可调整)

1. **`.team/` 是否真该 .gitignore**:有些用户想 commit 团队的决策过程。Phase 1 默认 ignore,Phase 4(未来)可加 team 创建参数 `commit_workspace: true`。
2. **archive 是否压缩**:目前直接 mv 目录;若长 team 产生大量 md,可考虑打 tar.gz。Phase 1 不处理。
3. **跨 team 借鉴历史**:`.team-archive/` 已有,future PM 可主动检索旧团队产物。Phase 4 再说。
4. **README.md 自动生成时机**:每次 task 状态变更都重写一次,还是定时 batch?Phase 1 走"每次状态变更"。

---

## Dependencies / Compatibility

- 依赖现有 `acquireFileLock`(packages/core/src/team/team-concurrency.ts)
- 依赖现有 `extraTools` 机制(packages/core/src/sub-session.ts)
- 依赖现有 `TeamManagerAI`(packages/core/src/team/team-manager-ai.ts)
- 不影响现有 `team_report` 工具(并存)
- 单 team 限制保持不变(.team/ 一次只服务一个 team;新 team 启动前若 .team/ 残留,先归档再 init,避免污染)
- 现有 `team_list` / `team_add_task` / 一切 background 工具保持不变

## Success Criteria

- Phase 1 verify 步骤通过 → 合并
- Phase 2 verify 步骤通过 → 合并
- Phase 3 verify 步骤通过 → 合并
- 整体合并后,跑一个真实"前后端对接"objective,worker 间不再"重新扫一遍代码"对接,QA 发现的问题被正确反馈到原作者
