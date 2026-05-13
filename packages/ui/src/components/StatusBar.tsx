import { useSettingsStore } from '../stores/settings-store'

export function StatusBar() {
  const { open } = useSettingsStore()

  return (
    <div className="flex items-center justify-between border-t border-[#EAEAEA] px-4 py-2 text-xs font-mono text-[#787774]">
      <button onClick={open} className="hover:text-[#2F3437] transition-colors">设置</button>
      <div className="flex items-center gap-3">
        <span>claude-sonnet-4</span>
        <span>tokens: --</span>
        <span>cost: --</span>
      </div>
    </div>
  )
}
