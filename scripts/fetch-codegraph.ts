import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, createWriteStream, readdirSync, statSync, renameSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { ProxyAgent, Agent } from 'undici'

type Platform = 'darwin-arm64' | 'darwin-x64' | 'win32-x64' | 'win32-arm64'

interface ReleaseAsset {
  name: string
  browser_download_url: string
}

const ROOT = path.resolve(__dirname, '..')
const RES_DIR = path.join(ROOT, 'packages', 'electron', 'resources', 'codegraph')
const TMP_DIR = path.join(ROOT, 'tmp', 'codegraph-fetch')

function buildFetchOptions(): RequestInit {
  const headers: Record<string, string> = { 'user-agent': 'jdc-fetch-codegraph' }
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy
  const dispatcher = proxy
    ? new ProxyAgent({ uri: proxy, requestTls: { rejectUnauthorized: true }, connectTimeout: 30_000 })
    : new Agent({ connectTimeout: 30_000 })
  const opts: RequestInit & { dispatcher?: any } = {
    headers,
    dispatcher,
    signal: AbortSignal.timeout(120_000),
  }
  return opts
}

function parseArgs(): { platforms: Platform[]; version: string } {
  const argv = process.argv.slice(2)
  let platforms: Platform[] = []
  let version = 'v0.9.6'
  for (const a of argv) {
    if (a.startsWith('--platforms=')) {
      platforms = a.slice('--platforms='.length).split(',').map(s => s.trim()) as Platform[]
    } else if (a.startsWith('--version=')) {
      version = a.slice('--version='.length).trim()
    }
  }
  if (platforms.length === 0) {
    const p = process.platform
    const a = process.arch
    if (p === 'darwin' && a === 'arm64') platforms = ['darwin-arm64']
    else if (p === 'darwin' && a === 'x64') platforms = ['darwin-x64']
    else if (p === 'win32' && a === 'x64') platforms = ['win32-x64']
    else if (p === 'win32' && a === 'arm64') platforms = ['win32-arm64']
    else throw new Error(`Unsupported host platform ${p}-${a}; pass --platforms=...`)
  }
  return { platforms, version }
}

async function fetchJson(url: string): Promise<any> {
  const r = await fetch(url, { ...buildFetchOptions() })
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`)
  return r.json()
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const r = await fetch(url, { ...buildFetchOptions(), redirect: 'follow' })
  if (!r.ok || !r.body) throw new Error(`GET ${url} -> ${r.status}`)
  await pipeline(Readable.fromWeb(r.body as any), createWriteStream(dest))
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function parseSumsFile(content: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const [hash, name] = trimmed.split(/\s+/)
    if (hash && name) m.set(name, hash.toLowerCase())
  }
  return m
}

function platformAssetName(p: Platform): string {
  return p.startsWith('win32') ? `codegraph-${p}.zip` : `codegraph-${p}.tar.gz`
}

function extract(file: string, dir: string, p: Platform): void {
  mkdirSync(dir, { recursive: true })
  if (p.startsWith('win32')) {
    if (process.platform === 'win32') {
      execSync(`powershell -Command "Expand-Archive -Force -Path '${file}' -DestinationPath '${dir}'"`, { stdio: 'inherit' })
    } else {
      execSync(`unzip -o "${file}" -d "${dir}"`, { stdio: 'inherit' })
    }
    // Strip top-level directory if the zip contains a single folder
    const entries = readdirSync(dir)
    if (entries.length === 1) {
      const nested = path.join(dir, entries[0])
      if (statSync(nested).isDirectory()) {
        for (const item of readdirSync(nested)) {
          renameSync(path.join(nested, item), path.join(dir, item))
        }
        rmSync(nested, { recursive: true, force: true })
      }
    }
  } else {
    execSync(`tar -xzf "${file}" -C "${dir}" --strip-components=1`, { stdio: 'inherit' })
  }
}

async function main() {
  const { platforms, version } = parseArgs()
  console.log(`[fetch-codegraph] platforms=${platforms.join(',')} version=${version}`)

  const release = await fetchJson(`https://api.github.com/repos/colbymchenry/codegraph/releases/tags/${version}`)

  const tag: string = release.tag_name
  const assets: ReleaseAsset[] = release.assets || []
  console.log(`[fetch-codegraph] release tag=${tag}`)

  rmSync(TMP_DIR, { recursive: true, force: true })
  mkdirSync(TMP_DIR, { recursive: true })

  const sumsAsset = assets.find(a => a.name === 'SHA256SUMS')
  if (!sumsAsset) throw new Error('SHA256SUMS missing in release')
  const sumsPath = path.join(TMP_DIR, 'SHA256SUMS')
  await downloadFile(sumsAsset.browser_download_url, sumsPath)
  const sums = parseSumsFile(readFileSync(sumsPath, 'utf-8'))

  for (const p of platforms) {
    const assetName = platformAssetName(p)
    const asset = assets.find(a => a.name === assetName)
    if (!asset) throw new Error(`asset ${assetName} missing in release ${tag}`)

    const archivePath = path.join(TMP_DIR, assetName)
    console.log(`[fetch-codegraph] downloading ${assetName}...`)
    await downloadFile(asset.browser_download_url, archivePath)

    const want = sums.get(assetName)
    const got = sha256(archivePath)
    if (!want) throw new Error(`no sha for ${assetName}`)
    if (want !== got) throw new Error(`sha mismatch ${assetName}: want ${want}, got ${got}`)
    console.log(`[fetch-codegraph] ${assetName} sha ok`)

    const outDir = path.join(RES_DIR, p)
    rmSync(outDir, { recursive: true, force: true })
    extract(archivePath, outDir, p)
    console.log(`[fetch-codegraph] extracted to ${outDir}`)
  }

  mkdirSync(RES_DIR, { recursive: true })
  writeFileSync(path.join(RES_DIR, 'VERSION'), tag.replace(/^v/, ''), 'utf-8')

  const hostP: Platform | null =
    process.platform === 'darwin' && process.arch === 'arm64' ? 'darwin-arm64'
    : process.platform === 'darwin' && process.arch === 'x64' ? 'darwin-x64'
    : process.platform === 'win32' && process.arch === 'x64' ? 'win32-x64'
    : process.platform === 'win32' && process.arch === 'arm64' ? 'win32-arm64'
    : null
  if (hostP && platforms.includes(hostP)) {
    const candidates = hostP.startsWith('win32')
      ? [
          path.join(RES_DIR, hostP, 'bin', 'codegraph.exe'),
          path.join(RES_DIR, hostP, 'bin', 'codegraph.cmd'),
          path.join(RES_DIR, hostP, 'codegraph.exe'),
          path.join(RES_DIR, hostP, 'codegraph.cmd'),
        ]
      : [
          path.join(RES_DIR, hostP, 'bin', 'codegraph'),
          path.join(RES_DIR, hostP, 'codegraph'),
        ]
    const bin = candidates.find(c => existsSync(c))
    if (!bin) throw new Error(`smoke test: binary not found in ${candidates.join(' | ')}`)
    console.log(`[fetch-codegraph] smoke test: ${bin} --version`)
    execSync(`"${bin}" --version`, { stdio: 'inherit' })
  } else {
    console.log('[fetch-codegraph] smoke test skipped (cross-platform fetch)')
  }

  rmSync(TMP_DIR, { recursive: true, force: true })
  console.log('[fetch-codegraph] done')
}

main().catch(e => { console.error(e); process.exit(1) })
