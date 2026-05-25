import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

function platformKey(): string | null {
  const p = process.platform
  const a = process.arch
  if (p === 'darwin' && a === 'arm64') return 'darwin-arm64'
  if (p === 'darwin' && a === 'x64') return 'darwin-x64'
  if (p === 'win32' && a === 'x64') return 'win32-x64'
  if (p === 'win32' && a === 'arm64') return 'win32-arm64'
  return null
}

function binaryName(): string {
  return process.platform === 'win32' ? 'codegraph.exe' : 'codegraph'
}

function findInResourceTree(root: string): string | null {
  const key = platformKey()
  if (!key) return null
  const candidates = [
    path.join(root, key, 'bin', binaryName()),
    path.join(root, key, binaryName()),
  ]
  // Also search one level deeper for archives with a top-level directory
  const dirPath = path.join(root, key)
  if (existsSync(dirPath)) {
    try {
      for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          candidates.push(
            path.join(dirPath, entry.name, 'bin', binaryName()),
            path.join(dirPath, entry.name, binaryName()),
          )
        }
      }
    } catch { /* ignore readdir errors */ }
  }
  return candidates.find(p => existsSync(p)) ?? null
}

function findOnPath(): string | null {
  const PATH = process.env.PATH ?? ''
  if (!PATH) return null
  const sep = process.platform === 'win32' ? ';' : ':'
  for (const dir of PATH.split(sep)) {
    if (!dir) continue
    const candidate = path.join(dir, binaryName())
    if (existsSync(candidate)) return candidate
  }
  return null
}

export function resolveCodegraphBinary(): string | null {
  const devRoot = process.env.JDC_CODEGRAPH_DEV_ROOT ?? process.cwd()

  // In dev/test: cwd may be project root or packages/electron/ — try both
  const prefixes = ['packages/electron/resources/codegraph', 'resources/codegraph']
  for (const prefix of prefixes) {
    const found = findInResourceTree(path.join(devRoot, prefix))
    if (found) return found
  }

  // In packaged: binary lives in process.resourcesPath/codegraph/
  if (typeof (process as any).resourcesPath === 'string') {
    const found = findInResourceTree(path.join((process as any).resourcesPath, 'codegraph'))
    if (found) return found
  }

  return findOnPath()
}

export function isCodegraphAvailable(): boolean {
  return resolveCodegraphBinary() !== null
}
