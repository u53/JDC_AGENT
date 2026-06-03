// System-prompt segment describing the JDC Context Engine tools. Unlike
// CodeGraph (which only injected when .codegraph/ existed), the engine is always
// available, so this segment is unconditional.

export interface ContextEnginePromptSegment {
  segment: string
  cacheable: true
}

export function getContextEnginePromptSegment(): ContextEnginePromptSegment {
  return {
    cacheable: true,
    segment: [
      '## JDC Context Engine (内置代码理解 / 项目记忆，始终可用)',
      '',
      '本会话内置 JDC Context Engine —— 一个随应用启动、零配置、实时跟随文件变更的项目上下文引擎。',
      '它有两类模型可用表面：',
      '',
      '1. 代码理解：`JdcContext` / `JdcSearch` / `JdcNode` / `JdcCallers` / `JdcCallees` / `JdcImpact` / `JdcTrace` / `JdcExplore` / `JdcFiles`。',
      '2. 项目记忆：`JdcMemorySearch` / `JdcMemoryWrite`，读取或写入当前项目 store 中已接受、带 citation 的 durable facts。',
      '',
      '自动上下文规则：',
      '- 每轮回答前，系统可能已经自动注入 `<jdc-context-engine>` bundle；其中包含已筛选的代码上下文、项目事实、项目记忆和引用。',
      '- 如果自动注入的 `<jdc-context-engine>` 已经包含足够事实，直接使用它，不要重复调用 `JdcMemorySearch` 或 Jdc 代码工具制造重复上下文。',
      '- 只有当上下文缺失、模糊或需要验证项目长期事实时，才主动调用 `JdcMemorySearch` 查 accepted durable facts。',
      '- JDC Context Engine 是项目级引擎：同一项目跨会话共享 accepted project/repo/global facts；不同项目之间不共享，也不要把一个项目的事实套用到另一个项目。',
      '',
      '代码理解规则：',
      '回答涉及代码架构、调用链、影响面、「X 怎么实现 / X 调用了什么 / 改 X 影响哪些代码」这类问题时，',
      '**优先使用** `Jdc*` 代码工具，而不是委派子代理去 grep + Read 重做这件事。',
      '- `JdcContext` —— 主入口：综合符号搜索 + 调用关系 + 关键源码，回答「X 怎么工作」最先用它。',
      '  它还会自动带出当前未提交改动和近期高频改动的热区文件，优先关注用户正在动的代码。',
      '- `JdcSearch` —— 按名查符号，返回 file:line',
      '- `JdcNode` —— 单符号详情 + 调用 trail（谁调它 / 它调谁）。沿 trail 逐跳 node 下去，就能不靠 Read 走完整条调用图',
      '- `JdcCallers` / `JdcCallees` —— 谁调用了它 / 它调用了谁',
      '- `JdcImpact` —— 改动影响半径',
      '- `JdcTrace` —— 两个符号间的调用路径（grep 在结构上做不到的事，问「A 怎么走到 B」用它）',
      '- `JdcExplore` —— 批量返回多个符号的源码',
      '- `JdcFiles` —— 项目文件树 + 每文件符号数',
      '',
      '项目记忆规则：',
      '- 不要使用旧的保存记忆工具。',
      '- 用户明确要求“记住/保存”时，只有能提供 citation 才使用 `JdcMemoryWrite`。',
      '- 项目约定、工作流规则、架构决策、已知问题默认 `scope=project`（项目级）。',
      '- 问“你记得什么/项目约定是什么/之前做过什么决定”时，优先看自动注入上下文；若没有或需要验证，再使用 `JdcMemorySearch`。',
      '- 不保存问候、确认、猜测、无 citation 摘要、raw reasoning、secret、一次性临时状态。',
      '',
      '引擎索引始终与磁盘上的代码保持一致，无需手动建立或刷新索引。',
      'Jdc* 代码工具返回的源码是当前文件的权威内容，不必再次 Read 相同片段。',
      '',
      '能力边界（用好它，也别误用）：',
      '- 覆盖 TS/TSX/JS/Python/Go/Rust/Java/C/C++/Ruby/PHP，按名解析（非类型解析）——同名符号可能有歧义，',
      '  关键判断前用 JdcNode 看 file:line 核实是不是你要的那个。',
      '- 调用图来自静态分析。callers/callees/trace 显示「(none found statically)」或无路径时，',
      '  链路很可能断在动态分发（回调、接口、反射），此时再针对那一处 Read/Grep 补齐。',
    ].join('\n'),
  }
}
