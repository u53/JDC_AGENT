// Coverage tests across all 9 supported languages with realistic multi-construct
// source. Verified against the bundled tree-sitter-wasms 0.1.13 grammars. These
// assert not just "a symbol was found" but the correct KIND (method vs function,
// interface vs type) — the semantic distinction the engine relies on for smart
// queries — plus call-reference extraction.

import { describe, it, expect } from 'vitest'
import { parseFile } from '../parser/parser.js'

type Case = {
  lang: string
  ext: string
  code: string
  symbols: string[] // "kind:name" that MUST be present
  calls: string[] // call reference names that MUST be present
}

const CASES: Case[] = [
  {
    lang: 'typescript',
    ext: 'ts',
    code: [
      "import { foo } from './bar'",
      'export function greet(n: string) { return foo(n) }',
      'export const arrow = (x: number) => helper(x)',
      'class Service {',
      '  field = 1',
      '  run() { return greet("y") }',
      '  static make() { return new Service() }',
      '}',
      'interface Shape { area(): number }',
      'type Id = string',
      'enum Color { Red, Green }',
    ].join('\n'),
    symbols: [
      'function:greet',
      'variable:arrow',
      'class:Service',
      'method:run',
      'method:make',
      'interface:Shape',
      'type:Id',
      'enum:Color',
    ],
    calls: ['foo', 'greet', 'helper', 'Service'],
  },
  {
    lang: 'javascript',
    ext: 'js',
    code: [
      "import foo from './bar'",
      'export function greet(n) { return foo(n) }',
      'export const arrow = (x) => helper(x)',
      'class Service {',
      '  run() { return greet("y") }',
      '  static make() { return new Service() }',
      '}',
    ].join('\n'),
    symbols: ['function:greet', 'variable:arrow', 'class:Service', 'method:run', 'method:make'],
    calls: ['foo', 'greet', 'helper', 'Service'],
  },
  {
    lang: 'python',
    ext: 'py',
    code: [
      'import os',
      'from mod import thing',
      'def greet(name):',
      '    return helper(name)',
      'async def fetch():',
      '    return await get()',
      'class Service:',
      '    def run(self):',
      "        return greet('x')",
      '    @staticmethod',
      '    def make():',
      '        return Service()',
    ].join('\n'),
    symbols: ['function:greet', 'function:fetch', 'class:Service', 'method:run', 'method:make'],
    calls: ['helper', 'get', 'greet', 'Service'],
  },
  {
    lang: 'go',
    ext: 'go',
    code: [
      'package main',
      'import "fmt"',
      'func Greet(name string) string { return helper(name) }',
      'type Service struct { id int }',
      'type Runner interface { Run() error }',
      'func (s *Service) Run() error { fmt.Println(Greet("x")); return nil }',
    ].join('\n'),
    symbols: ['function:Greet', 'struct:Service', 'interface:Runner', 'method:Run'],
    calls: ['helper', 'Println', 'Greet'],
  },
  {
    lang: 'rust',
    ext: 'rs',
    code: [
      'use std::collections::HashMap;',
      'pub fn greet(n: &str) -> String { helper(n) }',
      'struct Service { id: u32 }',
      'enum Color { Red, Green }',
      'trait Run { fn run(&self); }',
      'impl Service {',
      '    pub fn new() -> Self { Service { id: 0 } }',
      '    fn run(&self) { greet("x"); }',
      '}',
    ].join('\n'),
    symbols: [
      'function:greet',
      'struct:Service',
      'enum:Color',
      'interface:Run',
      'method:new',
      'method:run',
    ],
    calls: ['helper', 'greet'],
  },
  {
    lang: 'java',
    ext: 'java',
    code: [
      'package com.example;',
      'import java.util.List;',
      'public class Service {',
      '  public String greet(String n) { return helper(n); }',
      '  void run() { greet("x"); }',
      '  static Service make() { return new Service(); }',
      '}',
      'interface Runner { void run(); }',
      'enum Color { RED, GREEN }',
    ].join('\n'),
    symbols: [
      'class:Service',
      'method:greet',
      'method:run',
      'method:make',
      'interface:Runner',
      'enum:Color',
    ],
    calls: ['helper', 'greet', 'Service'],
  },
  {
    lang: 'c',
    ext: 'c',
    code: [
      '#include <stdio.h>',
      '#include "local.h"',
      'int add(int a, int b) { return a + b; }',
      'int main() { return add(1, 2); }',
      'struct Point { int x; int y; };',
      'enum Status { OK, FAIL };',
    ].join('\n'),
    symbols: ['function:add', 'function:main', 'struct:Point', 'enum:Status'],
    calls: ['add'],
  },
  {
    lang: 'cpp',
    ext: 'cpp',
    code: [
      '#include <vector>',
      'class Widget {',
      'public:',
      '  int area() { return compute(); }',
      '};',
      'struct Point { int x; };',
      'int compute() { return 42; }',
      'enum class Mode { A, B };',
    ].join('\n'),
    symbols: ['class:Widget', 'method:area', 'struct:Point', 'function:compute'],
    calls: ['compute'],
  },
  {
    lang: 'ruby',
    ext: 'rb',
    code: [
      "require 'set'",
      'class Service',
      '  def greet(name)',
      '    helper(name)',
      '  end',
      '  def self.make',
      '    new',
      '  end',
      'end',
      'module Helpers',
      '  def util; end',
      'end',
    ].join('\n'),
    symbols: ['class:Service', 'method:greet', 'module:Helpers', 'method:util'],
    calls: ['helper'],
  },
  {
    lang: 'php',
    ext: 'php',
    code: [
      '<?php',
      'namespace App;',
      'function greet($name) { return helper($name); }',
      'class Service {',
      '  public function run() { return greet("x"); }',
      '  public static function make() { return new Service(); }',
      '}',
      'interface Runner { public function run(); }',
    ].join('\n'),
    symbols: ['function:greet', 'class:Service', 'method:run', 'method:make', 'interface:Runner'],
    calls: ['helper', 'greet', 'Service'],
  },
]

describe('context-engine: tags coverage (all languages)', () => {
  for (const c of CASES) {
    it(`${c.lang}: extracts correct symbol kinds and call references`, async () => {
      const idx = await parseFile(`probe.${c.ext}`, c.lang, c.code)
      expect(idx, `${c.lang} parse returned null`).not.toBeNull()
      const got = new Set(idx!.symbols.map((s) => `${s.kind}:${s.name}`))
      const missing = c.symbols.filter((w) => !got.has(w))
      expect(missing, `${c.lang} missing symbols. got: ${[...got].sort().join(', ')}`).toEqual([])

      const callNames = new Set(
        idx!.references.filter((r) => r.kind === 'call').map((r) => r.name),
      )
      const missingCalls = c.calls.filter((w) => !callNames.has(w))
      expect(
        missingCalls,
        `${c.lang} missing calls. got: ${[...callNames].sort().join(', ')}`,
      ).toEqual([])
    })
  }
})
