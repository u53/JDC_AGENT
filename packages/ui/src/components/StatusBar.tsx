import { useSettingsStore } from '../stores/settings-store'
import { useModelStore } from '../stores/model-store'

export function StatusBar() {
  const { open } = useSettingsStore()
  const { getActiveModel } = useModelStore()
  const active = getActiveModel()

  return (
    <div className="flex items-center justify-between border-t border-[#333] px-4 py-1.5 text-[10px] uppercase tracking-[0.1em] text-[#666]">
      <button onClick={open} className="text-[#EAEAEA] hover:text-[#E61919] transition-colors">设置</button>
      <div className="flex items-center gap-3">
        <span>{active ? active.model.name : '未选择模型'}</span>
        <span>TOKENS: --</span>
        <span>COST: --</span>
      </div>
    </div>
  )
}
