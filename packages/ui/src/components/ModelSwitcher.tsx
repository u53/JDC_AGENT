import { useState, useRef, useEffect } from 'react'
import { useModelStore, type ModelEntry, type ModelGroup } from '../stores/model-store'

export function ModelSwitcher() {
  const { groups, activeModelId, setActiveModel, getActiveModel } = useModelStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const active = getActiveModel()

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-[6px] border border-[#EAEAEA] px-3 py-1.5 text-xs text-[#2F3437] hover:bg-[#F7F6F3] transition-colors"
      >
        <span className="font-medium">{active ? active.model.name : '选择模型'}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="opacity-50">
          <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-[220px] rounded-[8px] border border-[#EAEAEA] bg-white py-1 shadow-[0_2px_8px_rgba(0,0,0,0.04)] z-50">
          {groups.length === 0 && (
            <p className="px-3 py-2 text-xs text-[#787774]">暂无模型，请在设置中添加</p>
          )}
          {groups.map((group) => (
            <div key={group.id}>
              <div className="px-3 py-1.5 text-[10px] text-[#787774] uppercase tracking-wide font-medium">
                {group.name}
              </div>
              {group.models.map((model) => (
                <button
                  key={model.id}
                  onClick={() => { setActiveModel(model.id); setOpen(false) }}
                  className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                    activeModelId === model.id
                      ? 'bg-[#F7F6F3] text-[#111111] font-medium'
                      : 'text-[#2F3437] hover:bg-[#F7F6F3]'
                  }`}
                >
                  {model.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
