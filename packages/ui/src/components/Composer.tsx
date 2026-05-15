import { useState, useRef, useCallback, type KeyboardEvent, type ClipboardEvent, type DragEvent } from 'react'
import { ImagePreview } from './ImagePreview'
import { SlashCommandMenu, type SlashCommand } from './SlashCommandMenu'
import { IconSend, IconStop } from './icons'
import { useSessionStore } from '../stores/session-store'

interface Props {
  onSend: (text: string, images?: { data: string; mediaType: string }[]) => void
  onAbort: () => void
  isStreaming: boolean
  onSlashCommand?: (command: string) => void
  permissionMode?: string
  onPermissionChange?: (mode: string) => void
  thinkingEnabled?: boolean
  onThinkingToggle?: () => void
  planMode?: boolean
  onPlanToggle?: () => void
  modelName?: string
  modelId?: string
  models?: { id: string; name: string; groupName: string }[]
  onModelChange?: (modelId: string) => void
  onModelClick?: () => void
  skills?: { name: string; description: string }[]
}

export function Composer({
  onSend,
  onAbort,
  isStreaming,
  onSlashCommand,
  permissionMode = 'standard',
  onPermissionChange,
  thinkingEnabled,
  onThinkingToggle,
  planMode,
  onPlanToggle,
  modelName,
  modelId,
  models,
  onModelChange,
  onModelClick,
  skills,
}: Props) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<{ data: string; mediaType: string }[]>([])
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [showPermMenu, setShowPermMenu] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [queueExpanded, setQueueExpanded] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)

  const messageQueue = useSessionStore((s) => s.messageQueue)
  const enqueueMessage = useSessionStore((s) => s.enqueueMessage)
  const removeFromQueue = useSessionStore((s) => s.removeFromQueue)

  const addImageFile = useCallback((file: File) => {
    const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
    if (!validTypes.includes(file.type)) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      if (base64) setImages((prev) => [...prev, { data: base64, mediaType: file.type }])
    }
    reader.readAsDataURL(file)
  }, [])

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (file) addImageFile(file)
          return
        }
      }
    },
    [addImageFile],
  )

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      for (const file of e.dataTransfer?.files || []) {
        if (file.type.startsWith('image/')) addImageFile(file)
      }
    },
    [addImageFile],
  )

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }, [])

  const handleTextChange = (value: string) => {
    setText(value)
    if (value === '/') {
      setShowSlashMenu(true)
      setSlashFilter('')
    } else if (value.startsWith('/') && !value.includes(' ')) {
      setShowSlashMenu(true)
      setSlashFilter(value.slice(1))
    } else {
      setShowSlashMenu(false)
    }
  }

  const handleSlashSelect = (cmd: SlashCommand) => {
    setShowSlashMenu(false)
    if (cmd.section === 'skill') {
      setText(`/${cmd.name} `)
      textareaRef.current?.focus()
    } else {
      setText('')
      onSlashCommand?.(`/${cmd.name}`)
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingRef.current) return
    if (showSlashMenu && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(e.key)) return
    if (e.key === 'Escape' && showSlashMenu) {
      setShowSlashMenu(false)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (text.startsWith('/') && !text.includes(' ')) {
        onSlashCommand?.(text)
        setText('')
        setShowSlashMenu(false)
        return
      }
      if (text.trim() || images.length > 0) {
        if (isStreaming) {
          enqueueMessage(text.trim())
        } else {
          onSend(text.trim(), images.length > 0 ? images : undefined)
        }
        setText('')
        setImages([])
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
      }
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }

  const handleClearQueue = () => {
    const len = messageQueue.length
    for (let i = len - 1; i >= 0; i--) removeFromQueue(i)
    setQueueExpanded(false)
  }

  const permLabel =
    permissionMode === 'strict' ? '严格模式' : permissionMode === 'relaxed' ? '完全访问' : '标准模式'
  const permDotColor =
    permissionMode === 'relaxed'
      ? 'bg-[var(--warn)]'
      : permissionMode === 'strict'
        ? 'bg-[var(--bad)]'
        : 'bg-[var(--good)]'

  return (
    <div
      className="border-t border-[var(--border)] bg-[var(--surface)] px-6 py-3"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Queue chip */}
      {messageQueue.length > 0 && (
        <div className="mb-2">
          <button
            onClick={() => setQueueExpanded(!queueExpanded)}
            className="inline-flex items-center gap-2 rounded-[8px] bg-[var(--surface-3)] px-3 py-1.5 text-[12px] text-[var(--text)] transition-colors hover:opacity-80"
          >
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--warn)]" />
            Queue: {messageQueue.length} messages
          </button>
          {queueExpanded && (
            <div className="mt-1 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-2 shadow-[var(--shadow-soft)]">
              {messageQueue.map((msg, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-2 rounded px-2 py-1 text-[12px] text-[var(--text)] hover:bg-[var(--surface-2)]"
                >
                  <span className="truncate">{msg}</span>
                  <button
                    onClick={() => removeFromQueue(i)}
                    className="shrink-0 text-[var(--muted)] hover:text-[var(--bad)]"
                    aria-label={`Remove queued message ${i + 1}`}
                  >
                    &times;
                  </button>
                </div>
              ))}
              <button
                onClick={handleClearQueue}
                className="mt-1 w-full rounded px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--bad)]"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}

      {/* Image preview */}
      <ImagePreview images={images} onRemove={(i) => setImages((prev) => prev.filter((_, idx) => idx !== i))} />

      {/* Main input area */}
      <div className="mx-auto max-w-[760px]">
        <div className="relative mb-2">
          <SlashCommandMenu
            filter={slashFilter}
            visible={showSlashMenu}
            onSelect={handleSlashSelect}
            onClose={() => setShowSlashMenu(false)}
            skills={skills}
          />
          <div className="flex items-end gap-3">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => {
                handleTextChange(e.target.value)
                handleInput()
              }}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => {
                isComposingRef.current = true
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false
              }}
              onPaste={handlePaste}
              rows={1}
              placeholder="输入消息... (/ 打开命令)"
              className="flex-1 resize-none rounded-[10px] bg-[var(--surface-2)] border border-[var(--border)] px-4 py-3 text-[14px] text-[var(--text)] placeholder-[var(--muted)] focus:border-[var(--border-strong)] focus:outline-none transition-colors font-[var(--font-sans)]"
            />
            {/* Action buttons */}
            {isStreaming ? (
              <div className="flex items-center gap-2">
                {text.trim() && (
                  <button
                    onClick={() => {
                      enqueueMessage(text.trim())
                      setText('')
                      setImages([])
                    }}
                    className="flex items-center gap-1.5 rounded-[8px] bg-[var(--accent)] px-3 py-2 text-[12px] text-[var(--accent-ink)] transition-colors hover:opacity-90"
                  >
                    <IconSend size={14} />
                    Queue
                  </button>
                )}
                <button
                  onClick={onAbort}
                  className="flex items-center gap-1.5 rounded-[8px] border border-[var(--bad)] px-3 py-2 text-[12px] text-[var(--bad)] transition-colors hover:bg-[var(--bad)] hover:text-[var(--accent-ink)]"
                >
                  <IconStop size={14} />
                  Stop
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  if (text.trim() || images.length > 0) {
                    onSend(text.trim(), images.length > 0 ? images : undefined)
                    setText('')
                    setImages([])
                  }
                }}
                disabled={!text.trim() && images.length === 0}
                className="flex items-center gap-1.5 rounded-[8px] bg-[var(--accent)] px-3 py-2 text-[12px] text-[var(--accent-ink)] transition-colors hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <IconSend size={14} />
                Send
              </button>
            )}
          </div>
        </div>

        {/* Status bar */}
        <div className="flex items-center justify-between text-[12px]">
          <div className="flex items-center gap-3">
            {/* Permission dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowPermMenu(!showPermMenu)}
                className="flex items-center gap-1 text-[var(--text)] hover:opacity-80 transition-opacity"
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${permDotColor}`} />
                {permLabel} ▾
              </button>
              {showPermMenu && (
                <div className="absolute bottom-full left-0 mb-1 border border-[var(--border)] bg-[var(--surface)] rounded-[8px] z-50 min-w-[130px] shadow-[var(--shadow-soft)] overflow-hidden">
                  <button
                    onClick={() => { onPermissionChange?.('relaxed'); setShowPermMenu(false) }}
                    className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] ${permissionMode === 'relaxed' ? 'text-[var(--warn)]' : 'text-[var(--text)]'}`}
                  >
                    完全访问
                  </button>
                  <button
                    onClick={() => { onPermissionChange?.('standard'); setShowPermMenu(false) }}
                    className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] ${permissionMode === 'standard' ? 'text-[var(--good)]' : 'text-[var(--text)]'}`}
                  >
                    标准模式
                  </button>
                  <button
                    onClick={() => { onPermissionChange?.('strict'); setShowPermMenu(false) }}
                    className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] ${permissionMode === 'strict' ? 'text-[var(--bad)]' : 'text-[var(--text)]'}`}
                  >
                    严格模式
                  </button>
                </div>
              )}
            </div>

            {/* Thinking toggle */}
            <button
              onClick={onThinkingToggle}
              className={`flex items-center gap-1 transition-colors ${thinkingEnabled ? 'text-[var(--good)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${thinkingEnabled ? 'bg-[var(--good)]' : 'bg-[var(--muted)]'}`} />
              推理
            </button>

            {/* Plan toggle */}
            <button
              onClick={onPlanToggle}
              className={`flex items-center gap-1 transition-colors ${planMode ? 'text-[var(--plan)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${planMode ? 'bg-[var(--plan)]' : 'bg-[var(--muted)]'}`} />
              规划
            </button>
          </div>

          {/* Model dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                if (models && models.length > 0) setShowModelMenu(!showModelMenu)
                else onModelClick?.()
              }}
              className="text-[var(--text)] hover:text-[var(--accent)] transition-colors"
            >
              {modelName || 'No Model'} ▾
            </button>
            {showModelMenu && models && models.length > 0 && (
              <div className="absolute bottom-full right-0 mb-1 border border-[var(--border)] bg-[var(--surface)] rounded-[8px] z-50 min-w-[200px] max-h-[240px] overflow-y-auto shadow-[var(--shadow-soft)]">
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { onModelChange?.(m.id); setShowModelMenu(false) }}
                    className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] ${m.id === modelId ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}
                  >
                    <span>{m.name}</span>
                    <span className="text-[11px] text-[var(--muted)] ml-2">{m.groupName}</span>
                  </button>
                ))}
                <button
                  onClick={() => { setShowModelMenu(false); onModelClick?.() }}
                  className="block w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] text-[var(--muted)] border-t border-[var(--border)]"
                >
                  Settings...
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
