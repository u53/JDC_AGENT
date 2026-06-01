import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createContextEngineTools } from '../context-engine-tools.js'
import type { ToolContext } from '../../tool-registry.js'

function makeContext(cwd: string): ToolContext {
  return { cwd, turnIndex: 0 } as ToolContext
}

describe('Jdc* tools', () => {
  let cwd: string
  const tools = Object.fromEntries(createContextEngineTools().map((t) => [t.definition.name, t]))

  beforeAll(() => {
    cwd = mkdtempSync(path.join(os.tmpdir(), 'jdc-tools-'))
    mkdirSync(path.join(cwd, 'src'), { recursive: true })
    writeFileSync(path.join(cwd, 'src', 'util.ts'), 'export function compute(x: number) { return x * 2 }\n')
    writeFileSync(
      path.join(cwd, 'src', 'main.ts'),
      "import { compute } from './util'\nexport function run() { return compute(21) }\n",
    )
  })

  it('JdcSearch finds a symbol', async () => {
    const res = await tools.JdcSearch.execute({ query: 'compute' }, makeContext(cwd))
    expect(res.isError).toBeFalsy()
    expect(res.content).toContain('compute')
    expect(res.content).toContain('src/util.ts')
  })

  it('JdcCallers finds the caller of compute', async () => {
    const res = await tools.JdcCallers.execute({ symbol: 'compute' }, makeContext(cwd))
    expect(res.content).toContain('run')
  })

  it('JdcNode returns trail with callees and source', async () => {
    const res = await tools.JdcNode.execute({ symbol: 'run', includeCode: true }, makeContext(cwd))
    expect(res.content).toContain('compute')
    expect(res.content).toContain('function run')
  })

  it('JdcTrace finds path run -> compute', async () => {
    const res = await tools.JdcTrace.execute({ from: 'run', to: 'compute' }, makeContext(cwd))
    expect(res.content).toContain('run')
    expect(res.content).toContain('compute')
  })

  it('JdcContext assembles context for a task', async () => {
    const res = await tools.JdcContext.execute({ task: 'how does run use compute' }, makeContext(cwd))
    expect(res.content).toContain('compute')
  })

  it('JdcFiles lists indexed files', async () => {
    const res = await tools.JdcFiles.execute({}, makeContext(cwd))
    expect(res.content).toContain('src/util.ts')
    expect(res.content).toContain('src/main.ts')
  })
})
