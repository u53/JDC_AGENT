import type { ToolRegistry } from '../tool-registry.js'
import { bashTool } from './bash.js'
import { fileReadTool } from './file-read.js'
import { fileWriteTool } from './file-write.js'
import { fileEditTool } from './file-edit.js'

export function registerBuiltinTools(registry: ToolRegistry): void {
  registry.register(bashTool)
  registry.register(fileReadTool)
  registry.register(fileWriteTool)
  registry.register(fileEditTool)
}

export { bashTool, fileReadTool, fileWriteTool, fileEditTool }
