export interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
}

export function computeLineDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')
  const result: DiffLine[] = []

  let oi = 0
  let ni = 0

  while (oi < oldLines.length || ni < newLines.length) {
    if (oi >= oldLines.length) {
      result.push({ type: 'add', content: newLines[ni]! })
      ni++
    } else if (ni >= newLines.length) {
      result.push({ type: 'remove', content: oldLines[oi]! })
      oi++
    } else if (oldLines[oi] === newLines[ni]) {
      result.push({ type: 'context', content: oldLines[oi]! })
      oi++
      ni++
    } else {
      result.push({ type: 'remove', content: oldLines[oi]! })
      oi++
      if (ni < newLines.length && (oi >= oldLines.length || oldLines[oi] !== newLines[ni])) {
        result.push({ type: 'add', content: newLines[ni]! })
        ni++
      }
    }
  }

  return result
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
