import { useSettingsStore } from '../stores/settings-store'
import { useModelStore } from '../stores/model-store'

export function StatusBar() {
  const { open } = useSettingsStore()
  const { getActiveModel } = useModelStore()
  const active = getActiveModel()

  return (
    <div className="flex items-center justify-between border-t border-[#EAEAEA] px-4 py-2 text-xs font-mono text-[#787774]">
      <button onClick={open} className="hover:text-[#2F3437] transition-colors">设置</button>
      <div className="flex items-center gap-3">
        <span>{active ? active.model.name : '未选择模型'}</span>
        <span>tokens: --</span>
        <span>cost: --</span>
      </div>
    </div>
  )
}
