import { useEffect, useState, useCallback } from 'react'

type CgState = 'hidden' | 'idle' | 'indexing' | 'done' | 'error'

interface Props {
  cwd: string
}

function stripAnsi(s: string): string {
  return s.replace(/\x1B\[[0-9;]*[a-zA-Z]|\x1B\[[0-9]*[GHKJ]|\r/g, '').trim()
}

export function CodegraphBanner({ cwd }: Props) {
  const [state, setState] = useState<CgState>('hidden')
  const [progress, setProgress] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const api = (window as any).electronAPI?.codegraphApi

  useEffect(() => {
    if (!api || !cwd) { setState('hidden'); return }

    const unsub = api.onState((s: any) => {
      if (s.cwd !== cwd) return
      if (s.initialized) {
        setState('done')
        setTimeout(() => setState('hidden'), 3000)
      } else if (s.dismissed) {
        setState('idle')
      } else {
        setState('idle')
      }
    })
    const unsubProgress = api.onInitProgress((e: any) => {
      if (e.cwd !== cwd) return
      setState('indexing')
      const clean = stripAnsi(e.line)
      if (clean) setProgress(clean.length > 50 ? clean.slice(0, 47) + '…' : clean)
    })
    api.refreshState(cwd)
    return () => { unsub(); unsubProgress() }
  }, [api, cwd])

  const handleInit = useCallback(async () => {
    if (!api || !cwd) return
    setState('indexing')
    setErrorMsg('')
    setProgress('')
    try {
      await api.init(cwd)
    } catch (err: any) {
      setState('error')
      setErrorMsg(err?.message || String(err))
    }
  }, [api, cwd])

  const handleReindex = useCallback(async () => {
    if (!api || !cwd) return
    setState('indexing')
    setProgress('')
    try {
      await api.reindex(cwd)
    } catch (err: any) {
      setState('error')
      setErrorMsg(err?.message || String(err))
    }
  }, [api, cwd])

  if (state === 'hidden' || !cwd) return null

  const base = 'flex items-center gap-2 px-3 py-2 rounded-[8px] text-[12px] transition-all'

  return (
    <div className="px-4 pb-2 flex justify-start">
      {state === 'idle' && (
        <div className={`${base} border border-[var(--border)] bg-[var(--surface)]`}>
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--muted)]" />
          <span className="text-[var(--muted)]">代码图谱未建立</span>
          <button
            onClick={handleInit}
            className="ml-1 px-2 py-0.5 rounded-[4px] bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90 transition-opacity"
          >
            建立索引
          </button>
        </div>
      )}

      {state === 'indexing' && (
        <div className={`${base} border border-[var(--border)] bg-[var(--surface)]`}>
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
          <span className="text-[var(--text)]" style={{ fontFamily: 'var(--font-mono)' }}>
            {progress || '正在索引…'}
          </span>
        </div>
      )}

      {state === 'done' && (
        <div className={`${base} border border-[var(--good)]/20 bg-[var(--surface)]`}>
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--good)]" />
          <span className="text-[var(--good)]">代码图谱已就绪</span>
          <button
            onClick={handleReindex}
            className="ml-1 text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          >
            重建
          </button>
        </div>
      )}

      {state === 'error' && (
        <div className={`${base} border border-[var(--bad)]/20 bg-[var(--surface)]`}>
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--bad)]" />
          <span className="text-[var(--bad)] truncate max-w-[200px]">{errorMsg || '索引失败'}</span>
          <button
            onClick={handleInit}
            className="ml-1 px-2 py-0.5 rounded-[4px] border border-[var(--bad)]/30 text-[var(--bad)] hover:bg-[var(--bad)]/5 transition-colors"
          >
            重试
          </button>
        </div>
      )}
    </div>
  )
}
