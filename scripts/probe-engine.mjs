// JDC Context Engine 手动探测 CLI
//
// 用法:
//   node scripts/probe-engine.mjs [项目路径]
//   node scripts/probe-engine.mjs [项目路径] --symbol <符号名>
//   node scripts/probe-engine.mjs [项目路径] --trace <from> <to>
//
// 不带参数时对本仓库自身建索引并跑一组演示查询。

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

// 指向编译产物里的 tree-sitter wasm（与 electron 生产路径一致）。
const tsDir = path.join(root, 'packages/electron/dist/tree-sitter')
process.env.JDC_TREE_SITTER_WASM_DIR = tsDir
process.env.JDC_GRAMMAR_WASM_DIR = path.join(tsDir, 'grammars')

const { getContextEngine, EngineQuery } = await import(
  path.join(root, 'packages/core/dist/context-engine/index.js')
)

const args = process.argv.slice(2)
const target = args[0] && !args[0].startsWith('--') ? path.resolve(args[0]) : root

function header(t) {
  console.log('\n' + '─'.repeat(56) + '\n' + t + '\n' + '─'.repeat(56))
}

const t0 = Date.now()
header(`建立索引: ${target}`)
const engine = getContextEngine(target)
await engine.index((p) => {
  if (p.scanned % 50 === 0 || p.scanned === p.total) {
    process.stdout.write(`\r  扫描 ${p.scanned}/${p.total}`)
  }
})
const stats = engine.stats()
console.log(
  `\n  ✓ ${stats.files} 文件, ${stats.symbols} 符号, ${stats.references} 引用` +
    `  (${Date.now() - t0}ms)`,
)

const q = new EngineQuery(engine)

// 解析自定义查询参数
const symFlag = args.indexOf('--symbol')
const traceFlag = args.indexOf('--trace')

if (symFlag >= 0) {
  const name = args[symFlag + 1]
  header(`符号: ${name}`)
  const node = await q.node(name, true)
  console.log(JSON.stringify({ ...node, code: node?.code?.slice(0, 300) }, null, 2))
} else if (traceFlag >= 0) {
  const from = args[traceFlag + 1]
  const to = args[traceFlag + 2]
  header(`调用路径: ${from} → ${to}`)
  const trace = q.trace(from, to)
  console.log(trace ? trace.map((s) => `${s.name}  ${s.file}:${s.line}`).join('\n  ↓ ') : '无静态路径')
} else {
  // 默认演示：挑一个真实符号跑全套查询
  const demo = ['ContextEngine', 'parseFile', 'EngineQuery', 'buildCallGraph']
  const pick = demo.find((d) => engine.symbolsByName(d).length > 0) || engine.searchSymbols('', 1)[0]?.name
  header(`搜索 "Engine"（前 8 个）`)
  for (const s of q.search('Engine', 8)) console.log(`  ${s.kind.padEnd(10)} ${s.name}  —  ${s.file}:${s.line}`)

  header(`符号详情: ${pick}（调用 trail）`)
  const node = await q.node(pick, false)
  if (node) {
    console.log(`  位置: ${node.file}:${node.line}-${node.endLine}`)
    console.log(`  调用了 (callees): ${node.callees.map((c) => c.name).join(', ') || '(无)'}`)
    console.log(`  被调用 (callers): ${node.callers.map((c) => c.name).join(', ') || '(无)'}`)
  }

  header(`影响半径: ${pick}（改它会波及谁，深度 3）`)
  for (const s of q.impact(pick, 3)) console.log(`  ${s.name}  —  ${s.file}:${s.line}`)

  header(`自动上下文: "如何解析文件并提取符号"`)
  const ctx = await q.context('如何解析文件并提取符号', 10, false)
  console.log('  入口符号:', ctx.entryPoints.map((e) => e.name).join(', '))
  if (ctx.gitChanges?.length) console.log('  当前改动:', ctx.gitChanges.slice(0, 5).map((c) => c.path).join(', '))
  if (ctx.gitHotFiles?.length) console.log('  热区文件:', ctx.gitHotFiles.slice(0, 3).map((h) => `${h.path}(${h.commits})`).join(', '))
}

console.log('\n完成。\n')
