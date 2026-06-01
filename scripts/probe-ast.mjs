// Dump AST node structure for specific constructs to verify node names against
// the actually-bundled grammar versions (tree-sitter-wasms 0.1.13).
import { createParser } from '../packages/core/src/context-engine/parser/ts-loader.ts'

async function dump(lang, code, label) {
  const parser = await createParser(lang)
  const tree = parser.parse(code)
  console.log(`\n### ${label} (${lang})`)
  const walk = (n, depth) => {
    if (depth > 6) return
    const txt = n.childCount === 0 ? ` "${n.text.slice(0, 24)}"` : ''
    console.log('  '.repeat(depth) + `${n.type}${n.isNamed ? '' : ' (anon)'}${txt}`)
    for (let i = 0; i < n.namedChildCount; i++) walk(n.namedChild(i), depth + 1)
  }
  walk(tree.rootNode, 0)
  parser.delete()
}

await dump('cpp', `class Widget {
public:
  int area() { return compute(); }
};`, 'C++ in-class method')

await dump('go', `type Runner interface { Run() error }`, 'Go interface')

await dump('rust', `impl Service {
  pub fn new() -> Self { Service { id: 0 } }
  fn run(&self) { greet("x"); }
}`, 'Rust impl methods')

await dump('python', `class Service:
    def run(self):
        return greet('x')`, 'Python class method')

await dump('cpp', `int compute() { return 42; }`, 'C++ free function')

await dump('java', `record Point(int x, int y) {}`, 'Java record')
