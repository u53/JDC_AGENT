# Spec 7: 权限系统增强

## 目标

将当前简单的工具名分类权限系统重写为基于规则链的匹配引擎，支持 glob 模式路径匹配、多来源规则持久化、会话级拒绝追踪和危险命令分级。

## 架构

重写 `PermissionChecker` 为规则链匹配引擎。规则从两个独立 JSON 文件加载（全局 + 项目级），按优先级链匹配。新增 `permission-rules.ts` 负责规则类型定义和文件加载。

## 规则格式

存储位置：
- 全局：`~/.config/jdcagnet/permissions.json`
- 项目：`<project-cwd>/.jdcagnet/permissions.json`

文件格式：

```json
{
  "rules": [
    { "tool": "file_read", "path": "src/**", "decision": "allow" },
    { "tool": "file_write", "path": "dist/**", "decision": "deny" },
    { "tool": "bash", "command": "npm *", "decision": "allow" },
    { "tool": "file_edit", "path": "**", "decision": "ask" }
  ]
}
```

每条规则字段：
- `tool`（必填）— 工具名，精确匹配
- `path`（可选）— 对 file_read/file_write/file_edit/glob/grep 匹配其 `file_path` 参数，glob 语法
- `command`（可选）— 对 bash 匹配其 `command` 参数，glob 语法
- `decision`（必填）— `allow` | `ask` | `deny`

无 path/command 的规则匹配该工具的所有调用。

## Glob 匹配

使用 picomatch 库（轻量、无依赖、广泛使用）进行 glob 匹配。路径匹配时相对于项目 cwd 解析。

## 匹配优先级链

```
1. 项目规则（.jdcagnet/permissions.json）— 按数组顺序，第一个匹配的生效
2. 全局规则（~/.config/jdcagnet/permissions.json）— 按数组顺序
3. 内置默认规则（READ_ONLY_TOOLS → allow，WRITE_TOOLS → ask）
4. 兜底：ask
```

## Mode 与规则链的交互

Mode 作为快捷方式叠加在规则链之上：

- **relaxed** — 跳过规则链，直接 allow（除 critical 级别危险命令外）
- **strict** — 规则链正常匹配，但 allow 结果降级为 ask（READ_ONLY_TOOLS 除外）
- **standard** — 规则链正常匹配，结果直接使用

## 会话级拒绝追踪

数据结构：`deniedPatterns: Map<string, Set<string>>`

- Key：工具名
- Value：被拒绝的具体参数值集合

行为：
- 用户拒绝 `file_write` 且 file_path 为 `/etc/hosts` → 记录 `deniedPatterns.get('file_write').add('/etc/hosts')`
- 下次相同 tool + 相同精确路径 → 直接返回 deny，不再询问
- 匹配方式：精确字符串匹配（不是 glob），因为拒绝针对具体调用
- 对 bash 工具：记录完整 command 字符串
- 无 path/command 参数的工具：记录 `*` 表示该工具所有调用被拒绝

## 危险命令分级

```typescript
type DangerLevel = 'dangerous' | 'critical'
```

**critical（所有模式下都 ask，包括 relaxed）：**
- `rm -rf /` 或 `rm -rf ~`（根目录或 home）
- `dd if=`（磁盘写入）
- `mkfs.`（格式化）
- `:(){ :|:& };:`（fork bomb）
- `> /dev/sd`（覆盖磁盘）
- `sudo rm -rf`

**dangerous（standard 模式 ask，relaxed 模式 allow）：**
- `rm -rf`（非根目录）
- `rm --force`
- `git push --force` / `git push -f`
- `git reset --hard`
- `git clean -f`
- `chmod -R 777`
- `curl ... | sh` / `curl ... | bash`
- `wget ... | sh`
- `docker rm` / `docker rmi`
- `npm publish`
- `DROP TABLE` / `DROP DATABASE`（SQL）

## 接口设计

```typescript
// permission-rules.ts

interface PermissionRule {
  tool: string
  path?: string
  command?: string
  decision: PermissionDecision
}

interface PermissionRuleFile {
  rules: PermissionRule[]
}

function loadPermissionRules(cwd: string): {
  projectRules: PermissionRule[]
  globalRules: PermissionRule[]
}
```

```typescript
// permissions.ts (重写)

class PermissionChecker {
  constructor(mode: PermissionMode, cwd: string)

  check(toolName: string, input: Record<string, unknown>): PermissionDecision
  recordDenial(toolName: string, input: Record<string, unknown>): void
  allowForSession(toolName: string): void
  isDangerousCommand(input: Record<string, unknown>): DangerLevel | null
  getMode(): PermissionMode
  setMode(mode: PermissionMode): void
}
```

## 文件变动

- **新增**: `packages/core/src/permission-rules.ts` — 规则类型 + 加载逻辑
- **重写**: `packages/core/src/permissions.ts` — 规则链匹配引擎
- **修改**: `packages/core/src/session.ts` — 传递 cwd 给 PermissionChecker 构造函数
- **修改**: `packages/core/src/tool-runner.ts` — 拒绝时调用 recordDenial
- **新增**: `packages/core/tests/permissions.test.ts` — 新权限系统测试
- **依赖**: 添加 `picomatch` 到 packages/core

## 不做的事

- 不做规则冲突/遮蔽检测
- 不做 UI 规则编辑器（用户手动编辑 JSON 文件）
- 不做规则热重载（Session 创建时加载一次）
- 不做工具名通配符（`file_*`）— 只支持精确工具名
- 不做规则导入/导出功能
