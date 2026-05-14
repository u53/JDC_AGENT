import { useState, useEffect, useRef } from 'react'

export interface SlashCommand {
  name: string
  description: string
  icon?: string
}

const COMMANDS: SlashCommand[] = [
  { name: 'compact', description: '压缩当前对话上下文' },
  { name: 'thinking', description: '开关推理模式 (on/off/budget)' },
  { name: 'model', description: '切换模型' },
  { name: 'mcp', description: '显示 MCP 服务器状态' },
  { name: 'status', description: '显示会话状态和 token 使用' },
  { name: 'permission', description: '切换权限模式' },
  { name: 'help', description: '显示帮助信息' },
]

interface Props {
  filter: string
  visible: boolean
  onSelect: (command: SlashCommand) => void
  onClose: () => void
  skills?: { name: string; description: string }[]
}

export function SlashCommandMenu({ filter, visible, onSelect, onClose, skills = [] }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)

  const allCommands: SlashCommand[] = [
    ...COMMANDS,
    ...skills.map(s => ({ name: s.name, description: `[SKILL] ${s.description}` })),
  ]

  const filtered = allCommands.filter(cmd =>
    cmd.name.toLowerCase().includes(filter.toLowerCase())
  )

  useEffect(() => {
    setSelectedIndex(0)
  }, [filter])

  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (filtered[selectedIndex]) onSelect(filtered[selectedIndex])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [visible, filtered, selectedIndex, onSelect, onClose])

  if (!visible || filtered.length === 0) return null

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 right-0 mb-1 border border-[#333] bg-[#0A0A0A] max-h-[280px] overflow-y-auto z-50"
    >
      {filtered.map((cmd, i) => (
        <div
          key={cmd.name}
          className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
            i === selectedIndex ? 'bg-[#1A1A1A]' : 'hover:bg-[#111]'
          }`}
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          <span className="text-[11px] text-[#EAEAEA] font-mono">/{cmd.name}</span>
          <span className="text-[10px] text-[#666]">{cmd.description}</span>
        </div>
      ))}
    </div>
  )
}
