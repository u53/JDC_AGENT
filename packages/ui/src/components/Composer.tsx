import { useRef, useCallback, useLayoutEffect, useState, type KeyboardEvent, type ClipboardEvent, type DragEvent } from 'react'
import { ImagePreview } from './ImagePreview'
import { getSlashCommandMenuGroups, SlashCommandMenu, type SlashCommand } from './SlashCommandMenu'
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

export const COMPOSER_TEXTAREA_MAX_HEIGHT = 200
export const COMPOSER_IME_ENTER_SUPPRESSION_MS = 120

type ComposerTextareaSizer = Pick<HTMLTextAreaElement, 'scrollHeight'> & {
  style: Pick<CSSStyleDeclaration, 'height' | 'overflowY'>
}

export function resizeComposerTextarea(el: ComposerTextareaSizer) {
  el.style.height = 'auto'
  const height = Math.min(el.scrollHeight, COMPOSER_TEXTAREA_MAX_HEIGHT)
  el.style.height = `${height}px`
  el.style.overflowY = el.scrollHeight > COMPOSER_TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'
}

export function shouldDelegateKeyToSlashMenu(key: string, showSlashMenu: boolean, slashMenuItemCount: number) {
  return showSlashMenu && slashMenuItemCount > 0 && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(key)
}

export function shouldIgnoreKeyDownForIme({
  key,
  isComposing,
  nativeIsComposing,
  nativeKeyCode,
  lastCompositionEndAt,
  now,
}: {
  key: string
  isComposing: boolean
  nativeIsComposing?: boolean
  nativeKeyCode?: number
  lastCompositionEndAt: number | null
  now: number
}) {
  if (isComposing || nativeIsComposing || nativeKeyCode === 229) return true
  return key === 'Enter' && lastCompositionEndAt !== null && now - lastCompositionEndAt < COMPOSER_IME_ENTER_SUPPRESSION_MS
}

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
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
  const composerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)
  const lastCompositionEndAtRef = useRef<number | null>(null)

  const messageQueues = useSessionStore((s) => s.messageQueues)
  const enqueueMessage = useSessionStore((s) => s.enqueueMessage)
  const removeFromQueue = useSessionStore((s) => s.removeFromQueue)
  const updateQueuedMessage = useSessionStore((s) => s.updateQueuedMessage)
  const projects = useSessionStore((s) => s.projects)
  const activeSessionId = useSessionStore((s) => s.activeSessionId)
  const draft = useSessionStore((s) => (activeSessionId ? s.drafts[activeSessionId] : undefined))
  const setDraftText = useSessionStore((s) => s.setDraftText)
  const setDraftImages = useSessionStore((s) => s.setDraftImages)
  const clearDraft = useSessionStore((s) => s.clearDraft)
  const text = draft?.text ?? ''
  const images = draft?.images ?? []
  const messageQueue = activeSessionId ? (messageQueues[activeSessionId] ?? []) : []
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

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current
    if (el) resizeComposerTextarea(el)
  }, [])

  const activeProject = projects.find((p) => p.sessions.some((s) => s.id === activeSessionId))
  const cwd = activeProject?.cwd || ''
  const slashMenuItemCount = getSlashCommandMenuGroups(slashFilter, skills, slashOnlySkills).flatList.length

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
    const nativeEvent = e.nativeEvent as globalThis.KeyboardEvent & { keyCode?: number; which?: number }
    if (shouldIgnoreKeyDownForIme({
      key: e.key,
      isComposing: isComposingRef.current,
      nativeIsComposing: nativeEvent.isComposing,
      nativeKeyCode: nativeEvent.keyCode ?? nativeEvent.which,
      lastCompositionEndAt: lastCompositionEndAtRef.current,
      now: nowMs(),
    })) {
      if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current && !nativeEvent.isComposing) e.preventDefault()
      return
    }
    if (shouldDelegateKeyToSlashMenu(e.key, showSlashMenu, slashMenuItemCount)) return
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
          if (activeSessionId) enqueueMessage(activeSessionId, text.trim())
        } else {
          onSend(text.trim(), images.length > 0 ? images : undefined)
        }
        resetDraft()
      }
    }
  }

  const handleInput = () => {
    resizeTextarea()
  }

  // Keep the DOM height in sync after draft updates, including send/reset.
  useLayoutEffect(() => {
    resizeTextarea()
  }, [activeSessionId, text, resizeTextarea])

  useLayoutEffect(() => {
    if (!showSlashMenu && !showPermMenu && !showEffortMenu && !showModelMenu && !queueExpanded) return
    const handler = (event: MouseEvent) => {
      if (composerRef.current?.contains(event.target as Node)) return
      setShowSlashMenu(false)
      setShowPermMenu(false)
      setShowEffortMenu(false)
      setShowModelMenu(false)
      setQueueExpanded(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showSlashMenu, showPermMenu, showEffortMenu, showModelMenu, queueExpanded])

  const handleClearQueue = () => {
    const len = messageQueue.length
    for (let i = len - 1; i >= 0; i--) {
      if (activeSessionId) removeFromQueue(activeSessionId, i)
    }
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
  const controlButtonCls = 'composer-control-button flex min-h-11 items-center gap-2 rounded-[8px] border border-[color-mix(in_srgb,var(--border)_88%,transparent)] bg-[color-mix(in_srgb,var(--surface-2)_42%,transparent)] px-3 py-2 text-left text-[12px] text-[var(--text)] shadow-[inset_0_1px_0_rgba(255,255,255,0.025)] transition-colors hover:border-[color-mix(in_srgb,var(--accent)_18%,var(--border))] hover:bg-[color-mix(in_srgb,var(--surface-3)_52%,transparent)] active:translate-y-px'
  const popoverCls = 'composer-control-popover absolute bottom-full z-[90] mb-2 overflow-hidden rounded-[8px] border border-[color-mix(in_srgb,var(--border)_90%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface)_98%,transparent),color-mix(in_srgb,var(--surface-2)_94%,transparent))] shadow-[0_18px_54px_-34px_rgba(0,0,0,0.78),inset_0_1px_0_rgba(255,255,255,0.045)] backdrop-blur'
  const popoverItemCls = 'composer-popover-item block w-full text-left px-3 py-2 text-[12px] text-[var(--text)] transition-colors hover:bg-[color-mix(in_srgb,var(--surface-3)_54%,transparent)]'

  return (
    <div
      ref={composerRef}
      className="composer-shell relative z-[70] overflow-visible border-t border-[color-mix(in_srgb,var(--border)_86%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface)_88%,transparent),color-mix(in_srgb,var(--bg)_94%,transparent))] px-6 py-4 shadow-[0_-18px_42px_-38px_rgba(0,0,0,0.86),inset_0_1px_0_rgba(255,255,255,0.025)] backdrop-blur"
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
                  <textarea
                    value={msg}
                    onChange={(event) => activeSessionId && updateQueuedMessage(activeSessionId, i, event.currentTarget.value)}
                    className="composer-queued-message-input min-w-0 flex-1 resize-none rounded-[6px] border border-transparent bg-transparent px-2 py-1 text-[12px] text-[var(--text)] outline-none transition-colors hover:bg-[var(--surface-2)] focus:border-[color-mix(in_srgb,var(--accent)_28%,var(--border))] focus:bg-[var(--surface-2)]"
                    rows={1}
                    aria-label={`Edit queued message ${i + 1}`}
                  />
                  <button
                    onClick={() => activeSessionId && removeFromQueue(activeSessionId, i)}
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
      <div className="mx-auto max-w-[1120px]">
        <div className="composer-command-surface relative overflow-visible rounded-[8px] border border-[color-mix(in_srgb,var(--border)_90%,transparent)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-2)_74%,transparent),color-mix(in_srgb,var(--surface)_58%,transparent))] p-2 shadow-[0_18px_60px_-50px_rgba(0,0,0,0.86),inset_0_1px_0_rgba(255,255,255,0.035)]">
          <SlashCommandMenu
            filter={slashFilter}
            visible={showSlashMenu && slashMenuItemCount > 0}
            onSelect={handleSlashSelect}
            onClose={() => setShowSlashMenu(false)}
            skills={skills}
            skillsOnly={slashOnlySkills}
          />
          <div className="flex items-end gap-2">
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
                lastCompositionEndAtRef.current = null
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false
                lastCompositionEndAtRef.current = nowMs()
              }}
              onPaste={handlePaste}
              rows={1}
              placeholder="向 JDC Code 发送消息，或输入 / 运行命令..."
              className="flex-1 resize-none rounded-[6px] border border-transparent bg-transparent px-3 py-3 text-[14px] leading-6 text-[var(--text)] placeholder:text-[var(--muted)] outline-none transition-colors font-[var(--font-sans)] focus:bg-[color-mix(in_srgb,var(--surface)_46%,transparent)]"
            />
            {/* Action buttons */}
            {isStreaming ? (
              <div className="flex items-center gap-2">
                {text.trim() && (
                  <button
                    onClick={() => {
                      if (activeSessionId) enqueueMessage(activeSessionId, text.trim())
                      resetDraft()
                    }}
                    className="composer-send-button flex h-9 items-center gap-1.5 rounded-[8px] border border-[color-mix(in_srgb,var(--accent)_34%,transparent)] bg-[color-mix(in_srgb,var(--accent)_84%,var(--text)_16%)] px-3 text-[12px] font-semibold text-[var(--accent-ink)] shadow-[0_12px_32px_-22px_var(--accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_92%,var(--text)_8%)] active:translate-y-px"
                  >
                    <IconSend size={14} />
                    Queue
                  </button>
                )}
                <button
                  onClick={() => { if (!aborting) onAbort() }}
                  disabled={aborting}
                  className="flex h-9 items-center gap-1.5 rounded-[8px] border border-[color-mix(in_srgb,var(--bad)_42%,var(--border))] bg-[color-mix(in_srgb,var(--bad)_7%,transparent)] px-3 text-[12px] font-semibold text-[var(--bad)] transition-colors hover:bg-[color-mix(in_srgb,var(--bad)_16%,transparent)] disabled:opacity-60 disabled:cursor-wait"
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
                className="composer-send-button flex h-9 items-center gap-1.5 rounded-[8px] border border-[color-mix(in_srgb,var(--accent)_34%,transparent)] bg-[color-mix(in_srgb,var(--accent)_84%,var(--text)_16%)] px-3 text-[12px] font-semibold text-[var(--accent-ink)] shadow-[0_12px_32px_-22px_var(--accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_92%,var(--text)_8%)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none disabled:active:translate-y-0"
              >
                <IconSend size={14} />
                Send
              </button>
            )}
          </div>
          {/* Status bar */}
          <div className="composer-control-strip mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-[color-mix(in_srgb,var(--border)_86%,transparent)] px-1 pt-2 text-[12px]">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {/* Permission dropdown */}
            <div className="relative shrink-0">
              <button
                onClick={() => {
                  setShowPermMenu(!showPermMenu)
                  setShowEffortMenu(false)
                  setShowModelMenu(false)
                }}
                className={controlButtonCls}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${permDotColor}`} />
                <span className="min-w-0">
                  <span className="block font-mono text-[10px] uppercase text-[var(--muted)]">权限</span>
                  <span className="block truncate">{permLabel}</span>
                </span>
                <span className="ml-auto text-[var(--muted)]">⌄</span>
              </button>
              {showPermMenu && (
                <div className={`${popoverCls} left-0 min-w-[190px]`}>
                  <button
                    onClick={() => { onPermissionChange?.('relaxed'); setShowPermMenu(false) }}
                    className={`${popoverItemCls} ${permissionMode === 'relaxed' ? 'bg-[color-mix(in_srgb,var(--warn)_8%,transparent)] text-[var(--warn)]' : ''}`}
                  >
                    完全访问
                  </button>
                  <button
                    onClick={() => { onPermissionChange?.('standard'); setShowPermMenu(false) }}
                    className={`${popoverItemCls} ${permissionMode === 'standard' ? 'bg-[color-mix(in_srgb,var(--good)_8%,transparent)] text-[var(--good)]' : ''}`}
                  >
                    标准模式
                  </button>
                  <button
                    onClick={() => { onPermissionChange?.('strict'); setShowPermMenu(false) }}
                    className={`${popoverItemCls} ${permissionMode === 'strict' ? 'bg-[color-mix(in_srgb,var(--bad)_8%,transparent)] text-[var(--bad)]' : ''}`}
                  >
                    严格模式
                  </button>
                </div>
              )}
            </div>

            {/* Effort dropdown */}
            <div className="relative shrink-0">
              <button
                onClick={() => {
                  setShowEffortMenu(!showEffortMenu)
                  setShowPermMenu(false)
                  setShowModelMenu(false)
                }}
                className={controlButtonCls}
              >
                <span className={`inline-block h-2 w-2 rounded-full ${effort === 'off' ? 'bg-[var(--muted)]' : 'bg-[var(--good)]'}`} />
                <span className="min-w-0">
                  <span className="block font-mono text-[10px] uppercase text-[var(--muted)]">推理</span>
                  <span className="block truncate">
                    {(() => {
                      const labels: Record<string, string> = { off: '推理:关', low: '推理:低', medium: '推理:中', high: '推理:高', xhigh: '推理:超高', max: '推理:最大' }
                      return labels[effort]
                    })()}
                  </span>
                </span>
                <span className="ml-auto text-[var(--muted)]">⌄</span>
              </button>
              {showEffortMenu && (
                <div className={`${popoverCls} left-0 min-w-[200px]`}>
                  <div className="px-3 py-2 text-[10px] text-[var(--muted)] flex items-center justify-between border-b border-[color-mix(in_srgb,var(--border)_86%,transparent)]">
                    <span>速度</span>
                    <span>智能</span>
                  </div>
                  {(['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const).map((lvl) => {
                    const labels = { off: '关闭', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最大' } as const
                    return (
                      <button
                        key={lvl}
                        onClick={() => { onEffortChange?.(lvl); setShowEffortMenu(false) }}
                        className={`${popoverItemCls} ${effort === lvl ? 'bg-[color-mix(in_srgb,var(--good)_8%,transparent)] text-[var(--good)]' : ''}`}
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
              className={`${controlButtonCls} shrink-0 ${planMode ? 'border-[color-mix(in_srgb,var(--plan)_28%,var(--border))]' : ''}`}
            >
              <span className={`inline-block h-2 w-2 rounded-full ${planMode ? 'bg-[var(--plan)]' : 'bg-[var(--muted)]'}`} />
              <span>
                <span className="block font-mono text-[10px] uppercase text-[var(--muted)]">模式</span>
                <span className={planMode ? 'text-[var(--plan)]' : 'text-[var(--text)]'}>规划</span>
              </span>
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
          <div className="relative min-w-[180px] max-w-[42%] shrink">
            <button
              onClick={() => {
                setShowPermMenu(false)
                setShowEffortMenu(false)
                if (models && models.length > 0) setShowModelMenu(!showModelMenu)
                else onModelClick?.()
              }}
              className={`${controlButtonCls} w-full`}
              title={modelName || 'No Model'}
            >
              <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)]" />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[10px] uppercase text-[var(--muted)]">模型</span>
                <span className="block truncate font-mono text-[11px]">{modelName || 'No Model'}</span>
              </span>
              <span className="text-[var(--muted)]">⌄</span>
            </button>
            {showModelMenu && models && models.length > 0 && (
              <div className={`${popoverCls} right-0 max-h-[260px] min-w-[260px] overflow-y-auto`}>
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { onModelChange?.(m.id); setShowModelMenu(false) }}
                    className={`${popoverItemCls} ${m.id === modelId ? 'bg-[color-mix(in_srgb,var(--accent)_9%,var(--surface-2))] text-[var(--accent)]' : ''}`}
                  >
                    {m.id === modelId && <span className="mr-1">✓</span>}
                    <span>{m.name}</span>
                    <span className="text-[11px] text-[var(--muted)] ml-2">{m.groupName}</span>
                  </button>
                ))}
                <button
                  onClick={() => { setShowModelMenu(false); onModelClick?.() }}
                  className="block w-full border-t border-[color-mix(in_srgb,var(--border)_86%,transparent)] px-3 py-2 text-left text-[12px] text-[var(--muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--surface-3)_54%,transparent)] hover:text-[var(--text)]"
                >
                  Settings...
                </button>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}
