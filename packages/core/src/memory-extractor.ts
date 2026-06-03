export interface ExtractedMemory {
  name: string
  type: string
  description: string
  content: string
}

export function parseMemories(_modelOutput: string): ExtractedMemory[] {
  return []
}

export async function saveMemories(
  _memories: ExtractedMemory[],
  _memDir: string,
  _sessionId: string
): Promise<number> {
  return 0
}

export function extractBody(fileContent: string): string {
  const match = fileContent.match(/^---[\s\S]*?---\s*\n([\s\S]*)$/)
  return match ? match[1].trim() : fileContent.trim()
}
