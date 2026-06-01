import { HttpsProxyAgent } from 'https-proxy-agent'
import { loadAppConfig } from '../config.js'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'

export type SearchProvider = 'brave' | 'tavily' | 'serper'

interface WebSearchConfig {
  provider?: SearchProvider
  braveApiKey?: string
  tavilyApiKey?: string
  serperApiKey?: string
  proxy?: string
}

function getSearchConfig(): WebSearchConfig {
  const config = loadAppConfig()
  return (config.webSearch as WebSearchConfig) || {}
}

function resolveProvider(cfg: WebSearchConfig): { provider: SearchProvider; apiKey: string } | null {
  if (cfg.provider) {
    const key = cfg.provider === 'brave' ? cfg.braveApiKey
      : cfg.provider === 'tavily' ? cfg.tavilyApiKey
      : cfg.serperApiKey
    if (key) return { provider: cfg.provider, apiKey: key }
  }
  if (cfg.braveApiKey) return { provider: 'brave', apiKey: cfg.braveApiKey }
  if (cfg.tavilyApiKey) return { provider: 'tavily', apiKey: cfg.tavilyApiKey }
  if (cfg.serperApiKey) return { provider: 'serper', apiKey: cfg.serperApiKey }
  return null
}

function makeFetchOptions(cfg: WebSearchConfig, signal?: AbortSignal): RequestInit {
  const opts: RequestInit = { signal: signal || AbortSignal.timeout(15000) }
  if (cfg.proxy) {
    (opts as any).agent = new HttpsProxyAgent(cfg.proxy)
  }
  return opts
}

// --- Brave Search ---
async function searchBrave(query: string, count: number, apiKey: string, cfg: WebSearchConfig, signal?: AbortSignal): Promise<string> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`
  const res = await fetch(url, {
    ...makeFetchOptions(cfg, signal),
    headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
  })
  if (!res.ok) throw new Error(`Brave API ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json() as any
  return (data.web?.results || [])
    .map((r: any) => `- [${r.title}](${r.url})\n  ${r.description || ''}`)
    .join('\n\n') || 'No results found.'
}

// --- Tavily Search ---
async function searchTavily(query: string, count: number, apiKey: string, cfg: WebSearchConfig, signal?: AbortSignal): Promise<string> {
  const res = await fetch('https://api.tavily.com/search', {
    ...makeFetchOptions(cfg, signal),
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: count, include_answer: true }),
  })
  if (!res.ok) throw new Error(`Tavily API ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json() as any
  const answer = data.answer ? `**Answer:** ${data.answer}\n\n` : ''
  const results = (data.results || [])
    .map((r: any) => `- [${r.title}](${r.url})\n  ${r.content?.slice(0, 200) || ''}`)
    .join('\n\n')
  return answer + (results || 'No results found.')
}

// --- Serper (Google) ---
async function searchSerper(query: string, count: number, apiKey: string, cfg: WebSearchConfig, signal?: AbortSignal): Promise<string> {
  const res = await fetch('https://google.serper.dev/search', {
    ...makeFetchOptions(cfg, signal),
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: count }),
  })
  if (!res.ok) throw new Error(`Serper API ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json() as any
  const organic = (data.organic || [])
    .map((r: any) => `- [${r.title}](${r.link})\n  ${r.snippet || ''}`)
    .join('\n\n')
  const answerBox = data.answerBox ? `**Answer:** ${data.answerBox.answer || data.answerBox.snippet || ''}\n\n` : ''
  return answerBox + (organic || 'No results found.')
}

// --- Tool Handler ---
export const webSearchTool: ToolHandler = {
  definition: {
    name: 'WebSearch',
    description: `Search the web for current information. Returns titles, URLs, and snippets.

Usage notes:
- Use for information beyond your training data: current events, recent documentation, API references.
- You MUST always include a "Sources:" section at the end of your response with relevant URLs as markdown links.
- Use specific, descriptive queries rather than single keywords.
- The current year is important for finding recent docs — include it when searching for latest versions.`,
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
    if (!query) return { content: 'Error: query is required', isError: true }
    const count = Math.min((input.count as number) || 5, 20)

    const cfg = getSearchConfig()
    const resolved = resolveProvider(cfg)
    if (!resolved) {
      return {
        content: 'Error: No search API key configured. Go to Settings → Tools to configure Brave, Tavily, or Serper API key.',
        isError: true,
      }
    }

    try {
      const { provider, apiKey } = resolved
      let results: string
      switch (provider) {
        case 'brave': results = await searchBrave(query, count, apiKey, cfg, context.signal); break
        case 'tavily': results = await searchTavily(query, count, apiKey, cfg, context.signal); break
        case 'serper': results = await searchSerper(query, count, apiKey, cfg, context.signal); break
      }
      return { content: results }
    } catch (err: any) {
      return { content: `Search error: ${err.message}`, isError: true }
    }
  },
}
