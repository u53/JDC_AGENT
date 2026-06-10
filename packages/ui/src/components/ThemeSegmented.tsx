import { useEffect, useRef, useState } from 'react'
import { useSettingsStore, type ResolvedTheme, type ThemeMode } from '../stores/settings-store'

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'dark', label: 'JDC Dark' },
  { value: 'light', label: 'JDC Light' },
]

function ThemeIcon({ resolvedTheme, size = 14 }: { resolvedTheme: ResolvedTheme; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="var(--accent)" opacity={resolvedTheme === 'light' ? 0.18 : 1} />
      <path d="M8 2a6 6 0 0 1 0 12V2Z" fill="var(--accent)" />
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity="0.24" strokeWidth="1" />
    </svg>
  )
}

export function ThemeSegmented() {
  const theme = useSettingsStore((s) => s.theme)
  const resolvedTheme = useSettingsStore((s) => s.resolvedTheme)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const activeOption = THEME_OPTIONS.find((option) => option.value === theme) ?? THEME_OPTIONS[0]

  useEffect(() => {
    if (!open) return

    const closeOnOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const chooseTheme = (nextTheme: ThemeMode) => {
    setTheme(nextTheme)
    setOpen(false)
  }

  return (
    <div ref={menuRef} className="theme-mode-select relative">
      <button
        type="button"
        aria-label="Theme mode"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="theme-mode-trigger flex h-[32px] min-w-[138px] items-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-2.5 text-left text-[12px] text-[var(--text)] shadow-[inset_0_1px_0_color-mix(in_srgb,var(--text)_4%,transparent)] transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
      >
        <ThemeIcon resolvedTheme={resolvedTheme} />
        <span className="min-w-0 flex-1 truncate">{activeOption.label}</span>
        <svg className={`text-[var(--muted)] transition-transform ${open ? 'rotate-180' : ''}`} width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Theme mode"
          className="theme-mode-menu absolute right-0 top-full z-[120] mt-2 w-[164px] overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-[var(--shadow-soft)]"
        >
          {THEME_OPTIONS.map((option) => {
            const selected = option.value === theme
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => chooseTheme(option.value)}
                className={`flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-[12px] transition-colors ${
                  selected
                    ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'text-[var(--text)] hover:bg-[var(--surface-2)]'
                }`}
              >
                <span className="flex h-4 w-4 items-center justify-center">
                  {selected && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M3.5 8.2 6.4 11 12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
