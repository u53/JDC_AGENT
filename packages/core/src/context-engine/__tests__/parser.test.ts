import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { ContextEngine } from '../engine.js'
import { parseFile } from '../parser/parser.js'

describe('context-engine: parser', () => {
  it('extracts TS function/class/method definitions and call references', async () => {
    const code = [
      "import { foo } from './bar'",
      'export function greet(name: string): string {',
      '  return foo(name)',
      '}',
      'class Service {',
      '  run() { return greet("x") }',
      '}',
    ].join('\n')
    const idx = await parseFile('src/a.ts', 'typescript', code)
    expect(idx).not.toBeNull()
    const names = idx!.symbols.map((s) => `${s.kind}:${s.name}`).sort()
    expect(names).toContain('function:greet')
    expect(names).toContain('class:Service')
    expect(names).toContain('method:run')
    const callNames = idx!.references.filter((r) => r.kind === 'call').map((r) => r.name)
    expect(callNames).toContain('foo')
    expect(callNames).toContain('greet')
    // import binding captured
    expect(idx!.imports.some((i) => i.source === './bar' || i.localName === 'foo')).toBe(true)
  })

  it('attributes a reference to its enclosing symbol', async () => {
    const code = [
      'function outer() {',
      '  helper()',
      '}',
      'function helper() {}',
    ].join('\n')
    const idx = await parseFile('src/b.ts', 'typescript', code)
    const ref = idx!.references.find((r) => r.name === 'helper' && r.kind === 'call')
    const outer = idx!.symbols.find((s) => s.name === 'outer')
    expect(ref?.enclosingSymbolId).toBe(outer?.id)
  })

  it('parses Python definitions and calls', async () => {
    const code = [
      'def greet(name):',
      '    return helper(name)',
      '',
      'class Service:',
      '    def run(self):',
      '        return greet("x")',
    ].join('\n')
    const idx = await parseFile('src/c.py', 'python', code)
    const names = idx!.symbols.map((s) => `${s.kind}:${s.name}`)
    expect(names).toContain('function:greet')
    expect(names).toContain('class:Service')
    expect(idx!.references.map((r) => r.name)).toContain('helper')
  })

  it('parses Go definitions', async () => {
    const code = [
      'package main',
      'func Greet(name string) string {',
      '\treturn helper(name)',
      '}',
    ].join('\n')
    const idx = await parseFile('src/d.go', 'go', code)
    expect(idx!.symbols.map((s) => s.name)).toContain('Greet')
    expect(idx!.references.map((r) => r.name)).toContain('helper')
  })

  it('parses Rust definitions and calls', async () => {
    const code = 'fn greet(n: &str) -> String { helper(n) }\nstruct Service { id: u32 }\nenum Color { Red }\ntrait Run { fn run(&self); }'
    const idx = await parseFile('src/e.rs', 'rust', code)
    const names = idx!.symbols.map((s) => `${s.kind}:${s.name}`)
    expect(names).toContain('function:greet')
    expect(names).toContain('struct:Service')
    expect(names).toContain('enum:Color')
    expect(idx!.references.map((r) => r.name)).toContain('helper')
  })

  it('parses Java definitions and calls', async () => {
    const code = 'class Service {\n  public String greet(String n) { return helper(n); }\n  void run() { greet("x"); }\n}'
    const idx = await parseFile('src/F.java', 'java', code)
    const names = idx!.symbols.map((s) => `${s.kind}:${s.name}`)
    expect(names).toContain('class:Service')
    expect(names).toContain('method:greet')
    expect(idx!.references.map((r) => r.name)).toContain('helper')
  })

  it('parses C definitions and calls', async () => {
    const code = 'int add(int a, int b) { return a + b; }\nint main() { return add(1, 2); }\nstruct Point { int x; };'
    const idx = await parseFile('src/g.c', 'c', code)
    const names = idx!.symbols.map((s) => `${s.kind}:${s.name}`)
    expect(names).toContain('function:add')
    expect(names).toContain('struct:Point')
    expect(idx!.references.map((r) => r.name)).toContain('add')
  })

  it('parses C++ definitions and calls', async () => {
    const code = 'class Widget {\npublic:\n  int area() { return compute(); }\n};\nint compute() { return 42; }'
    const idx = await parseFile('src/h.cpp', 'cpp', code)
    const names = idx!.symbols.map((s) => `${s.kind}:${s.name}`)
    expect(names).toContain('class:Widget')
    expect(names).toContain('function:compute')
    expect(idx!.references.map((r) => r.name)).toContain('compute')
  })

  it('parses Ruby definitions and calls', async () => {
    const code = 'class Service\n  def greet(name)\n    helper(name)\n  end\nend\nmodule Helpers\n  def util; end\nend'
    const idx = await parseFile('src/i.rb', 'ruby', code)
    const names = idx!.symbols.map((s) => `${s.kind}:${s.name}`)
    expect(names).toContain('class:Service')
    expect(names).toContain('module:Helpers')
    expect(idx!.references.map((r) => r.name)).toContain('helper')
  })

  it('parses PHP definitions and calls', async () => {
    const code = '<?php\nfunction greet($name) { return helper($name); }\nclass Service {\n  public function run() { return greet("x"); }\n}'
    const idx = await parseFile('src/j.php', 'php', code)
    const names = idx!.symbols.map((s) => `${s.kind}:${s.name}`)
    expect(names).toContain('function:greet')
    expect(names).toContain('class:Service')
    expect(idx!.references.map((r) => r.name)).toContain('helper')
  })
})

describe('context-engine: full scan', () => {
  let tmp: string
  beforeAll(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'ctxeng-'))
    mkdirSync(path.join(tmp, 'src'), { recursive: true })
    writeFileSync(
      path.join(tmp, 'src', 'math.ts'),
      'export function add(a: number, b: number) { return a + b }\nexport function mul(a: number, b: number) { return a * b }\n',
    )
    writeFileSync(
      path.join(tmp, 'src', 'app.ts'),
      "import { add } from './math'\nexport function main() { return add(1, 2) }\n",
    )
    // a file that must be ignored
    mkdirSync(path.join(tmp, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(path.join(tmp, 'node_modules', 'pkg', 'x.ts'), 'export function ignored() {}\n')
  })

  it('indexes project files and skips node_modules', async () => {
    const engine = new ContextEngine(tmp)
    await engine.index()
    expect(engine.isIndexed()).toBe(true)
    const stats = engine.stats()
    expect(stats.files).toBe(2)
    expect(engine.symbolsByName('add').length).toBe(1)
    expect(engine.symbolsByName('ignored').length).toBe(0)
    const found = engine.searchSymbols('ma')
    expect(found.some((s) => s.name === 'main')).toBe(true)
  })

  it('cleans symbols when a file is removed', async () => {
    const engine = new ContextEngine(tmp)
    await engine.index()
    rmSync(path.join(tmp, 'src', 'math.ts'))
    engine.removeFile(path.join(tmp, 'src', 'math.ts'))
    expect(engine.symbolsByName('add').length).toBe(0)
  })
})
