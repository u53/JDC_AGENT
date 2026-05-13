import { useSettingsStore } from '../stores/settings-store'

export function StatusBar() {
  const { open } = useSettingsStore()

  return (
    <div className="flex h-7 items-center justify-between border-t border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-400">
      <button onClick={open} className="hover:text-zinc-200 transition-colors">⚙️ 设置</button>
      <div className="flex items-center gap-3">
        <span>claude-sonnet-4-6</span>
        <span>tokens: --</span>
        <span>cost: --</span>
      </div>
    </div>
  )
}
