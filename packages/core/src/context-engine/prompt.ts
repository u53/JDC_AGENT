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
      '## JDC Context Engine (内置代码理解，始终可用)',
      '',
      '本会话内置 JDC Context Engine —— 一个随应用启动、零配置、实时跟随文件变更的代码理解引擎。',
      '回答涉及代码架构、调用链、影响面、「X 怎么实现 / X 调用了什么 / 改 X 影响哪些代码」这类问题时，',
      '**优先使用** `jdc_*` 工具，而不是委派子代理去 grep + Read 重做这件事：',
      '',
      '- `jdc_context` —— 主入口：综合符号搜索 + 调用关系 + 关键源码，回答「X 怎么工作」最先用它。',
      '  它还会自动带出当前未提交改动和近期高频改动的热区文件，优先关注用户正在动的代码。',
      '- `jdc_search` —— 按名查符号，返回 file:line',
      '- `jdc_node` —— 单符号详情 + 调用 trail（谁调它 / 它调谁）。沿 trail 逐跳 node 下去，就能不靠 Read 走完整条调用图',
      '- `jdc_callers` / `jdc_callees` —— 谁调用了它 / 它调用了谁',
      '- `jdc_impact` —— 改动影响半径',
      '- `jdc_trace` —— 两个符号间的调用路径（grep 在结构上做不到的事，问「A 怎么走到 B」用它）',
      '- `jdc_explore` —— 批量返回多个符号的源码',
      '- `jdc_files` —— 项目文件树 + 每文件符号数',
      '',
      '引擎索引始终与磁盘上的代码保持一致，无需手动建立或刷新索引。',
      'jdc_* 返回的源码是当前文件的权威内容，不必再次 Read 相同片段。',
      '',
      '能力边界（用好它，也别误用）：',
      '- 覆盖 TS/TSX/JS/Python/Go/Rust/Java/C/C++/Ruby/PHP，按名解析（非类型解析）——同名符号可能有歧义，',
      '  关键判断前用 jdc_node 看 file:line 核实是不是你要的那个。',
      '- 调用图来自静态分析。callers/callees/trace 显示「(none found statically)」或无路径时，',
      '  链路很可能断在动态分发（回调、接口、反射），此时再针对那一处 Read/Grep 补齐。',
    ].join('\n'),
  }
}
