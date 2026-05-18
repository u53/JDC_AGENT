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
    const output = await this.git(['status', '--porcelain'], cwd)
    const lines = output ? output.split('\n').filter(Boolean) : []
    return { dirty: lines.length > 0, changes: lines.length }
  }
}
