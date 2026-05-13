import { useState, useRef, useEffect } from 'react'
import { useModelStore } from '../stores/model-store'

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
        className="flex items-center gap-1.5 border border-[#333] px-2 py-1 text-[10px] uppercase tracking-[0.05em] text-[#EAEAEA] hover:border-[#EAEAEA] transition-colors"
      >
        <span>{active ? active.model.name : '选择模型'}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="opacity-50">
          <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-[220px] border border-[#333] bg-[#0A0A0A] py-1 z-50">
          {groups.length === 0 && (
            <p className="px-3 py-2 text-xs text-[#666]">暂无模型，请在设置中添加</p>
          )}
          {groups.map((group) => (
            <div key={group.id}>
              <div className="px-3 py-1.5 text-[10px] text-[#666] uppercase tracking-[0.1em]">
                {group.name}
              </div>
              {group.models.map((model) => (
                <button
                  key={model.id}
                  onClick={() => { setActiveModel(model.id); setOpen(false) }}
                  className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                    activeModelId === model.id
                      ? 'text-[#E61919]'
                      : 'text-[#EAEAEA] hover:bg-[#111] hover:text-[#EAEAEA]'
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
