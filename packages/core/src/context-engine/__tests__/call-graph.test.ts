import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ContextEngine } from '../engine.js'
import { EngineQuery } from '../query.js'

// A small project with a known call chain:
//   main() -> service() -> helper()
//   other() -> helper()
function setupProject(): string {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ctxeng-graph-'))
  mkdirSync(path.join(tmp, 'src'), { recursive: true })
  writeFileSync(
    path.join(tmp, 'src', 'helper.ts'),
    'export function helper(x: number) { return x + 1 }\n',
  )
  writeFileSync(
    path.join(tmp, 'src', 'service.ts'),
    [
      "import { helper } from './helper'",
      'export function service(n: number) {',
      '  return helper(n)',
      '}',
    ].join('\n'),
  )
  writeFileSync(
    path.join(tmp, 'src', 'main.ts'),
    [
      "import { service } from './service'",
      "import { helper } from './helper'",
      'export function main() {',
      '  return service(1)',
      '}',
      'export function other() {',
      '  return helper(2)',
      '}',
    ].join('\n'),
  )
  return tmp
}

describe('context-engine: call graph', () => {
  let engine: ContextEngine
  let q: EngineQuery

  beforeAll(async () => {
    const tmp = setupProject()
    engine = new ContextEngine(tmp)
    await engine.index()
    q = new EngineQuery(engine)
  })

  it('finds direct callees', () => {
    const callees = q.callees('service').map((c) => c.name)
    expect(callees).toContain('helper')
  })

  it('finds direct callers', () => {
    const callers = q.callers('helper').map((c) => c.name).sort()
    expect(callers).toContain('service')
    expect(callers).toContain('other')
  })

  it('computes transitive impact of changing helper', () => {
    const impacted = q.impact('helper', 3).map((s) => s.name)
    // service calls helper; main calls service → both impacted
    expect(impacted).toContain('service')
    expect(impacted).toContain('other')
    expect(impacted).toContain('main')
  })

  it('traces a call path main -> helper', () => {
    const trace = q.trace('main', 'helper')
    expect(trace).not.toBeNull()
    const names = trace!.map((s) => s.name)
    expect(names[0]).toBe('main')
    expect(names[names.length - 1]).toBe('helper')
    expect(names).toContain('service')
  })

  it('returns null trace when unreachable', () => {
    const trace = q.trace('helper', 'main')
    expect(trace).toBeNull()
  })

  it('node() returns callers + callees + source code', async () => {
    const detail = await q.node('service', true)
    expect(detail).not.toBeNull()
    expect(detail!.callees.map((c) => c.name)).toContain('helper')
    expect(detail!.callers.map((c) => c.name)).toContain('main')
    expect(detail!.code).toContain('function service')
  })

  it('context() assembles entry points from a task description', async () => {
    const ctx = await q.context('how does service call helper')
    const entryNames = ctx.entryPoints.map((e) => e.name)
    expect(entryNames).toContain('service')
    expect(entryNames).toContain('helper')
    expect(ctx.keyCode.length).toBeGreaterThan(0)
  })
})
