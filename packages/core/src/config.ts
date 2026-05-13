import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.jdcagnet')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

export function loadAppConfig(): Record<string, any> {
  if (!existsSync(CONFIG_FILE)) {
    return {}
  }
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
}

export function saveAppConfig(config: Record<string, any>): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  const existing = loadAppConfig()
  const merged = { ...existing, ...config }
  writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), 'utf-8')
}

export function getConfigDir(): string {
  return CONFIG_DIR
}
