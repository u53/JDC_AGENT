import { useSettingsStore, type ThemeMode } from '../stores/settings-store'
import { IconSun, IconMoon, IconMonitor } from './icons'

const OPTIONS: { value: ThemeMode; label: string; Icon: typeof IconSun }[] = [
  { value: 'light', label: '白天', Icon: IconSun },
  { value: 'dark', label: '黑夜', Icon: IconMoon },
  { value: 'system', label: '跟随系统', Icon: IconMonitor },
]

export function ThemeSegmented() {
  const theme = useSettingsStore((s) => s.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)

  return (
    <div className="inline-flex p-1 border border-[var(--border)] rounded-[10px] bg-[var(--surface)]" style={{ boxShadow: 'var(--shadow)' }}>
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          aria-pressed={theme === value}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-[12px] transition-all duration-150 ${
            theme === value
              ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
              : 'text-[var(--muted)] hover:text-[var(--text)]'
          }`}
        >
          <Icon size={14} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
