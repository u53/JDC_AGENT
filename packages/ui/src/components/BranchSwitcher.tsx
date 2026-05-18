import { useState, useEffect, useRef } from 'react'
import { IconGitBranch, IconCheck, IconX, IconPlus } from './icons'

interface Props {
  cwd: string
}

export function BranchSwitcher({ cwd }: Props) {
  const [open, setOpen] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [current, setCurrent] = useState('')
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const load = async () => {
    const result = await window.electronAPI?.gitBranchList(cwd)
    if (result) {
      setBranches(result.branches)
      setCurrent(result.current)
    }
  }

  useEffect(() => {
    load()
  }, [cwd])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const switchTo = async (branch: string) => {
    setError(null)
    const status = await window.electronAPI?.gitStatus(cwd)
    if (status?.dirty) {
      setError(`${status.changes} 个未提交更改，请先提交或 stash`)
      return
    }
    const result = await window.electronAPI?.gitBranchSwitch(cwd, branch)
    if (result?.success) {
      setCurrent(branch)
      setOpen(false)
    } else {
      setError(result?.error || '切换失败')
    }
  }

  const createBranch = async () => {
    if (!newName.trim()) return
    setError(null)
    const result = await window.electronAPI?.gitBranchCreate(cwd, newName.trim())
    if (result?.success) {
      setCreating(false)
      setNewName('')
      await load()
    } else {
      setError(result?.error || '创建失败')
    }
  }

  const deleteBranch = async (branch: string) => {
    setError(null)
    const result = await window.electronAPI?.gitBranchDelete(cwd, branch)
    if (result?.success) {
      setBranches((b) => b.filter((x) => x !== branch))
    } else {
      setError(result?.error || '删除失败')
    }
  }

  const filtered = branches.filter((b) => b.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => { setOpen(!open); if (!open) load() }}
        className="flex items-center gap-1.5 px-2 py-1 rounded-[6px] text-[12px] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
      >
        <IconGitBranch size={14} />
        <span className="font-mono truncate max-w-[120px]">{current || '—'}</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-[240px] bg-[var(--surface)] border border-[var(--border)] rounded-[8px] shadow-lg z-50 overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-[var(--border)]">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索分支..."
              className="w-full px-2 py-1 text-[12px] bg-[var(--surface-2)] border border-[var(--border)] rounded-[4px] text-[var(--text)] placeholder:text-[var(--muted)] outline-none focus:border-[var(--accent)]"
              autoFocus
            />
          </div>

          {/* Error */}
          {error && (
            <div className="px-3 py-1.5 text-[11px] text-[var(--bad)] bg-[var(--bad)]/10 border-b border-[var(--border)]">
              {error}
            </div>
          )}
          {/* Branch list */}
          <div className="max-h-[200px] overflow-y-auto">
            {filtered.map((branch) => (
              <div
                key={branch}
                className="flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] group cursor-pointer"
                onClick={() => branch !== current && switchTo(branch)}
              >
                <span className="w-4 flex-shrink-0">
                  {branch === current && <IconCheck size={12} className="text-[var(--good)]" />}
                </span>
                <span className={`font-mono truncate flex-1 ${branch === current ? 'text-[var(--good)]' : 'text-[var(--text)]'}`}>
                  {branch}
                </span>
                {branch !== current && (
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteBranch(branch) }}
                    className="opacity-0 group-hover:opacity-100 text-[var(--muted)] hover:text-[var(--bad)]"
                  >
                    <IconX size={12} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Create new */}
          <div className="border-t border-[var(--border)] p-2">
            {creating ? (
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createBranch()}
                  placeholder="新分支名..."
                  className="flex-1 px-2 py-1 text-[12px] bg-[var(--surface-2)] border border-[var(--border)] rounded-[4px] text-[var(--text)] outline-none"
                  autoFocus
                />
                <button onClick={createBranch} className="p-1 text-[var(--good)] hover:bg-[var(--surface-2)] rounded">
                  <IconCheck size={12} />
                </button>
                <button onClick={() => { setCreating(false); setNewName('') }} className="p-1 text-[var(--muted)] hover:bg-[var(--surface-2)] rounded">
                  <IconX size={12} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="flex items-center gap-1.5 w-full px-2 py-1 text-[12px] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] rounded-[4px]"
              >
                <IconPlus size={12} />
                创建新分支
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
