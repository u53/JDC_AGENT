import { useState, useEffect, useRef } from 'react'

interface DetectedApp {
  id: string
  name: string
  shortName: string
  available: boolean
}

interface Props {
  cwd: string
}

export function AppLauncher({ cwd }: Props) {
  const [open, setOpen] = useState(false)
  const [apps, setApps] = useState<DetectedApp[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.electronAPI?.appsDetect().then((result: { apps: DetectedApp[] }) => {
      setApps(result.apps)
    })
  }, [])

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const openApp = async (appId: string) => {
    await window.electronAPI?.appsOpen(appId, cwd)
    setOpen(false)
  }

  if (apps.length === 0) return null

  const defaultApp = apps[0]

  return (
    <div className="relative flex items-center" ref={ref}>
      <button
        onClick={() => openApp(defaultApp.id)}
        className="flex items-center px-2 py-1.5 hover:bg-[var(--surface-3)] transition-colors rounded-l-[6px]"
        aria-label={`Open in ${defaultApp.name}`}
      >
        <span className="w-[18px] h-[18px] flex items-center justify-center rounded-[4px] bg-[var(--accent)] text-[var(--accent-ink)] text-[10px] font-bold">
          {defaultApp.shortName}
        </span>
      </button>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center px-1.5 py-1.5 border-l border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors rounded-r-[6px]"
        aria-label="More apps"
      >
        <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 4 L5 7 L8 4" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full right-0 z-[90] mt-2 w-[210px] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_96%,transparent)] py-1 backdrop-blur" style={{ boxShadow: 'var(--shadow-soft)' }}>
          {apps.map((app) => (
            <button
              key={app.id}
              onClick={() => openApp(app.id)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[12px] text-[var(--text)] transition-colors hover:bg-[var(--surface-2)]"
            >
              <span className="flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[4px] bg-[var(--accent-soft)] text-[9px] font-bold text-[var(--accent)]">
                {app.shortName}
              </span>
              <span>{app.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
