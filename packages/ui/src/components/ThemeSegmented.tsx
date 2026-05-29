import { useState, useRef, useEffect } from 'react'
import { useSettingsStore, type ThemeMode } from '../stores/settings-store'

function ThemeIcon({ color, size = 14 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="6" fill={color} />
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" />
    </svg>
  )
}

function SystemIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  )
}

const THEMES: { value: ThemeMode; label: string; color: string }[] = [
  { value: 'system', label: '跟随系统', color: '' },
  { value: 'light', label: '浅色', color: '#f7f5ef' },
  { value: 'dark', label: '深色', color: '#17191d' },
  { value: 'ocean', label: 'Nord', color: '#88c0d0' },
  { value: 'purple', label: 'Catppuccin', color: '#cba6f7' },
  { value: 'cyber', label: 'Rosé Pine', color: '#ebbcba' },
  { value: 'warm', label: 'Solarized', color: '#268bd2' },
]

export function ThemeSegmented() {
  const theme = useSettingsStore((s) => s.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const current = THEMES.find(t => t.value === theme) || THEMES[0]

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] border border-[var(--border)] rounded-[8px] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
      >
        {current.color ? <ThemeIcon color={current.color} /> : <SystemIcon />}
        <span>{current.label}</span>
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-[140px] border border-[var(--border)] rounded-[8px] bg-[var(--surface)] overflow-hidden z-50" style={{ boxShadow: 'var(--shadow-soft)' }}>
          {THEMES.map(t => (
            <button
              key={t.value}
              onClick={() => { setTheme(t.value); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-[12px] flex items-center gap-2 transition-colors ${
                theme === t.value
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                  : 'text-[var(--text)] hover:bg-[var(--surface-2)]'
              }`}
            >
              {t.color ? <ThemeIcon color={t.color} /> : <SystemIcon />}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
