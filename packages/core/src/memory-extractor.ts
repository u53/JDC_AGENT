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

    if (existsSync(filePath)) {
      const existing = readFileSync(filePath, 'utf-8')
      const existingBody = extractBody(existing)
      const newBody = mem.content.trim()
      if (!shouldOverwrite(existingBody, newBody)) continue
    }

    const date = new Date().toISOString()
    const isUpdate = existsSync(filePath)
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

    if (!isUpdate) {
      const indexPath = path.join(memDir, 'MEMORY.md')
      const indexLine = `- [${mem.description}](${mem.name}.md) — ${mem.description}\n`
      if (existsSync(indexPath)) {
        appendFileSync(indexPath, indexLine, 'utf-8')
      } else {
        writeFileSync(indexPath, indexLine, 'utf-8')
      }
    }
    saved++
  }

  return saved
}

export function extractBody(fileContent: string): string {
  const match = fileContent.match(/^---[\s\S]*?---\s*\n([\s\S]*)$/)
  return match ? match[1].trim() : fileContent.trim()
}

function shouldOverwrite(existingBody: string, newBody: string): boolean {
  if (existingBody === newBody) return false
  if (newBody.length > existingBody.length * 1.2) return true
  const existingLines = new Set(existingBody.split('\n').map(l => l.trim()).filter(Boolean))
  const newLines = newBody.split('\n').map(l => l.trim()).filter(Boolean)
  const novelLines = newLines.filter(line => !existingLines.has(line))
  return novelLines.length > newLines.length * 0.3
}
