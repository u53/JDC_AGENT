import { useEffect, useState, useCallback } from 'react'
import { IconX } from './icons'

type BannerState = 'hidden' | 'idle' | 'indexing' | 'done' | 'error'

interface Props {
  cwd: string
}

export function CodegraphBanner({ cwd }: Props) {
  const [bannerState, setBannerState] = useState<BannerState>('hidden')
  const [progressLine, setProgressLine] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const api = window.electronAPI?.codegraphApi

  useEffect(() => {
    if (!api || !cwd) return

    // Subscribe to project state changes
    const unsubState = api.onState((s) => {
      if (s.cwd !== cwd) return
      if (s.initialized) {
        setBannerState('done')
        setProgressLine('')
        // Auto-dismiss after 4s
        setTimeout(() => setBannerState('hidden'), 4000)
      } else if (s.dismissed) {
        setBannerState('hidden')
      } else {
        setBannerState('idle')
        setProgressLine('')
      }
    })

    // Subscribe to init progress
    const unsubProgress = api.onInitProgress((e) => {
      if (e.cwd !== cwd) return
      setBannerState('indexing')
      setProgressLine(e.line)
    })

    // Initial state refresh
    api.refreshState(cwd)

    return () => {
      unsubState()
      unsubProgress()
    }
  }, [api, cwd])

  const handleInit = useCallback(async () => {
    if (!api) return
    setBannerState('indexing')
    setErrorMsg('')
    setProgressLine('')
    try {
      await api.init(cwd)
    } catch (err: any) {
      setBannerState('error')
      setErrorMsg(err?.message || String(err))
    }
  }, [api, cwd])

  const handleDismiss = useCallback(() => {
    if (!api) return
    api.dismiss(cwd)
    setBannerState('hidden')
  }, [api, cwd])

  if (bannerState === 'hidden' || !cwd) return null

  const bannerBase = 'flex items-center justify-between px-4 py-2 text-[13px] border-b border-[var(--border)]'

  switch (bannerState) {
    case 'idle':
      return (
        <div className={`${bannerBase} bg-[var(--surface-2)] text-[var(--muted)]`}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--warn)]" />
            <span>CodeGraph is not initialized for this project.</span>
            <button
              onClick={handleInit}
              className="px-2 py-0.5 rounded-[4px] text-[12px] bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90 transition-colors"
            >
              Initialize
            </button>
          </div>
          <button onClick={handleDismiss} className="text-[var(--muted)] hover:text-[var(--text)] transition-colors">
            <IconX size={14} />
          </button>
        </div>
      )

    case 'indexing':
      return (
        <div className={`${bannerBase} bg-[var(--surface-2)] text-[var(--accent)]`}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
            <span>{progressLine || 'Indexing codebase…'}</span>
          </div>
          <div className="w-24 h-1 rounded-full bg-[var(--surface-3)] overflow-hidden">
            <div className="h-full rounded-full bg-[var(--accent)] animate-pulse" style={{ width: '60%' }} />
          </div>
        </div>
      )

    case 'done':
      return (
        <div className={`${bannerBase} bg-[var(--surface-2)] text-[var(--good)]`}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--good)]" />
            <span>CodeGraph initialized successfully.</span>
          </div>
          <button onClick={handleDismiss} className="text-[var(--muted)] hover:text-[var(--text)] transition-colors">
            <IconX size={14} />
          </button>
        </div>
      )

    case 'error':
      return (
        <div className={`${bannerBase} bg-[var(--surface-2)] text-[var(--bad)]`}>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--bad)]" />
            <span>{errorMsg || 'CodeGraph initialization failed.'}</span>
            <button
              onClick={handleInit}
              className="px-2 py-0.5 rounded-[4px] text-[12px] border border-[var(--bad)] text-[var(--bad)] hover:bg-[var(--bad)]/10 transition-colors"
            >
              Retry
            </button>
          </div>
          <button onClick={handleDismiss} className="text-[var(--muted)] hover:text-[var(--text)] transition-colors">
            <IconX size={14} />
          </button>
        </div>
      )

    default:
      return null
  }
}
