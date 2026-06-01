// Tree-sitter tag queries per language. Captures follow a uniform convention so
// the extractor stays language-agnostic:
//   @definition.<kind>   on the NAME node of a definition (function/class/...)
//   @reference.call      on the callee identifier of a call expression
//   @import.source        on a module specifier string
//   @import.name          on a local imported identifier
//
// These are name-based (not type-resolved) — same approach CodeGraph used.

import type { SymbolKind } from '../types.js'

/** Map a capture suffix to our SymbolKind. */
export const DEFINITION_KIND: Record<string, SymbolKind> = {
  function: 'function',
  method: 'method',
  class: 'class',
  interface: 'interface',
  type: 'type',
  enum: 'enum',
  struct: 'struct',
  variable: 'variable',
  constant: 'constant',
  module: 'module',
}

const TS_JS_QUERY = `
(function_declaration name: (identifier) @definition.function)
(generator_function_declaration name: (identifier) @definition.function)
(method_definition name: (property_identifier) @definition.method)
(class_declaration name: (type_identifier) @definition.class)
(abstract_class_declaration name: (type_identifier) @definition.class)
(interface_declaration name: (type_identifier) @definition.interface)
(type_alias_declaration name: (type_identifier) @definition.type)
(enum_declaration name: (identifier) @definition.enum)
(variable_declarator name: (identifier) @definition.variable)
(public_field_definition name: (property_identifier) @definition.variable)

(call_expression function: (identifier) @reference.call)
(call_expression function: (member_expression property: (property_identifier) @reference.call))
(new_expression constructor: (identifier) @reference.call)

(import_statement source: (string (string_fragment) @import.source))
(import_specifier name: (identifier) @import.name)
(import_clause (identifier) @import.name)
(namespace_import (identifier) @import.name)
`

// JavaScript grammar lacks TS-only nodes (type_identifier, interface/type/enum
// declarations, public_field_definition with property_identifier differs).
// Using TS_JS_QUERY against the JS grammar throws "Bad node name". Keep a
// JS-safe subset here.
const JS_QUERY = `
(function_declaration name: (identifier) @definition.function)
(generator_function_declaration name: (identifier) @definition.function)
(method_definition name: (property_identifier) @definition.method)
(class_declaration name: (identifier) @definition.class)
(variable_declarator name: (identifier) @definition.variable)
(field_definition property: (property_identifier) @definition.variable)

(call_expression function: (identifier) @reference.call)
(call_expression function: (member_expression property: (property_identifier) @reference.call))
(new_expression constructor: (identifier) @reference.call)

(import_statement source: (string (string_fragment) @import.source))
(import_specifier name: (identifier) @import.name)
(import_clause (identifier) @import.name)
(namespace_import (identifier) @import.name)
`

// A function_definition nested directly in a class body is a method. It also
// matches the generic function pattern; the parser dedups by specificity
// (method > function for the same node).
const PYTHON_QUERY = `
(function_definition name: (identifier) @definition.function)
(class_definition body: (block (function_definition name: (identifier) @definition.method)))
(class_definition body: (block (decorated_definition (function_definition name: (identifier) @definition.method))))
(class_definition name: (identifier) @definition.class)
(call function: (identifier) @reference.call)
(call function: (attribute attribute: (identifier) @reference.call))
(import_from_statement module_name: (dotted_name) @import.source)
(import_statement name: (dotted_name) @import.source)
`

// Go: a type_spec carries either a struct_type or interface_type body. Emit the
// specific kind plus a generic `type` fallback (type aliases); parser dedups.
const GO_QUERY = `
(function_declaration name: (identifier) @definition.function)
(method_declaration name: (field_identifier) @definition.method)
(type_declaration (type_spec name: (type_identifier) @definition.struct type: (struct_type)))
(type_declaration (type_spec name: (type_identifier) @definition.interface type: (interface_type)))
(type_declaration (type_spec name: (type_identifier) @definition.type))
(call_expression function: (identifier) @reference.call)
(call_expression function: (selector_expression field: (field_identifier) @reference.call))
(import_spec path: (interpreted_string_literal) @import.source)
`

// Rust: function_item inside an impl block is a method (same node type as a
// free function); parser dedups method > function for the same node.
const RUST_QUERY = `
(function_item name: (identifier) @definition.function)
(impl_item (declaration_list (function_item name: (identifier) @definition.method)))
(struct_item name: (type_identifier) @definition.struct)
(enum_item name: (type_identifier) @definition.enum)
(trait_item name: (type_identifier) @definition.interface)
(type_item name: (type_identifier) @definition.type)
(call_expression function: (identifier) @reference.call)
(call_expression function: (field_expression field: (field_identifier) @reference.call))
(use_declaration argument: (scoped_identifier) @import.source)
`

const JAVA_QUERY = `
(method_declaration name: (identifier) @definition.method)
(class_declaration name: (identifier) @definition.class)
(interface_declaration name: (identifier) @definition.interface)
(enum_declaration name: (identifier) @definition.enum)
(method_invocation name: (identifier) @reference.call)
(object_creation_expression type: (type_identifier) @reference.call)
(import_declaration (scoped_identifier) @import.source)
`

const C_QUERY = `
(function_definition declarator: (function_declarator declarator: (identifier) @definition.function))
(struct_specifier name: (type_identifier) @definition.struct)
(enum_specifier name: (type_identifier) @definition.enum)
(call_expression function: (identifier) @reference.call)
(preproc_include path: (string_literal) @import.source)
(preproc_include path: (system_lib_string) @import.source)
`

// C++: inline methods use a field_identifier inside the declarator (distinct
// from a free function's identifier), so this is a clean additive pattern.
const CPP_QUERY = `
(function_definition declarator: (function_declarator declarator: (identifier) @definition.function))
(function_definition declarator: (function_declarator declarator: (field_identifier) @definition.method))
(class_specifier name: (type_identifier) @definition.class)
(struct_specifier name: (type_identifier) @definition.struct)
(enum_specifier name: (type_identifier) @definition.enum)
(call_expression function: (identifier) @reference.call)
(call_expression function: (field_expression field: (field_identifier) @reference.call))
(preproc_include path: (string_literal) @import.source)
(preproc_include path: (system_lib_string) @import.source)
`

const RUBY_QUERY = `
(method name: (identifier) @definition.method)
(class name: (constant) @definition.class)
(module name: (constant) @definition.module)
(call method: (identifier) @reference.call)
`

const PHP_QUERY = `
(function_definition name: (name) @definition.function)
(method_declaration name: (name) @definition.method)
(class_declaration name: (name) @definition.class)
(interface_declaration name: (name) @definition.interface)
(function_call_expression function: (name) @reference.call)
(member_call_expression name: (name) @reference.call)
(object_creation_expression (name) @reference.call)
`

const QUERIES: Record<string, string> = {
  typescript: TS_JS_QUERY,
  tsx: TS_JS_QUERY,
  javascript: JS_QUERY,
  python: PYTHON_QUERY,
  go: GO_QUERY,
  rust: RUST_QUERY,
  java: JAVA_QUERY,
  c: C_QUERY,
  cpp: CPP_QUERY,
  ruby: RUBY_QUERY,
  php: PHP_QUERY,
}

export function tagsQueryFor(languageId: string): string | null {
  return QUERIES[languageId] ?? null
}
