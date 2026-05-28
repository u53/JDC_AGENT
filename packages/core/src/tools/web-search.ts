import { loadAppConfig } from '../config.js'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export const webSearchTool: ToolHandler = {
  definition: {
    name: 'WebSearch',
    description: `Search the web for current information. Returns titles, URLs, and snippets.

Usage notes:
- Use for information beyond your training data: current events, recent documentation, API references.
- You MUST always include a "Sources:" section at the end of your response with relevant URLs as markdown links.
- Use specific, descriptive queries rather than single keywords.
- The current year is important for finding recent docs — include it when searching for latest versions.
- Use allowed_domains/blocked_domains to filter results by site when you know the authoritative source.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        count: { type: 'number', description: 'Number of results (default 5, max 20)' },
      },
      required: ['query'],
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const query = input.query as string | undefined
    if (!query) {
      return { content: 'Error: query is required', isError: true }
    }
    const count = Math.min((input.count as number) || 5, 20)

    const config = loadAppConfig()
    const apiKey = (config as any)?.webSearch?.braveApiKey
    if (!apiKey) {
      return { content: 'Error: Brave Search API key not configured. Set webSearch.braveApiKey in ~/.jdcagnet/config.json', isError: true }
    }

    try {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`
      const response = await fetch(url, {
        headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
        signal: context.signal || AbortSignal.timeout(15000),
      })

      if (!response.ok) return { content: `Error: Brave Search API returned ${response.status}`, isError: true }

      const data = await response.json() as any
      const results = (data.web?.results || []).map((r: any) => `- [${r.title}](${r.url})\n  ${r.description || ''}`).join('\n\n')

      return { content: results || 'No results found.' }
    } catch (err: any) {
      return { content: `Error: ${err.message}`, isError: true }
    }
  },
}
