import { existsSync } from 'node:fs'
import path from 'node:path'

export interface CodegraphPromptSegment {
  segment: string
  cacheable: false
}

export function getCodegraphPromptSegment(cwd: string): CodegraphPromptSegment {
  const dbPath = path.join(cwd, '.codegraph', 'codegraph.db')
  if (!existsSync(dbPath)) {
    return { segment: '', cacheable: false }
  }
  const segment =
    `\n\n## CodeGraph (本项目已建立索引)\n\n` +
    `本项目根目录下存在 \`.codegraph/\` 索引。回答涉及代码架构、调用链、影响面、` +
    `「X 怎么实现 / X 调用了什么 / 改 X 影响哪些代码」这类问题时，**优先使用** ` +
    `\`mcp__codegraph__codegraph_*\` 工具（context / search / callers / callees / impact / trace / explore / node），` +
    `不要委派 Explore 子代理去 grep + Read 重做这件事。CodeGraph 返回的源码是权威来源，` +
    `不必再次读取相同文件。\n\n` +
    `**调用 \`mcp__codegraph__codegraph_*\` 工具时必须传入 \`projectPath\` 参数**，` +
    `值固定为本会话的项目根目录：\n\n` +
    `\`projectPath: "${cwd}"\`\n\n` +
    `多个项目同时打开时省略此参数会查询到错误的项目。`
  return { segment, cacheable: false }
}
