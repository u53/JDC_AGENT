import { useState, useEffect, useRef } from 'react'

export interface SlashCommand {
  name: string
  description: string
  icon?: string
  section?: 'command' | 'skill'
}

const COMMANDS: SlashCommand[] = [
  { name: 'compact', description: '压缩当前对话上下文', icon: '⊡', section: 'command' },
  { name: 'mcp', description: 'MCP 服务器管理', icon: '⊕', section: 'command' },
  { name: 'stats', description: '显示 token 统计信息', icon: '◧', section: 'command' },
  { name: 'help', description: '显示帮助信息', icon: '◇', section: 'command' },
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
  const selectedRef = useRef<HTMLDivElement>(null)

  const skillCommands: SlashCommand[] = skills.map(s => ({
    name: s.name,
    description: s.description,
    icon: '⬡',
    section: 'skill' as const,
  }))

  const allItems = [...COMMANDS, ...skillCommands]

  const filtered = allItems.filter(cmd =>
    cmd.name.toLowerCase().includes(filter.toLowerCase()) ||
    cmd.description.toLowerCase().includes(filter.toLowerCase())
  )

  const commandItems = filtered.filter(c => c.section === 'command')
  const skillItems = filtered.filter(c => c.section === 'skill')
  const flatList = [...commandItems, ...skillItems]

  useEffect(() => {
    setSelectedIndex(0)
  }, [filter])

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  useEffect(() => {
    if (!visible) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, flatList.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (flatList[selectedIndex]) onSelect(flatList[selectedIndex])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [visible, flatList, selectedIndex, onSelect, onClose])

  if (!visible || flatList.length === 0) return null

  let currentIdx = 0

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 right-0 mb-1 border border-[var(--border)] bg-[var(--surface)] max-h-[360px] overflow-y-auto z-50 rounded-[12px]"
      style={{ boxShadow: 'var(--shadow-soft)' }}
    >
      {commandItems.length > 0 && (
        <>
          <div className="px-4 pt-2.5 pb-1 text-[9px] uppercase tracking-[0.15em] text-[var(--muted)]">命令</div>
          {commandItems.map((cmd) => {
            const idx = currentIdx++
            return (
              <div
                key={cmd.name}
                ref={idx === selectedIndex ? selectedRef : undefined}
                className={`flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors ${
                  idx === selectedIndex ? 'bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]'
                }`}
                onClick={() => onSelect(cmd)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span className="text-[13px] text-[var(--muted)] w-4 text-center">{cmd.icon}</span>
                <span className="text-[12px] text-[var(--text)] font-medium">{cmd.name}</span>
                <span className="text-[11px] text-[var(--muted)] truncate">{cmd.description}</span>
              </div>
            )
          })}
        </>
      )}
      {skillItems.length > 0 && (
        <>
          <div className="px-4 pt-3 pb-1 text-[9px] uppercase tracking-[0.15em] text-[var(--muted)] border-t border-[var(--border)] mt-1">技能</div>
          {skillItems.map((cmd) => {
            const idx = currentIdx++
            return (
              <div
                key={cmd.name}
                ref={idx === selectedIndex ? selectedRef : undefined}
                className={`flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors ${
                  idx === selectedIndex ? 'bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]'
                }`}
                onClick={() => onSelect(cmd)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span className="text-[13px] text-[var(--good)] w-4 text-center">{cmd.icon}</span>
                <span className="text-[12px] text-[var(--text)] font-medium">{cmd.name}</span>
                <span className="text-[11px] text-[var(--muted)] truncate flex-1">{cmd.description}</span>
                <span className="text-[9px] text-[var(--muted)] uppercase tracking-[0.1em] shrink-0">个人</span>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
