// JDC Context Engine built-in tools. These replace the former codegraph_* MCP
// tools with a native, always-available code intelligence surface backed by the
// in-process Tree-sitter engine.
//
// All tools share one engine instance via ToolContext.contextEngine. If the
// engine is missing (should not happen in the app), they return a clear error.

import type { ToolHandler, ToolContext, ToolResult } from '../tool-registry.js'
import { EngineQuery, type SymbolLocation } from '../context-engine/query.js'
import type { ContextEngine } from '../context-engine/engine.js'
import { getContextEngine } from '../context-engine/index.js'

// Cache one EngineQuery per engine instance (keyed by cwd via the engine).
const queryCache = new WeakMap<ContextEngine, EngineQuery>()

async function getQuery(context: ToolContext): Promise<EngineQuery | null> {
  const engine = resolveEngine(context)
  if (!engine) return null
  if (!engine.isIndexed()) {
    await engine.index()
  }
  let q = queryCache.get(engine)
  if (!q) {
    q = new EngineQuery(engine)
    queryCache.set(engine, q)
  }
  return q
}

/** Resolve the engine: prefer the injected pre-warmed one, else the per-cwd singleton. */
function resolveEngine(context: ToolContext): ContextEngine | null {
  return context.contextEngine ?? getContextEngine(context.cwd) ?? null
}

/**
 * One-line index status footer so the model (and user) know whether the index
 * is fully ready and how much it covers — prevents "silent partial" answers.
 */
function statusFooter(context: ToolContext): string {
  const engine = resolveEngine(context)
  if (!engine) return ''
  const s = engine.stats()
  const origin = engine.wasLoadedFromSnapshot() ? '已从缓存加载' : '本次会话已构建'
  return `\n\n— 索引状态: ${s.files} 文件 / ${s.symbols} 符号 (${origin})`
}

/** Wrap tool content with the status footer. */
function withStatus(context: ToolContext, content: string, isError = false): ToolResult {
  return { content: content + (isError ? '' : statusFooter(context)), isError }
}

function fmtLoc(l: SymbolLocation): string {
  const sig = l.signature ? `  ${l.signature}` : ''
  return `- ${l.kind} ${l.name} — ${l.file}:${l.line}${sig}`
}

function noEngine(): ToolResult {
  return { content: 'Context engine is not available in this session.', isError: true }
}

const jdcSearch: ToolHandler = {
  definition: {
    name: 'jdc_search',
    description:
      'Quick symbol search by name across the project. Returns matching definitions with file:line. Backed by the always-up-to-date JDC Context Engine (no manual indexing needed).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Symbol name or partial name' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (!q) return noEngine()
    const results = q.search(String(input.query), Number(input.limit) || 10)
    if (results.length === 0) return withStatus(context, `No symbols matching "${input.query}".`)
    return withStatus(context, results.map(fmtLoc).join('\n'))
  },
}

const jdcContext: ToolHandler = {
  definition: {
    name: 'jdc_context',
    description:
      'PRIMARY code-intelligence tool. For any "how does X work", architecture, feature, or bug-context question, call this FIRST. Composes symbol search + callers/callees + key source in one call. Returns entry points, related symbols, and code snippets.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Description of the task, bug, or feature to build context for' },
        maxNodes: { type: 'number', description: 'Max symbols to include (default 20)' },
        includeCode: { type: 'boolean', description: 'Include source snippets (default true)' },
      },
      required: ['task'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (!q) return noEngine()
    const res = await q.context(
      String(input.task),
      Number(input.maxNodes) || 20,
      input.includeCode !== false,
    )
    const parts: string[] = []
    if (res.entryPoints.length) {
      parts.push('## Entry points\n' + res.entryPoints.map(fmtLoc).join('\n'))
    }
    if (res.related.length) {
      parts.push('## Related symbols\n' + res.related.map(fmtLoc).join('\n'))
    }
    for (const k of res.keyCode) {
      parts.push(`## ${k.symbol} — ${k.file}\n\`\`\`\n${k.code}\n\`\`\``)
    }
    if (res.gitChanges && res.gitChanges.length) {
      parts.push(
        '## 当前未提交改动\n' +
          res.gitChanges.map((c) => `- [${c.status}] ${c.path}`).join('\n'),
      )
    }
    if (res.gitHotFiles && res.gitHotFiles.length) {
      parts.push(
        '## 近期热区文件\n' +
          res.gitHotFiles.map((h) => `- ${h.path} (${h.commits} commits)`).join('\n'),
      )
    }
    if (parts.length === 0) return withStatus(context, `No relevant code found for "${input.task}".`)
    return withStatus(context, parts.join('\n\n'))
  },
}

const jdcNode: ToolHandler = {
  definition: {
    name: 'jdc_node',
    description:
      "Get one symbol's details (location, signature) plus its trail — what it calls and what calls it, each with file:line. Pass includeCode=true for the full source body. Use this to walk the call graph hop-by-hop.",
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol name' },
        includeCode: { type: 'boolean', description: 'Include full source (default false)' },
      },
      required: ['symbol'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (!q) return noEngine()
    const detail = await q.node(String(input.symbol), input.includeCode === true)
    if (!detail) return { content: `Symbol "${input.symbol}" not found.` }
    const parts: string[] = [
      `${detail.kind} ${detail.name} — ${detail.file}:${detail.line}-${detail.endLine}`,
    ]
    if (detail.signature) parts.push(`signature: ${detail.signature}`)
    parts.push('\n### Calls (callees)\n' + (detail.callees.length ? detail.callees.map(fmtLoc).join('\n') : '(none found statically)'))
    parts.push('\n### Called by (callers)\n' + (detail.callers.length ? detail.callers.map(fmtLoc).join('\n') : '(none found statically)'))
    if (detail.code) parts.push(`\n### Source\n\`\`\`\n${detail.code}\n\`\`\``)
    return { content: parts.join('\n') }
  },
}

const jdcCallers: ToolHandler = {
  definition: {
    name: 'jdc_callers',
    description: 'Find all functions/methods that call a given symbol. Useful for understanding usage and change impact.',
    inputSchema: {
      type: 'object',
      properties: { symbol: { type: 'string', description: 'Symbol name to find callers for' } },
      required: ['symbol'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (!q) return noEngine()
    const callers = q.callers(String(input.symbol))
    if (callers.length === 0) return { content: `No callers found for "${input.symbol}".` }
    return { content: callers.map(fmtLoc).join('\n') }
  },
}

const jdcCallees: ToolHandler = {
  definition: {
    name: 'jdc_callees',
    description: 'Find all functions/methods that a given symbol calls. Useful for understanding dependencies and code flow.',
    inputSchema: {
      type: 'object',
      properties: { symbol: { type: 'string', description: 'Symbol name to find callees for' } },
      required: ['symbol'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (!q) return noEngine()
    const callees = q.callees(String(input.symbol))
    if (callees.length === 0) return { content: `No callees found for "${input.symbol}".` }
    return { content: callees.map(fmtLoc).join('\n') }
  },
}

const jdcImpact: ToolHandler = {
  definition: {
    name: 'jdc_impact',
    description: 'Analyze the impact radius of changing a symbol — everything that transitively calls it, up to a depth.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'Symbol to analyze' },
        depth: { type: 'number', description: 'Levels to traverse (default 2)' },
      },
      required: ['symbol'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (!q) return noEngine()
    const impacted = q.impact(String(input.symbol), Number(input.depth) || 2)
    if (impacted.length === 0) return { content: `No code appears to be impacted by changing "${input.symbol}".` }
    return { content: `Changing "${input.symbol}" may affect:\n` + impacted.map(fmtLoc).join('\n') }
  },
}

const jdcTrace: ToolHandler = {
  definition: {
    name: 'jdc_trace',
    description: 'Trace the call path between two symbols — "how does <from> reach <to>?" Returns the chain of functions, or reports no static path exists.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Symbol the flow starts at' },
        to: { type: 'string', description: 'Symbol the flow should reach' },
      },
      required: ['from', 'to'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (!q) return noEngine()
    const path = q.trace(String(input.from), String(input.to))
    if (!path) return { content: `No static call path found from "${input.from}" to "${input.to}". The chain may break at dynamic dispatch (callbacks/interfaces).` }
    return { content: path.map((l, i) => `${i === 0 ? '' : '→ '}${fmtLoc(l)}`).join('\n') }
  },
}

const jdcExplore: ToolHandler = {
  definition: {
    name: 'jdc_explore',
    description: 'Return source for several related symbols at once, grouped by file. Efficient way to inspect many symbols together. Pass an array of symbol names.',
    inputSchema: {
      type: 'object',
      properties: {
        symbols: { type: 'array', items: { type: 'string' }, description: 'Symbol names to fetch source for' },
      },
      required: ['symbols'],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (!q) return noEngine()
    const names = Array.isArray(input.symbols) ? (input.symbols as unknown[]).map(String) : []
    const results = await q.explore(names)
    if (results.length === 0) return { content: 'No matching symbols found.' }
    return { content: results.map((r) => `## ${r.symbol} — ${r.file}\n\`\`\`\n${r.code}\n\`\`\``).join('\n\n') }
  },
}

const jdcFiles: ToolHandler = {
  definition: {
    name: 'jdc_files',
    description: 'Get the indexed project file structure with per-file symbol counts. Fast overview of project organization.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Filter to files under this directory (project-relative)' },
      },
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const q = await getQuery(context)
    if (!q) return noEngine()
    const engine = resolveEngine(context)!
    const filter = input.path ? String(input.path) : ''
    const files = engine
      .getStore()
      .allFiles()
      .filter((f) => !filter || f.filePath.startsWith(filter))
      .sort((a, b) => a.filePath.localeCompare(b.filePath))
    if (files.length === 0) return { content: 'No indexed files.' }
    const lines = files.map((f) => `${f.filePath} (${f.language}, ${f.symbols.length} symbols)`)
    const stats = engine.stats()
    return withStatus(context, `${stats.files} files, ${stats.symbols} symbols indexed.\n\n${lines.join('\n')}`)
  },
}

export function createContextEngineTools(): ToolHandler[] {
  return [
    jdcContext,
    jdcSearch,
    jdcNode,
    jdcCallers,
    jdcCallees,
    jdcImpact,
    jdcTrace,
    jdcExplore,
    jdcFiles,
  ]
}
