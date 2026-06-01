// Coverage probe: feed realistic multi-construct code per language through the
// CURRENT handwritten tags queries and print what symbols/refs are extracted.
// This is the TDD "red" step — exposes silent under-extraction before rework.
//
// Run: node --import tsx scripts/probe-tags.mjs   (from packages/core)

import { parseFile } from '../packages/core/src/context-engine/parser/parser.ts'

const CASES = {
  typescript: {
    ext: 'ts',
    code: `import { foo } from './bar'
export function greet(n: string) { return foo(n) }
export const arrow = (x: number) => helper(x)
export const obj = { method() { return greet('x') } }
class Service {
  field = 1
  run() { return greet('y') }
  static make() { return new Service() }
}
interface Shape { area(): number }
type Id = string
enum Color { Red, Green }
const lambda = function named() { return 1 }`,
    want: ['function:greet', 'class:Service', 'method:run', 'interface:Shape', 'type:Id', 'enum:Color', 'variable:arrow'],
  },
  javascript: {
    ext: 'js',
    code: `import foo from './bar'
export function greet(n) { return foo(n) }
export const arrow = (x) => helper(x)
class Service {
  run() { return greet('y') }
  static make() { return new Service() }
}
const obj = { method() { return greet('x') } }`,
    want: ['function:greet', 'class:Service', 'method:run', 'variable:arrow'],
  },
  python: {
    ext: 'py',
    code: `import os
from mod import thing
def greet(name):
    return helper(name)
async def fetch():
    return await get()
class Service:
    attr = 1
    def run(self):
        return greet('x')
    @staticmethod
    def make():
        return Service()
lam = lambda x: helper(x)`,
    want: ['function:greet', 'function:fetch', 'class:Service', 'method:run', 'method:make'],
  },
  go: {
    ext: 'go',
    code: `package main
import "fmt"
func Greet(name string) string { return helper(name) }
type Service struct { id int }
type Runner interface { Run() error }
func (s *Service) Run() error { fmt.Println(Greet("x")); return nil }
const Pi = 3.14
var Global = 1`,
    want: ['function:Greet', 'type:Service', 'method:Run', 'interface:Runner'],
  },
  rust: {
    ext: 'rs',
    code: `use std::collections::HashMap;
pub fn greet(n: &str) -> String { helper(n) }
struct Service { id: u32 }
enum Color { Red, Green }
trait Run { fn run(&self); }
impl Service {
    pub fn new() -> Self { Service { id: 0 } }
    fn run(&self) { greet("x"); }
}
const MAX: u32 = 100;
macro_rules! my_macro { () => {}; }`,
    want: ['function:greet', 'struct:Service', 'enum:Color', 'interface:Run', 'method:new', 'method:run'],
  },
  java: {
    ext: 'java',
    code: `package com.example;
import java.util.List;
public class Service {
  private int field;
  public String greet(String n) { return helper(n); }
  void run() { greet("x"); }
  static Service make() { return new Service(); }
}
interface Runner { void run(); }
enum Color { RED, GREEN }
record Point(int x, int y) {}`,
    want: ['class:Service', 'method:greet', 'method:run', 'interface:Runner', 'enum:Color'],
  },
  c: {
    ext: 'c',
    code: `#include <stdio.h>
#include "local.h"
int add(int a, int b) { return a + b; }
int main() { return add(1, 2); }
struct Point { int x; int y; };
typedef struct { int v; } Wrapper;
enum Status { OK, FAIL };
void (*callback)(int);`,
    want: ['function:add', 'function:main', 'struct:Point', 'enum:Status'],
  },
  cpp: {
    ext: 'cpp',
    code: `#include <vector>
namespace app {
class Widget {
public:
  int area() { return compute(); }
  Widget() {}
};
struct Point { int x; };
int compute() { return 42; }
template<typename T> T identity(T v) { return v; }
enum class Mode { A, B };
}`,
    want: ['class:Widget', 'struct:Point', 'function:compute', 'method:area'],
  },
  ruby: {
    ext: 'rb',
    code: `require 'set'
class Service
  def greet(name)
    helper(name)
  end
  def self.make
    new
  end
end
module Helpers
  def util; end
end
def standalone; greet('x'); end`,
    want: ['class:Service', 'method:greet', 'module:Helpers', 'method:standalone'],
  },
  php: {
    ext: 'php',
    code: `<?php
namespace App;
use Other\\Thing;
function greet($name) { return helper($name); }
class Service {
  public $field;
  public function run() { return greet("x"); }
  public static function make() { return new Service(); }
}
interface Runner { public function run(); }
trait Loggable { public function log() {} }`,
    want: ['function:greet', 'class:Service', 'method:run', 'interface:Runner'],
  },
}

let totalMissing = 0
for (const [lang, { ext, code, want }] of Object.entries(CASES)) {
  try {
    const idx = await parseFile(`probe.${ext}`, lang, code)
    if (!idx) { console.log(`\n### ${lang}: PARSE RETURNED NULL`); continue }
    const got = new Set(idx.symbols.map((s) => `${s.kind}:${s.name}`))
    const missing = want.filter((w) => !got.has(w))
    const calls = idx.references.filter((r) => r.kind === 'call').map((r) => r.name)
    console.log(`\n### ${lang}`)
    console.log(`  symbols: ${[...got].sort().join(', ') || '(none)'}`)
    console.log(`  calls:   ${[...new Set(calls)].sort().join(', ') || '(none)'}`)
    if (missing.length) { console.log(`  ❌ MISSING: ${missing.join(', ')}`); totalMissing += missing.length }
    else console.log(`  ✓ all expected symbols present`)
  } catch (err) {
    console.log(`\n### ${lang}: ERROR — ${err.message}`)
    totalMissing += want.length
  }
}
console.log(`\n${'='.repeat(56)}\nTotal missing expected symbols: ${totalMissing}\n`)
