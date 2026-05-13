import type { ToolRegistry } from '../tool-registry.js'
import { bashTool } from './bash.js'
import { fileReadTool } from './file-read.js'
import { fileWriteTool } from './file-write.js'
import { fileEditTool } from './file-edit.js'
import { globTool } from './glob.js'
import { grepTool } from './grep.js'
import { lsTool } from './ls.js'
import { treeTool } from './tree.js'
import { notebookEditTool } from './notebook-edit.js'
import { webFetchTool } from './web-fetch.js'
import { webSearchTool } from './web-search.js'
import { lspTool } from './lsp.js'

export function registerBuiltinTools(registry: ToolRegistry): void {
  registry.register(bashTool)
  registry.register(fileReadTool)
  registry.register(fileWriteTool)
  registry.register(fileEditTool)
  registry.register(globTool)
  registry.register(grepTool)
  registry.register(lsTool)
  registry.register(treeTool)
  registry.register(notebookEditTool)
  registry.register(webFetchTool)
  registry.register(webSearchTool)
  registry.register(lspTool)
}

export { bashTool, fileReadTool, fileWriteTool, fileEditTool, globTool, grepTool, lsTool, treeTool, notebookEditTool, webFetchTool, webSearchTool, lspTool }
