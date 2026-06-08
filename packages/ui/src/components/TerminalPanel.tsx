import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useTerminalStore } from '../stores/terminal-store'
import { IconX } from './icons'
import 'xterm/css/xterm.css'

interface Props {
  cwd: string
}

export function TerminalPanel({ cwd }: Props) {
  const visible = useTerminalStore((s) => s.visible)
  const height = useTerminalStore((s) => s.height)
  const terminalId = useTerminalStore((s) => s.terminalId)
  const hide = useTerminalStore((s) => s.hide)
  const setHeight = useTerminalStore((s) => s.setHeight)
  const setTerminalId = useTerminalStore((s) => s.setTerminalId)

  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)

  useEffect(() => {
    if (!visible || !containerRef.current) return

    const term = new Terminal({
      fontSize: 13,
      fontFamily: 'var(--font-mono), Menlo, monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#e0e0e0',
        cursor: '#7c8aff',
      },
      cursorBlink: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()

    termRef.current = term
    fitRef.current = fit

    let disposed = false
    let activeTerminalId: string | null = null
    let inputSubscription: { dispose: () => void } | null = null

    const destroyActiveTerminal = () => {
      if (!activeTerminalId) return
      window.electronAPI?.terminalDestroy(activeTerminalId)
      activeTerminalId = null
    }

    window.electronAPI?.terminalCreate(cwd).then((result: { id: string; error?: string }) => {
      if (disposed) {
        if (result.id) window.electronAPI?.terminalDestroy(result.id)
        return
      }
      if (result.error) {
        term.write(`\r\n[终端启动失败] ${result.error}\r\n`)
        return
      }

      activeTerminalId = result.id
      setTerminalId(result.id)

      inputSubscription = term.onData((data) => {
        window.electronAPI?.terminalWrite(result.id, data)
      })
    }).catch((err: Error) => {
      if (!disposed) term.write(`\r\n[终端启动失败] ${err.message}\r\n`)
    })

    const unsub = window.electronAPI?.onTerminalData((payload: { id: string; data: string }) => {
      if (payload.id !== activeTerminalId) return
      term.write(payload.data)
    })

    const unsubExit = window.electronAPI?.onTerminalExit((payload: { id: string; code: number }) => {
      if (payload.id !== activeTerminalId) return
      term.write('\r\n[进程已退出]\r\n')
      activeTerminalId = null
      setTerminalId(null)
    })

    return () => {
      disposed = true
      inputSubscription?.dispose()
      unsub?.()
      unsubExit?.()
      destroyActiveTerminal()
      setTerminalId(null)
      term.dispose()
      if (termRef.current === term) termRef.current = null
      if (fitRef.current === fit) fitRef.current = null
    }
  }, [visible, cwd, setTerminalId])

  // Fit on resize or height change
  useEffect(() => {
    if (!visible || !fitRef.current || !termRef.current) return
    fitRef.current.fit()
    const id = terminalId
    if (id) {
      const { cols, rows } = termRef.current
      window.electronAPI?.terminalResize(id, cols, rows)
    }
  }, [visible, height, terminalId])

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startY: e.clientY, startH: height }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const delta = dragRef.current.startY - ev.clientY
      setHeight(dragRef.current.startH + delta)
    }
    const onUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [height, setHeight])

  if (!visible) return null

  return (
    <div className="flex flex-col border-t border-[var(--border)]" style={{ height }}>
      {/* Drag handle */}
      <div
        onMouseDown={onDragStart}
        className="h-1 cursor-row-resize hover:bg-[var(--accent)]/30 transition-colors"
      />
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 border-b border-[var(--border)] bg-[var(--surface)]">
        <span className="text-[11px] text-[var(--muted)] font-mono">Terminal</span>
        <button
          onClick={hide}
          className="p-0.5 rounded text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]"
        >
          <IconX size={12} />
        </button>
      </div>
      {/* Terminal container */}
      <div ref={containerRef} className="flex-1 overflow-hidden" />
    </div>
  )
}
