import { existsSync } from 'node:fs'
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
  const isPackaged =
    typeof (process as any).resourcesPath === 'string' &&
    (process as any).resourcesPath.length > 0 &&
    !((process as any).defaultApp)

  if (isPackaged) {
    const root = path.join((process as any).resourcesPath, 'codegraph')
    const found = findInResourceTree(root)
    if (found) return found
  }

  const devRoot = process.env.JDC_CODEGRAPH_DEV_ROOT ?? process.cwd()
  const devTree = path.join(devRoot, 'packages', 'electron', 'resources', 'codegraph')
  const devFound = findInResourceTree(devTree)
  if (devFound) return devFound

  return findOnPath()
}

export function isCodegraphAvailable(): boolean {
  return resolveCodegraphBinary() !== null
}
