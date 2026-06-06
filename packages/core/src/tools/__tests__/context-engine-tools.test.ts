import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createContextEngineTools } from '../context-engine-tools.js'
import type { ToolContext } from '../../tool-registry.js'
import { getContextEngine } from '../../context-engine/index.js'
import type { ContextEngine } from '../../context-engine/engine.js'

function makeContext(cwd: string, engine?: ContextEngine): ToolContext {
  return { cwd, turnIndex: 0, ...(engine ? { contextEngine: engine } : {}) } as ToolContext
}

describe('Jdc* tools', () => {
  let cwd: string
  let engine: ContextEngine
  const tools = Object.fromEntries(createContextEngineTools().map((t) => [t.definition.name, t]))

  beforeAll(async () => {
    cwd = mkdtempSync(path.join(os.tmpdir(), 'jdc-tools-'))
    mkdirSync(path.join(cwd, 'src'), { recursive: true })
    writeFileSync(path.join(cwd, 'src', 'util.ts'), 'export function compute(x: number) { return x * 2 }\n')
    writeFileSync(
      path.join(cwd, 'src', 'main.ts'),
      "import { compute } from './util'\nexport function run() { return compute(21) }\n",
    )
    engine = getContextEngine(cwd)
    await engine.index()
  })

  it('JdcSearch returns degraded background-index response on a cold project', async () => {
    const coldCwd = mkdtempSync(path.join(os.tmpdir(), 'jdc-tools-cold-'))
    mkdirSync(path.join(coldCwd, 'src'), { recursive: true })
    writeFileSync(path.join(coldCwd, 'src', 'cold.ts'), 'export function coldStart() { return 1 }\n')

    const res = await tools.JdcSearch.execute({ query: 'coldStart' }, makeContext(coldCwd))

    expect(res.isError).toBeFalsy()
    expect(res.content).toContain('Code index is building in the background')
    expect(res.content).not.toContain('coldStart')
  })

  it('JdcSearch finds a symbol', async () => {
    const res = await tools.JdcSearch.execute({ query: 'compute' }, makeContext(cwd, engine))
    expect(res.isError).toBeFalsy()
    expect(res.content).toContain('compute')
    expect(res.content).toContain('src/util.ts')
  })

  it('JdcCallers finds the caller of compute', async () => {
    const res = await tools.JdcCallers.execute({ symbol: 'compute' }, makeContext(cwd, engine))
    expect(res.content).toContain('run')
  })

  it('JdcCallees finds the callee of run', async () => {
    const res = await tools.JdcCallees.execute({ symbol: 'run' }, makeContext(cwd, engine))
    expect(res.content).toContain('compute')
  })

  it('JdcNode returns trail with callees and source', async () => {
    const res = await tools.JdcNode.execute({ symbol: 'run', includeCode: true }, makeContext(cwd, engine))
    expect(res.content).toContain('compute')
    expect(res.content).toContain('function run')
  })

  it('JdcTrace finds path run -> compute', async () => {
    const res = await tools.JdcTrace.execute({ from: 'run', to: 'compute' }, makeContext(cwd, engine))
    expect(res.content).toContain('run')
    expect(res.content).toContain('compute')
  })

  it('JdcImpact finds transitive callers affected by compute', async () => {
    const res = await tools.JdcImpact.execute({ symbol: 'compute', depth: 2 }, makeContext(cwd, engine))
    expect(res.content).toContain('run')
  })

  it('JdcContext assembles context for a task', async () => {
    const res = await tools.JdcContext.execute({ task: 'how does run use compute' }, makeContext(cwd, engine))
    expect(res.content).toContain('compute')
  })

  it('JdcExplore returns source for requested symbols', async () => {
    const res = await tools.JdcExplore.execute({ symbols: ['run', 'compute'] }, makeContext(cwd, engine))
    expect(res.content).toContain('function run')
    expect(res.content).toContain('function compute')
  })

  it('JdcFiles lists indexed files with language groups and representative symbols', async () => {
    const res = await tools.JdcFiles.execute({}, makeContext(cwd, engine))
    expect(res.content).toContain('Languages:')
    expect(res.content).toContain('typescript: 2 files, 2 symbols')
    expect(res.content).toContain('src/util.ts (source, typescript, 1 symbols) Top symbols: function compute')
    expect(res.content).toContain('src/main.ts (entrypoint, typescript, 1 symbols) Top symbols: function run')
  })
})
