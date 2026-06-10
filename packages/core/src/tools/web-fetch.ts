import TurndownService from 'turndown'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import { loadAppConfig } from '../config.js'
import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import { makeFetchOptions } from './fetch-options.js'

const MAX_CONTENT_LENGTH = 50000
const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' })

export const webFetchTool: ToolHandler = {
  definition: {
    name: 'WebFetch',
    description:
      'Fetch a URL and extract its content as markdown. Use after WebSearch to read source content; WebSearch snippets are not evidence. Uses the configured WebSearch proxy when present. Use the prompt to specify what information to extract.\n\n' +
      'IMPORTANT: Will FAIL for authenticated/private URLs (Google Docs, Jira, Confluence, private repos). ' +
      'Check if the URL requires login before using.\n' +
      '- For GitHub URLs, prefer gh CLI via bash instead (e.g., gh pr view, gh issue view)\n' +
      '- HTTP URLs are auto-upgraded to HTTPS\n' +
      '- Content is truncated at 50000 chars',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to fetch' },
        prompt: { type: 'string', description: 'What information to extract from the page' },
      },
      required: ['url', 'prompt'],
    },
  },

  async execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const url = input.url as string | undefined
    const prompt = input.prompt as string | undefined
    if (!url || !prompt) {
      return { content: 'Error: url and prompt are required', isError: true }
    }

    try {
      new URL(url)
    } catch {
      return { content: 'Error: invalid URL', isError: true }
    }

    try {
      const config = loadAppConfig()
      const proxy = (config.webSearch as any)?.proxy
      const fetchOpts = makeFetchOptions({
        proxy,
        headers: { 'User-Agent': 'JDCAGNET/1.0 (Desktop AI Assistant)' },
        signal: context.signal,
        timeoutMs: 30000,
      })

      const response = await fetch(url, fetchOpts)

      if (!response.ok) {
        return { content: `Error: HTTP ${response.status} ${response.statusText}`, isError: true }
      }

      const html = await response.text()
      const { document } = parseHTML(html)
      const reader = new Readability(document as any)
      const article = reader.parse()

      let markdown: string
      if (article?.content) {
        markdown = turndown.turndown(article.content)
      } else {
        markdown = turndown.turndown(html)
      }

      if (markdown.length > MAX_CONTENT_LENGTH) {
        markdown = markdown.slice(0, MAX_CONTENT_LENGTH) + '\n\n(content truncated)'
      }

      const title = article?.title || ''
      return { content: `# ${title}\n\nURL: ${url}\nPrompt: ${prompt}\n\n---\n\n${markdown}` }
    } catch (err: any) {
      return { content: `Error fetching URL: ${err.message}`, isError: true }
    }
  },
}
