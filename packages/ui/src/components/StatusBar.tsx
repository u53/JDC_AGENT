import { useSettingsStore } from '../stores/settings-store'
import { useModelStore } from '../stores/model-store'

export function StatusBar() {
  const { open } = useSettingsStore()
  const { getActiveModel } = useModelStore()
  const active = getActiveModel()

  return (
    <div className="flex items-center justify-between border-t border-[#333] px-4 py-1.5 text-[10px] uppercase tracking-[0.1em] text-[#666]">
      <button onClick={open} className="text-[#EAEAEA] hover:text-[#E61919] transition-colors tracking-[0.1em]">[SETTINGS]</button>
      <div className="flex items-center gap-2">
        <span>{active ? active.model.name : 'NO MODEL'}</span>
        <span className="text-[#333]">//</span>
        <span>TOKENS: --</span>
        <span className="text-[#333]">//</span>
        <span>COST: --</span>
      </div>
    </div>
  )
}
