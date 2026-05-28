import { useRef, useCallback, useEffect, useState, type KeyboardEvent, type ClipboardEvent, type DragEvent } from 'react'
import { ImagePreview } from './ImagePreview'
import { SlashCommandMenu, type SlashCommand } from './SlashCommandMenu'
import { BranchSwitcher } from './BranchSwitcher'
import { IconSend, IconStop } from './icons'
import { useSessionStore } from '../stores/session-store'
import { useIdeStore } from '../stores/ide-store'
import { isSameOrChildPath } from '../lib/path-match'

interface Props {
  onSend: (text: string, images?: { data: string; mediaType: string }[]) => void
  onAbort: () => void
  isStreaming: boolean
  aborting?: boolean
  onSlashCommand?: (command: string) => void
  permissionMode?: string
  onPermissionChange?: (mode: string) => void
  effort?: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  onEffortChange?: (effort: 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max') => void
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
  aborting = false,
  onSlashCommand,
  permissionMode = 'standard',
  onPermissionChange,
  effort = 'max',
  onEffortChange,
  planMode,
  onPlanToggle,
  modelName,
  modelId,
  models,
  onModelChange,
  onModelClick,
  skills,
}: Props) {
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashOnlySkills, setSlashOnlySkills] = useState(false)
  const [slashInsertPos, setSlashInsertPos] = useState(0)
  const [slashFilter, setSlashFilter] = useState('')
  const [showPermMenu, setShowPermMenu] = useState(false)
  const [showEffortMenu, setShowEffortMenu] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [queueExpanded, setQueueExpanded] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)

  const messageQueue = useSessionStore((s) => s.messageQueue)
  const enqueueMessage = useSessionStore((s) => s.enqueueMessage)
  const removeFromQueue = useSessionStore((s) => s.removeFromQueue)
  const projects = useSessionStore((s) => s.projects)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const draft = useSessionStore((s) => (activeSessionId ? s.drafts[activeSessionId] : undefined))
  const setDraftText = useSessionStore((s) => s.setDraftText)
  const setDraftImages = useSessionStore((s) => s.setDraftImages)
  const clearDraft = useSessionStore((s) => s.clearDraft)
  const text = draft?.text ?? ''
  const images = draft?.images ?? []
  const setText = useCallback(
    (next: string) => {
      if (activeSessionId) setDraftText(activeSessionId, next)
    },
    [activeSessionId, setDraftText],
  )
  const setImages = useCallback(
    (updater: { data: string; mediaType: string }[] | ((prev: { data: string; mediaType: string }[]) => { data: string; mediaType: string }[])) => {
      if (!activeSessionId) return
      const current = useSessionStore.getState().drafts[activeSessionId]?.images ?? []
      const next = typeof updater === 'function' ? updater(current) : updater
      setDraftImages(activeSessionId, next)
    },
    [activeSessionId, setDraftImages],
  )
  const resetDraft = useCallback(() => {
    if (activeSessionId) clearDraft(activeSessionId)
  }, [activeSessionId, clearDraft])

  const activeProject = projects.find((p) => p.sessions.some((s) => s.id === activeSessionId))
  const cwd = activeProject?.cwd || ''

  // CodeGraph state
  const [cgState, setCgState] = useState<'hidden' | 'idle' | 'indexing' | 'done' | 'error'>('hidden')
  const [cgProgress, setCgProgress] = useState('')
  const cgApi = (window as any).electronAPI?.codegraphApi

  useEffect(() => {
    if (!cgApi || !cwd) { setCgState('hidden'); return }
    const unsub = cgApi.onState((s: any) => {
      if (s.cwd !== cwd) return
      setCgState(s.initialized ? 'done' : 'idle')
    })
    const unsubP = cgApi.onInitProgress((e: any) => {
      if (e.cwd !== cwd) return
      setCgState('indexing')
      const clean = (e.line || '').replace(/\x1B\[[0-9;]*[a-zA-Z]|\r/g, '').trim()
      if (clean) setCgProgress(clean.length > 30 ? clean.slice(0, 27) + '…' : clean)
    })
    cgApi.refreshState(cwd)
    return () => { unsub(); unsubP() }
  }, [cgApi, cwd])

  const handleCgAction = useCallback(async () => {
    if (!cgApi || !cwd) return
    setCgState('indexing')
    setCgProgress('')
    try {
      if (cgState === 'done') await cgApi.reindex(cwd)
      else await cgApi.init(cwd)
    } catch { setCgState('error') }
  }, [cgApi, cwd, cgState])

  const ideConnections = useIdeStore((s) => s.connections)
  const ideSelection = useIdeStore((s) => s.selection)
  const connectedIde = ideConnections.find((c) => c.status === 'connected' && c.workspaceFolders.some(f => isSameOrChildPath(cwd, f)))

  const addImageFile = useCallback((file: File) => {
    const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
    if (!validTypes.includes(file.type)) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      if (base64) {
        const sid = useSessionStore.getState().activeSessionId
        if (!sid) return
        const current = useSessionStore.getState().drafts[sid]?.images ?? []
        setDraftImages(sid, [...current, { data: base64, mediaType: file.type }])
      }
    }
    reader.readAsDataURL(file)
  }, [setDraftImages])

  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (file) {
            addImageFile(file)
            const sid = useSessionStore.getState().activeSessionId
            const currentImages = sid ? useSessionStore.getState().drafts[sid]?.images ?? [] : []
            const imageIndex = currentImages.length + 1
            const ta = textareaRef.current
            if (ta) {
              const pos = ta.selectionStart
              const before = text.slice(0, pos)
              const after = text.slice(pos)
              setText(before + `[image_${imageIndex}]` + after)
            } else {
              setText(text + `[image_${imageIndex}]`)
            }
          }
          return
        }
      }
    },
    [addImageFile, text, setText],
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
    // Check for / at start (commands + skills)
    if (value === '/' || (value.startsWith('/') && !value.includes(' '))) {
      setShowSlashMenu(true)
      setSlashFilter(value.slice(1))
      setSlashOnlySkills(false)
      setSlashInsertPos(0)
    } else {
      // Check for / typed mid-text (skills only)
      const lastSlash = value.lastIndexOf('/')
      const afterSlash = lastSlash >= 0 ? value.slice(lastSlash + 1) : ''
      if (lastSlash > 0 && !afterSlash.includes(' ')) {
        setShowSlashMenu(true)
        setSlashFilter(afterSlash)
        setSlashOnlySkills(true)
        setSlashInsertPos(lastSlash)
      } else {
        setShowSlashMenu(false)
      }
    }
  }

  const handleSlashSelect = (cmd: SlashCommand) => {
    setShowSlashMenu(false)
    if (cmd.section === 'skill') {
      // Insert skill name at the slash position, keep text before it
      const prefix = text.slice(0, slashInsertPos)
      setText(`${prefix}/${cmd.name} `)
      textareaRef.current?.focus()
    } else {
      resetDraft()
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
        resetDraft()
        setShowSlashMenu(false)
        return
      }
      if (text.trim() || images.length > 0) {
        if (isStreaming) {
          enqueueMessage(text.trim())
        } else {
          onSend(text.trim(), images.length > 0 ? images : undefined)
        }
        resetDraft()
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
      }
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      const maxH = 200
      if (el.scrollHeight > maxH) {
        el.style.height = `${maxH}px`
        el.style.overflowY = 'auto'
      } else {
        el.style.height = `${el.scrollHeight}px`
        el.style.overflowY = 'hidden'
      }
    }
  }

  // Resize textarea whenever the active session (and thus the draft) changes,
  // so switching back to a session with a long draft restores the right height.
  useEffect(() => {
    handleInput()
  }, [activeSessionId])

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
            skillsOnly={slashOnlySkills}
          />
          <div className="flex items-end gap-3">
            {/* CodeGraph indicator — left of input */}
            {cgState !== 'hidden' && (
              <div className="relative group shrink-0">
                <button
                  onClick={cgState !== 'indexing' ? handleCgAction : undefined}
                  disabled={cgState === 'indexing'}
                  className={`flex flex-col items-center justify-center gap-1 px-2.5 py-2 rounded-[10px] border transition-colors ${
                    cgState === 'done'
                      ? 'border-[var(--good)]/30 text-[var(--good)] hover:bg-[var(--good)]/5'
                      : cgState === 'indexing'
                      ? 'border-[var(--border)] text-[var(--accent)] cursor-wait'
                      : cgState === 'error'
                      ? 'border-[var(--bad)]/30 text-[var(--bad)] hover:bg-[var(--bad)]/5'
                      : 'border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--border-strong)]'
                  }`}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="4" cy="8" r="1.8" fill="currentColor" />
                    <circle cx="12" cy="4" r="1.8" fill="currentColor" />
                    <circle cx="12" cy="12" r="1.8" fill="currentColor" />
                    <path d="M5.8 7.2L10.2 4.8M5.8 8.8L10.2 11.2" stroke="currentColor" strokeWidth="1.1" />
                  </svg>
                  <span className={`text-[9px] leading-none whitespace-nowrap ${cgState === 'indexing' ? 'animate-pulse' : ''}`}>
                    {cgState === 'idle' ? '图谱' : cgState === 'indexing' ? '索引' : cgState === 'done' ? '就绪' : '失败'}
                  </span>
                </button>
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] shadow-[var(--shadow-soft)] text-[11px] text-[var(--text)] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity duration-200 z-50">
                  {cgState === 'idle' && '建立代码图谱，让 AI 理解调用关系'}
                  {cgState === 'indexing' && (cgProgress || '正在扫描项目文件…')}
                  {cgState === 'done' && '代码图谱已就绪，点击可重建索引'}
                  {cgState === 'error' && '索引失败，点击重试'}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-[1px] w-2 h-2 rotate-45 bg-[var(--surface)] border-r border-b border-[var(--border)]" />
                </div>
              </div>
            )}
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
                      resetDraft()
                    }}
                    className="flex items-center gap-1.5 rounded-[8px] bg-[var(--accent)] px-3 py-2 text-[12px] text-[var(--accent-ink)] transition-colors hover:opacity-90"
                  >
                    <IconSend size={14} />
                    Queue
                  </button>
                )}
                <button
                  onClick={() => { if (!aborting) onAbort() }}
                  disabled={aborting}
                  className="flex items-center gap-1.5 rounded-[8px] border border-[var(--bad)] px-3 py-2 text-[12px] text-[var(--bad)] transition-colors hover:bg-[var(--bad)] hover:text-[var(--accent-ink)] disabled:opacity-60 disabled:cursor-wait disabled:hover:bg-transparent disabled:hover:text-[var(--bad)]"
                >
                  <IconStop size={14} />
                  {aborting ? 'Stopping…' : 'Stop'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  if (text.trim() || images.length > 0) {
                    onSend(text.trim(), images.length > 0 ? images : undefined)
                    resetDraft()
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
        <div className="flex items-center justify-between text-[12px] min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            {/* Permission dropdown */}
            <div className="relative shrink-0">
              <button
                onClick={() => setShowPermMenu(!showPermMenu)}
                className="flex items-center gap-1 text-[var(--text)] hover:opacity-80 transition-opacity whitespace-nowrap"
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

            {/* Effort dropdown */}
            <div className="relative shrink-0">
              <button
                onClick={() => setShowEffortMenu(!showEffortMenu)}
                className={`flex items-center gap-1 transition-colors whitespace-nowrap ${effort === 'off' ? 'text-[var(--muted)] hover:text-[var(--text)]' : 'text-[var(--good)]'}`}
              >
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${effort === 'off' ? 'bg-[var(--muted)]' : 'bg-[var(--good)]'}`} />
                {(() => {
                  const labels: Record<string, string> = { off: '推理:关', low: '推理:低', medium: '推理:中', high: '推理:高', xhigh: '推理:超', max: '推理:最大' }
                  return labels[effort]
                })()} ▾
              </button>
              {showEffortMenu && (
                <div className="absolute bottom-full left-0 mb-1 border border-[var(--border)] bg-[var(--surface)] rounded-[8px] z-50 min-w-[150px] shadow-[var(--shadow-soft)] overflow-hidden">
                  <div className="px-3 py-1.5 text-[10px] text-[var(--muted)] flex items-center justify-between border-b border-[var(--border)]">
                    <span>速度</span>
                    <span>智能</span>
                  </div>
                  {(['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const).map((lvl) => {
                    const labels = { off: '关闭', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大' } as const
                    return (
                      <button
                        key={lvl}
                        onClick={() => { onEffortChange?.(lvl); setShowEffortMenu(false) }}
                        className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] ${effort === lvl ? 'text-[var(--good)]' : 'text-[var(--text)]'}`}
                      >
                        {labels[lvl]}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Plan toggle */}
            <button
              onClick={onPlanToggle}
              className={`flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 ${planMode ? 'text-[var(--plan)]' : 'text-[var(--muted)] hover:text-[var(--text)]'}`}
            >
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${planMode ? 'bg-[var(--plan)]' : 'bg-[var(--muted)]'}`} />
              规划
            </button>

            {/* Branch switcher */}
            {cwd && <BranchSwitcher cwd={cwd} />}

            {/* IDE connection + selection */}
            {connectedIde && (
              <span className="flex items-center gap-1 text-[var(--good)] min-w-0 shrink truncate">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--good)] shrink-0" />
                <span className="shrink-0">{connectedIde.ideName}</span>
                {ideSelection?.filePath && (
                  <span className="text-[var(--muted)] ml-1 truncate">
                    · {ideSelection.filePath.split('/').pop()}
                    {ideSelection.text ? ` (${ideSelection.selection?.start.line}-${ideSelection.selection?.end.line})` : ''}
                  </span>
                )}
              </span>
            )}
          </div>

          {/* Model dropdown */}
          <div className="relative shrink-0 max-w-[40%]">
            <button
              onClick={() => {
                if (models && models.length > 0) setShowModelMenu(!showModelMenu)
                else onModelClick?.()
              }}
              className="text-[var(--text)] hover:text-[var(--accent)] transition-colors whitespace-nowrap truncate max-w-full block"
              title={modelName || 'No Model'}
            >
              {modelName || 'No Model'} ▾
            </button>
            {showModelMenu && models && models.length > 0 && (
              <div className="absolute bottom-full right-0 mb-1 border border-[var(--border)] bg-[var(--surface)] rounded-[8px] z-50 min-w-[200px] max-h-[240px] overflow-y-auto shadow-[var(--shadow-soft)]">
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { onModelChange?.(m.id); setShowModelMenu(false) }}
                    className={`block w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] ${m.id === modelId ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'text-[var(--text)]'}`}
                  >
                    {m.id === modelId && <span className="mr-1">✓</span>}
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
