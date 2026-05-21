import { diffLines, diffWordsWithSpace } from 'diff'

export interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
  oldLineNum?: number
  newLineNum?: number
}

export interface InlineDiffSegment {
  type: 'added' | 'removed' | 'common'
  value: string
}

export function computeLineDiff(oldStr: string, newStr: string): DiffLine[] {
  const changes = diffLines(oldStr, newStr)
  const result: DiffLine[] = []
  let oldLine = 1
  let newLine = 1

  for (const change of changes) {
    const lines = change.value.replace(/\n$/, '').split('\n')
    for (const line of lines) {
      if (change.added) {
        result.push({ type: 'add', content: line, newLineNum: newLine++ })
      } else if (change.removed) {
        result.push({ type: 'remove', content: line, oldLineNum: oldLine++ })
      } else {
        result.push({ type: 'context', content: line, oldLineNum: oldLine++, newLineNum: newLine++ })
      }
    }
  }
  return result
}

export function computeInlineDiff(oldLine: string, newLine: string): { oldSegments: InlineDiffSegment[]; newSegments: InlineDiffSegment[] } {
  const changes = diffWordsWithSpace(oldLine, newLine)
  const oldSegments: InlineDiffSegment[] = []
  const newSegments: InlineDiffSegment[] = []

  for (const change of changes) {
    if (change.added) {
      newSegments.push({ type: 'added', value: change.value })
    } else if (change.removed) {
      oldSegments.push({ type: 'removed', value: change.value })
    } else {
      oldSegments.push({ type: 'common', value: change.value })
      newSegments.push({ type: 'common', value: change.value })
    }
  }
  return { oldSegments, newSegments }
}

export function extractFileName(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

export function truncateText(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + '...'
}

export function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  const match = toolName.match(/^mcp__([^_]+)__(.+)$/)
  if (!match) return null
  return { server: match[1]!, tool: match[2]! }
}
