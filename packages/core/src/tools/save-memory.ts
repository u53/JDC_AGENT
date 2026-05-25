import { writeFileSync, readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import { getMemoryDir } from '../context.js'
import { extractBody } from '../memory-extractor.js'

export const saveMemoryTool: ToolHandler = {
  definition: {
    name: 'save_memory',
    description:
      'Save information to persistent memory that will be available in all future sessions. Use when:\n' +
      '- The user explicitly asks you to remember something\n' +
      '- You learn an important user preference or workflow habit\n' +
      '- The user gives feedback on your behavior that should persist\n' +
      '- You discover project context worth preserving (deadlines, architecture decisions)\n\n' +
      'Memory types: "user" (preferences/expertise), "feedback" (corrections to behavior), ' +
      '"project" (deadlines/decisions), "reference" (links/locations).\n' +
      'Do NOT save: code patterns derivable from reading files, git history, ephemeral task details.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Short kebab-case identifier (e.g., "user-prefers-terse-responses")',
        },
        type: {
          type: 'string',
          enum: ['user', 'feedback', 'project', 'reference'],
          description: 'Category of memory',
        },
        description: {
          type: 'string',
          description: 'One-line summary for the memory index',
        },
        content: {
          type: 'string',
          description: 'Full memory content. For feedback/project types, include Why: and How to apply: lines.',
        },
      },
      required: ['name', 'type', 'description', 'content'],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const name = input.name as string
    const type = input.type as string
    const description = input.description as string
    const content = input.content as string

    if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || name.includes('..')) {
      return { content: 'Error: name must be kebab-case (lowercase letters, digits, hyphens).', isError: true }
    }

    const memDir = getMemoryDir(context.cwd)
    mkdirSync(memDir, { recursive: true })

    const filePath = path.join(memDir, `${name}.md`)
    const isUpdate = existsSync(filePath)

    if (isUpdate) {
      const existing = readFileSync(filePath, 'utf-8')
      const existingBody = extractBody(existing)
      if (existingBody === content.trim()) {
        return { content: `Memory "${name}" already exists with identical content. No changes made.` }
      }
    }

    const date = new Date().toISOString()
    const fileContent = `---
name: ${name}
description: ${description}
metadata:
  type: ${type}
  savedAt: ${date}
---

${content}
`
    writeFileSync(filePath, fileContent, 'utf-8')

    if (!isUpdate) {
      const indexPath = path.join(memDir, 'MEMORY.md')
      const indexLine = `- [${description}](${name}.md) — ${description}\n`
      if (existsSync(indexPath)) {
        appendFileSync(indexPath, indexLine, 'utf-8')
      } else {
        writeFileSync(indexPath, indexLine, 'utf-8')
      }
    }

    const action = isUpdate ? 'Updated' : 'Saved'
    return { content: `${action} memory: "${name}" (${type}). Available in all future sessions.` }
  },
}
