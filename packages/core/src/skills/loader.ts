import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import matter from 'gray-matter'
import type { SkillDefinition } from './types.js'

const GLOBAL_DIR = path.join(os.homedir(), '.jdcagnet', 'skills')

function projectDir(cwd: string): string {
  return path.join(cwd, '.jdcagnet', 'skills')
}

export class SkillLoader {
  private skills = new Map<string, SkillDefinition>()

  async loadAll(cwd: string): Promise<void> {
    this.skills.clear()
    await this.loadDir(GLOBAL_DIR, 'global')
    await this.loadDir(projectDir(cwd), 'project')
  }

  private async loadDir(dir: string, source: 'global' | 'project'): Promise<void> {
    let entries: string[]
    try { entries = await readdir(dir) } catch { return }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry)
      const st = await stat(fullPath).catch(() => null)
      if (!st) continue

      let filePath: string
      if (st.isDirectory()) {
        filePath = path.join(fullPath, 'SKILL.md')
        try { await stat(filePath) } catch { continue }
      } else if (entry.endsWith('.md')) {
        filePath = fullPath
      } else {
        continue
      }

      const skill = await this.parseSkill(filePath, source)
      if (skill) this.skills.set(skill.name, skill)
    }
  }

  private async parseSkill(filePath: string, source: 'global' | 'project'): Promise<SkillDefinition | null> {
    try {
      const raw = await readFile(filePath, 'utf-8')
      const { data, content } = matter(raw)
      const name = data.name || path.basename(filePath, '.md')
      return {
        name,
        description: data.description || '',
        content: content.trim(),
        userInvocable: data['user-invocable'] !== false,
        arguments: data.arguments || [],
        argumentHint: data['argument-hint'],
        allowedTools: data['allowed-tools'],
        source,
        filePath,
      }
    } catch { return null }
  }

  get(name: string): SkillDefinition | undefined {
    return this.skills.get(name)
  }

  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values())
  }

  getInvocable(): SkillDefinition[] {
    return this.getAll().filter(s => s.userInvocable)
  }
}

export function renderSkill(skill: SkillDefinition, args?: string): string {
  let content = skill.content
  if (args) {
    const parts = args.split(/\s+/)
    parts.forEach((part, i) => {
      content = content.replace(new RegExp(`\\$\\{${i + 1}\\}`, 'g'), part)
    })
  }
  return content
}
