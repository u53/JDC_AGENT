// Maps file extensions to Tree-sitter languages and their grammar wasm files.
// Grammar wasms ship with the `tree-sitter-wasms` package (ABI 14, compatible
// with web-tree-sitter 0.25.x).

export interface LanguageSpec {
  /** Canonical language id. */
  id: string
  /** Basename of the grammar wasm inside tree-sitter-wasms/out/. */
  wasm: string
}

/** Extension (with leading dot, lowercase) → language id. */
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.pyi': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.rb': 'ruby',
  '.php': 'php',
}

/** Language id → grammar spec. wasm basenames per tree-sitter-wasms/out/. */
const LANGUAGE_SPECS: Record<string, LanguageSpec> = {
  typescript: { id: 'typescript', wasm: 'tree-sitter-typescript.wasm' },
  tsx: { id: 'tsx', wasm: 'tree-sitter-tsx.wasm' },
  javascript: { id: 'javascript', wasm: 'tree-sitter-javascript.wasm' },
  python: { id: 'python', wasm: 'tree-sitter-python.wasm' },
  go: { id: 'go', wasm: 'tree-sitter-go.wasm' },
  rust: { id: 'rust', wasm: 'tree-sitter-rust.wasm' },
  java: { id: 'java', wasm: 'tree-sitter-java.wasm' },
  c: { id: 'c', wasm: 'tree-sitter-c.wasm' },
  cpp: { id: 'cpp', wasm: 'tree-sitter-cpp.wasm' },
  ruby: { id: 'ruby', wasm: 'tree-sitter-ruby.wasm' },
  php: { id: 'php', wasm: 'tree-sitter-php.wasm' },
}

export function languageForExtension(ext: string): string | null {
  return EXTENSION_TO_LANGUAGE[ext.toLowerCase()] ?? null
}

export function languageForPath(filePath: string): string | null {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return null
  return languageForExtension(filePath.slice(dot))
}

export function specForLanguage(id: string): LanguageSpec | null {
  return LANGUAGE_SPECS[id] ?? null
}

export function supportedLanguageIds(): string[] {
  return Object.keys(LANGUAGE_SPECS)
}

/** All extensions the engine knows how to index (with leading dot). */
export function supportedExtensions(): string[] {
  return Object.keys(EXTENSION_TO_LANGUAGE)
}
