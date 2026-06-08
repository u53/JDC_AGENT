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
  const [pendingBranch, setPendingBranch] = useState<string | null>(null)
  const [hasStash, setHasStash] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = async () => {
    const result = await window.electronAPI?.gitBranchList(cwd)
    if (result) {
      setBranches(result.branches)
      setCurrent(result.current)
    }
    const stashed = await window.electronAPI?.gitHasStash?.(cwd)
    setHasStash(!!stashed)
  }

  useEffect(() => {
    load()
    if (!cwd) return
    window.electronAPI?.gitWatchStart?.(cwd)
    const off = window.electronAPI?.onGitBranchChanged?.((payload) => {
      if (payload.cwd !== cwd) return
      setBranches(payload.branches)
      setCurrent(payload.current)
    })
    return () => {
      off?.()
      window.electronAPI?.gitWatchStop?.(cwd)
    }
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
    setPendingBranch(null)
    const status = await window.electronAPI?.gitStatus(cwd)
    if (status?.dirty) {
      setPendingBranch(branch)
      setError(`${status.changes} 个未提交更改`)
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

  const stashAndSwitch = async () => {
    if (!pendingBranch) return
    setError(null)
    const stashResult = await window.electronAPI?.gitStash?.(cwd)
    if (!stashResult?.success) {
      setError(stashResult?.error || 'Stash 失败')
      return
    }
    const result = await window.electronAPI?.gitBranchSwitch(cwd, pendingBranch)
    if (result?.success) {
      setCurrent(pendingBranch)
      setPendingBranch(null)
      setOpen(false)
    } else {
      setError(result?.error || '切换失败')
      await window.electronAPI?.gitStashPop?.(cwd)
    }
  }

  const popStash = async () => {
    const result = await window.electronAPI?.gitStashPop?.(cwd)
    if (result?.success) {
      setHasStash(false)
    } else {
      setError(result?.error || '恢复失败')
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
        {hasStash && <span className="h-[6px] w-[6px] rounded-full bg-[var(--warn)] flex-shrink-0" />}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-[90] mb-2 w-[260px] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_96%,transparent)] backdrop-blur" style={{ boxShadow: 'var(--shadow-soft)' }}>
          {/* Search */}
          <div className="border-b border-[var(--border)] p-2">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜索分支..."
              className="w-full rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 font-mono text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
              autoFocus
            />
          </div>

          {/* Error / Stash prompt */}
          {error && (
            <div className="px-3 py-1.5 border-b border-[var(--border)] bg-[var(--surface-2)]">
              <div className="text-[11px] text-[var(--bad)]">{error}</div>
              {pendingBranch && (
                <div className="flex items-center gap-2 mt-1">
                  <button
                    onClick={stashAndSwitch}
                    className="text-[11px] px-2 py-0.5 rounded bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-80"
                  >
                    Stash 并切换
                  </button>
                  <button
                    onClick={() => { setPendingBranch(null); setError(null) }}
                    className="text-[11px] px-2 py-0.5 rounded text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          )}
          {/* Stash restore prompt */}
          {hasStash && !error && (
            <div className="px-3 py-1.5 border-b border-[var(--border)] bg-[var(--surface-2)] flex items-center justify-between">
              <span className="text-[11px] text-[var(--warn)]">有暂存的更改</span>
              <button
                onClick={popStash}
                className="text-[11px] px-2 py-0.5 rounded bg-[var(--warn)] text-[var(--accent-ink)] hover:opacity-80"
              >
                恢复
              </button>
            </div>
          )}
          {/* Branch list */}
          <div className="max-h-[200px] overflow-y-auto">
            {filtered.map((branch) => (
              <div
                key={branch}
              className="group flex cursor-pointer items-center gap-2 px-3 py-2 text-[12px] transition-colors hover:bg-[var(--surface-2)]"
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
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return
                    if (e.key === 'Enter') createBranch()
                  }}
                  placeholder="新分支名..."
                  className="flex-1 rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[12px] text-[var(--text)] outline-none"
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
                className="flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-[12px] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
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
