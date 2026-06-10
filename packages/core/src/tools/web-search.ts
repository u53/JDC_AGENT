import { loadAppConfig } from '../config.js'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import { makeFetchOptions } from './fetch-options.js'

export type SearchProvider = 'brave' | 'tavily' | 'serper'

interface WebSearchConfig {
  provider?: SearchProvider
  braveApiKey?: string
  tavilyApiKey?: string
  serperApiKey?: string
  proxy?: string
}

const DEFAULT_RESULT_COUNT = 8
const MIN_RESULT_COUNT = 5
const MAX_RESULT_COUNT = 10
const SNIPPET_NOTICE = 'Note: WebSearch results are snippets, not evidence. Before making detailed factual claims, use WebFetch on the relevant result URLs to read source content.'

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

// --- Brave Search ---
async function searchBrave(query: string, count: number, apiKey: string, cfg: WebSearchConfig, signal?: AbortSignal): Promise<string> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`
  const res = await fetch(url, makeFetchOptions({
    proxy: cfg.proxy,
    signal,
    timeoutMs: 15000,
    headers: { 'X-Subscription-Token': apiKey, 'Accept': 'application/json' },
  }))
  if (!res.ok) throw new Error(`Brave API ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json() as any
  return (data.web?.results || [])
    .map((r: any) => `- [${r.title}](${r.url})\n  ${r.description || ''}`)
    .join('\n\n') || 'No results found.'
}

// --- Tavily Search ---
async function searchTavily(query: string, count: number, apiKey: string, cfg: WebSearchConfig, signal?: AbortSignal): Promise<string> {
  const res = await fetch('https://api.tavily.com/search', makeFetchOptions({
    proxy: cfg.proxy,
    signal,
    timeoutMs: 15000,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key: apiKey, query, max_results: count, include_answer: true }),
  }))
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
  const res = await fetch('https://google.serper.dev/search', makeFetchOptions({
    proxy: cfg.proxy,
    signal,
    timeoutMs: 15000,
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num: count }),
  }))
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
- The current year is important for finding recent docs — include it when searching for latest versions.
- Use count=8 for most searches and count=10 for broad comparison/recommendation queries. Count=5 is only an absolute floor for narrow, exact lookups; do NOT use fewer than 5.
- WebSearch returns titles, URLs, and snippets only. Snippets are NOT evidence.
- For factual answers, news, laws, docs, prices, schedules, or any claim where details matter, follow up with WebFetch on the relevant result URLs and use the fetched page content as evidence before finalizing.
- Do NOT repeatedly call WebSearch with the same or near-identical query. If the first search finds plausible sources, switch to WebFetch instead of searching in circles.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        count: { type: 'number', description: 'Number of results (default 8, min 5, max 10). Values below 5 are raised to 5 to avoid wasting a search request.' },
      },
      required: ['query'],
    },
  },
  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const query = input.query as string | undefined
    if (!query) return { content: 'Error: query is required', isError: true }
    const count = normalizeCount(input.count as number | undefined)

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
      return { content: `${results}\n\n${SNIPPET_NOTICE}` }
    } catch (err: any) {
      return { content: `Search error: ${err.message}`, isError: true }
    }
  },
}

function normalizeCount(raw: number | undefined): number {
  if (!Number.isFinite(raw)) return DEFAULT_RESULT_COUNT
  return Math.min(Math.max(Math.floor(raw!), MIN_RESULT_COUNT), MAX_RESULT_COUNT)
}
