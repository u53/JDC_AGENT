import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

const exec = promisify(execFile)

interface BranchSubscription {
  watchers: FSWatcher[]
  listeners: Set<(state: { branches: string[]; current: string }) => void>
  debounce: NodeJS.Timeout | null
  lastSerialized: string
}

export class GitService {
  private subscriptions = new Map<string, BranchSubscription>()

  private async git(args: string[], cwd: string): Promise<string> {
    const { stdout } = await exec('git', args, { cwd, timeout: 30000 })
    return stdout.trim()
  }

  async listBranches(cwd: string): Promise<{ branches: string[]; current: string }> {
    const output = await this.git(['branch', '--no-color'], cwd)
    const branches: string[] = []
    let current = ''
    for (const line of output.split('\n')) {
      const name = line.replace(/^\*?\s+/, '').trim()
      if (!name) continue
      branches.push(name)
      if (line.startsWith('*')) current = name
    }
    return { branches, current }
  }

  async switchBranch(cwd: string, branch: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.git(['checkout', branch], cwd)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.stderr || err.message }
    }
  }

  async createBranch(cwd: string, branch: string, from?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const args = ['checkout', '-b', branch]
      if (from) args.push(from)
      await this.git(args, cwd)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.stderr || err.message }
    }
  }

  async deleteBranch(cwd: string, branch: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.git(['branch', '-d', branch], cwd)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.stderr || err.message }
    }
  }

  async getStatus(cwd: string): Promise<{ dirty: boolean; changes: number }> {
    const output = await this.git(['status', '--porcelain', '-uno'], cwd)
    const lines = output ? output.split('\n').filter(Boolean) : []
    return { dirty: lines.length > 0, changes: lines.length }
  }

  async stash(cwd: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.git(['stash', 'push', '-m', 'jdcagnet-auto-stash'], cwd)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.stderr || err.message }
    }
  }

  async stashPop(cwd: string): Promise<{ success: boolean; error?: string }> {
    try {
      const list = await this.git(['stash', 'list'], cwd)
      const lines = list.split('\n')
      const idx = lines.findIndex(l => l.includes('jdcagnet-auto-stash'))
      if (idx === -1) {
        return { success: false, error: '没有找到暂存的更改' }
      }
      const ref = `stash@{${idx}}`
      try {
        await this.git(['stash', 'apply', ref], cwd)
        await this.git(['stash', 'drop', ref], cwd)
        return { success: true }
      } catch (applyErr: any) {
        const msg = applyErr.stderr || applyErr.message || ''
        if (msg.includes('CONFLICT') || msg.includes('conflict')) {
          return { success: false, error: '恢复时有冲突，请手动解决: git stash pop' }
        }
        return { success: false, error: msg }
      }
    } catch (err: any) {
      return { success: false, error: err.stderr || err.message }
    }
  }

  async hasStash(cwd: string): Promise<boolean> {
    const output = await this.git(['stash', 'list'], cwd)
    return output.includes('jdcagnet-auto-stash')
  }

  watchBranches(cwd: string, listener: (state: { branches: string[]; current: string }) => void): () => void {
    let sub = this.subscriptions.get(cwd)
    if (!sub) {
      sub = {
        watchers: [],
        listeners: new Set(),
        debounce: null,
        lastSerialized: '',
      }
      this.subscriptions.set(cwd, sub)

      const refresh = () => {
        if (sub!.debounce) clearTimeout(sub!.debounce)
        sub!.debounce = setTimeout(async () => {
          sub!.debounce = null
          try {
            const state = await this.listBranches(cwd)
            const serialized = `${state.current}|${state.branches.join(',')}`
            if (serialized === sub!.lastSerialized) return
            sub!.lastSerialized = serialized
            for (const fn of sub!.listeners) fn(state)
          } catch {
            // ignore — repo may be in transient state (mid-rebase, etc.)
          }
        }, 200)
      }

      const headPath = join(cwd, '.git', 'HEAD')
      const refsDir = join(cwd, '.git', 'refs', 'heads')
      const packedRefs = join(cwd, '.git', 'packed-refs')

      const safeWatch = (target: string, opts?: { recursive?: boolean }): FSWatcher | null => {
        try {
          return watch(target, opts ?? {}, refresh)
        } catch {
          return null
        }
      }

      const w1 = safeWatch(headPath)
      const w2 = safeWatch(refsDir, { recursive: true })
      const w3 = safeWatch(packedRefs)
      for (const w of [w1, w2, w3]) {
        if (w) {
          w.on('error', () => {})
          sub.watchers.push(w)
        }
      }

      this.listBranches(cwd)
        .then(state => {
          sub!.lastSerialized = `${state.current}|${state.branches.join(',')}`
        })
        .catch(() => {})
    }

    sub.listeners.add(listener)

    return () => {
      const current = this.subscriptions.get(cwd)
      if (!current) return
      current.listeners.delete(listener)
      if (current.listeners.size === 0) {
        if (current.debounce) clearTimeout(current.debounce)
        for (const w of current.watchers) {
          try { w.close() } catch {}
        }
        this.subscriptions.delete(cwd)
      }
    }
  }
}
