import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { AppConfigSchema, type AppConfig } from './types.js'

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '', '.jdcagnet')
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')

export function loadAppConfig(): AppConfig {
  if (!existsSync(CONFIG_FILE)) {
    return AppConfigSchema.parse({})
  }
  const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
  return AppConfigSchema.parse(raw)
}

export function saveAppConfig(config: AppConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
}

export function getConfigDir(): string {
  return CONFIG_DIR
}
