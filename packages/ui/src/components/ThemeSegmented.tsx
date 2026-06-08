function ThemeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="var(--accent)" />
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeOpacity="0.24" strokeWidth="1" />
    </svg>
  )
}

export function ThemeSegmented() {
  return (
    <div
      className="flex items-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[12px] text-[var(--text)]"
      title="JDC Dark is the only theme"
    >
      <ThemeIcon />
      <span>JDC Dark</span>
    </div>
  )
}
