import { writeFileSync, readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export interface ExtractedMemory {
  name: string
  type: string
  description: string
  content: string
}

export function parseMemories(modelOutput: string): ExtractedMemory[] {
  const match = modelOutput.match(/<memories>([\s\S]*?)<\/memories>/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[1])
    if (!Array.isArray(parsed)) return []
    return parsed.filter(m => m && m.name && m.type && m.content)
  } catch {
    return []
  }
}

export async function saveMemories(
  memories: ExtractedMemory[],
  memDir: string,
  sessionId: string
): Promise<number> {
  if (memories.length === 0) return 0

  mkdirSync(memDir, { recursive: true })
  let saved = 0

  for (const mem of memories) {
    const filePath = path.join(memDir, `${mem.name}.md`)
    if (existsSync(filePath)) continue

    const date = new Date().toISOString()
    const fileContent = `---
name: ${mem.name}
description: ${mem.description}
metadata:
  type: ${mem.type}
  extractedAt: ${date}
  sessionId: ${sessionId}
---

${mem.content}
`
    writeFileSync(filePath, fileContent, 'utf-8')

    const indexPath = path.join(memDir, 'MEMORY.md')
    const indexLine = `- [${mem.description}](${mem.name}.md) — ${mem.description}\n`
    if (existsSync(indexPath)) {
      appendFileSync(indexPath, indexLine, 'utf-8')
    } else {
      writeFileSync(indexPath, indexLine, 'utf-8')
    }
    saved++
  }

  return saved
}
