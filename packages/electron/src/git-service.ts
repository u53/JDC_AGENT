import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export class GitService {
  private async git(args: string[], cwd: string): Promise<string> {
    const { stdout } = await exec('git', args, { cwd, timeout: 10000 })
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
      await this.git(['stash', 'pop', `stash@{${idx}}`], cwd)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.stderr || err.message }
    }
  }

  async hasStash(cwd: string): Promise<boolean> {
    const output = await this.git(['stash', 'list'], cwd)
    return output.includes('jdcagnet-auto-stash')
  }
}
