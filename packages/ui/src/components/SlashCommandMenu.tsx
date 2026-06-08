import { useState, useEffect, useRef } from 'react'

export interface SlashCommand {
  name: string
  description: string
  icon?: string
  section?: 'command' | 'skill'
}

const COMMANDS: SlashCommand[] = [
  { name: 'init', description: '生成项目 JDCAGNET.md 配置文件', icon: '◈', section: 'command' },
  { name: 'compact', description: '将早期消息压缩为摘要（长对话适用）', icon: '⊡', section: 'command' },
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
  skillsOnly?: boolean
}

export function SlashCommandMenu({ filter, visible, onSelect, onClose, skills = [], skillsOnly = false }: Props) {
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

  const commandItems = skillsOnly ? [] : filtered.filter(c => c.section === 'command')
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
        e.stopPropagation()
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
      className="absolute bottom-full left-0 right-0 z-[90] mb-2 max-h-[360px] overflow-y-auto rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_96%,transparent)] backdrop-blur"
      style={{ boxShadow: 'var(--shadow-soft)' }}
    >
      {commandItems.length > 0 && (
        <>
          <div className="border-b border-[var(--border)] px-4 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">Commands</div>
          {commandItems.map((cmd) => {
            const idx = currentIdx++
            return (
              <div
                key={cmd.name}
                ref={idx === selectedIndex ? selectedRef : undefined}
                className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors ${
                  idx === selectedIndex ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'hover:bg-[var(--surface-2)]'
                }`}
                onClick={() => onSelect(cmd)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span className="w-4 text-center text-[13px] text-[var(--accent)]">{cmd.icon}</span>
                <span className="font-mono text-[12px] font-semibold text-[var(--text)]">/{cmd.name}</span>
                <span className="text-[11px] text-[var(--muted)] truncate">{cmd.description}</span>
              </div>
            )
          })}
        </>
      )}
      {skillItems.length > 0 && (
        <>
          <div className="mt-1 border-y border-[var(--border)] px-4 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">Skills</div>
          {skillItems.map((cmd) => {
            const idx = currentIdx++
            return (
              <div
                key={cmd.name}
                ref={idx === selectedIndex ? selectedRef : undefined}
                className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors ${
                  idx === selectedIndex ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'hover:bg-[var(--surface-2)]'
                }`}
                onClick={() => onSelect(cmd)}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span className="w-4 text-center text-[13px] text-[var(--good)]">{cmd.icon}</span>
                <span className="font-mono text-[12px] font-semibold text-[var(--text)]">/{cmd.name}</span>
                <span className="text-[11px] text-[var(--muted)] truncate flex-1">{cmd.description}</span>
                <span className="shrink-0 rounded-full border border-[var(--border)] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[var(--muted)]">local</span>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}
