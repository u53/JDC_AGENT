import { useState, useRef, useCallback, type KeyboardEvent, type ClipboardEvent, type DragEvent } from 'react'
import { ImagePreview } from './ImagePreview'
import { SlashCommandMenu, type SlashCommand } from './SlashCommandMenu'

interface Props {
  onSend: (text: string, images?: { data: string; mediaType: string }[]) => void
  onAbort: () => void
  isStreaming: boolean
  onSlashCommand?: (command: string) => void
  permissionMode?: string
  onPermissionChange?: (mode: string) => void
  modelName?: string
  onModelClick?: () => void
  skills?: { name: string; description: string }[]
}

export function PromptInput({ onSend, onAbort, isStreaming, onSlashCommand, permissionMode = 'standard', onPermissionChange, modelName, onModelClick, skills }: Props) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<{ data: string; mediaType: string }[]>([])
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [showPermMenu, setShowPermMenu] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isComposingRef = useRef(false)

  const addImageFile = useCallback((file: File) => {
    const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
    if (!validTypes.includes(file.type)) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      if (base64) setImages(prev => [...prev, { data: base64, mediaType: file.type }])
    }
    reader.readAsDataURL(file)
  }, [])

  const handlePaste = useCallback((e: ClipboardEvent<HTMLTextAreaElement>) => {
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
  }, [addImageFile])

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    for (const file of e.dataTransfer?.files || []) {
      if (file.type.startsWith('image/')) addImageFile(file)
    }
  }, [addImageFile])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => { e.preventDefault() }, [])

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
    setText('')
    onSlashCommand?.(`/${cmd.name}`)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ignore Enter during IME composition (Chinese/Japanese input)
    if (isComposingRef.current) return

    if (showSlashMenu && ['ArrowDown', 'ArrowUp', 'Tab', 'Enter'].includes(e.key)) return
    if (e.key === 'Escape' && showSlashMenu) { setShowSlashMenu(false); return }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (text.startsWith('/') && !text.includes(' ')) {
        onSlashCommand?.(text)
        setText('')
        setShowSlashMenu(false)
        return
      }
      if ((text.trim() || images.length > 0) && !isStreaming) {
        onSend(text.trim(), images.length > 0 ? images : undefined)
        setText('')
        setImages([])
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
      }
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` }
  }

  const permLabel = permissionMode === 'strict' ? '严格模式' : permissionMode === 'relaxed' ? '完全访问' : '标准模式'
  const permColor = permissionMode === 'relaxed' ? 'text-yellow-400' : permissionMode === 'strict' ? 'text-red-400' : 'text-[#4AF626]'

  return (
    <div className="border-t border-[#333] px-6 py-3" onDrop={handleDrop} onDragOver={handleDragOver}>
      <ImagePreview images={images} onRemove={(i) => setImages(prev => prev.filter((_, idx) => idx !== i))} />
      <div className="mx-auto max-w-[760px]">
        <div className="relative mb-2">
          <SlashCommandMenu filter={slashFilter} visible={showSlashMenu} onSelect={handleSlashSelect} onClose={() => setShowSlashMenu(false)} skills={skills} />
          <div className="flex items-end gap-3">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => { handleTextChange(e.target.value); handleInput() }}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => { isComposingRef.current = true }}
              onCompositionEnd={() => { isComposingRef.current = false }}
              onPaste={handlePaste}
              rows={1}
              placeholder="> ENTER COMMAND... (/ for menu)"
              className="flex-1 resize-none bg-transparent border border-[#333] px-4 py-3 text-sm text-[#EAEAEA] placeholder-[#666] focus:border-[#EAEAEA] focus:outline-none transition-colors"
            />
            {isStreaming ? (
              <button onClick={onAbort} className="border border-[#E61919] text-[#E61919] px-4 py-2 text-[10px] uppercase tracking-[0.05em] hover:bg-[#E61919] hover:text-[#EAEAEA] transition-colors">[ABORT]</button>
            ) : (
              <button onClick={() => { if (text.trim() || images.length > 0) { onSend(text.trim(), images.length > 0 ? images : undefined); setText(''); setImages([]) } }} className="border border-[#EAEAEA] text-[#EAEAEA] px-4 py-2 text-[10px] uppercase tracking-[0.05em] hover:bg-[#EAEAEA] hover:text-[#0A0A0A] transition-colors">[SEND]</button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.05em]">
          <div className="flex items-center gap-3">
            <div className="relative">
              <button onClick={() => setShowPermMenu(!showPermMenu)} className={`${permColor} hover:opacity-80 transition-opacity`}>{permLabel} ▾</button>
              {showPermMenu && (
                <div className="absolute bottom-full left-0 mb-1 border border-[#333] bg-[#0A0A0A] z-50 min-w-[120px]">
                  <button onClick={() => { onPermissionChange?.('relaxed'); setShowPermMenu(false) }} className={`block w-full text-left px-3 py-1.5 hover:bg-[#111] ${permissionMode === 'relaxed' ? 'text-yellow-400' : 'text-[#EAEAEA]'}`}>完全访问</button>
                  <button onClick={() => { onPermissionChange?.('standard'); setShowPermMenu(false) }} className={`block w-full text-left px-3 py-1.5 hover:bg-[#111] ${permissionMode === 'standard' ? 'text-[#4AF626]' : 'text-[#EAEAEA]'}`}>标准模式</button>
                  <button onClick={() => { onPermissionChange?.('strict'); setShowPermMenu(false) }} className={`block w-full text-left px-3 py-1.5 hover:bg-[#111] ${permissionMode === 'strict' ? 'text-red-400' : 'text-[#EAEAEA]'}`}>严格模式</button>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onModelClick} className="text-[#EAEAEA] hover:text-[#4AF626] transition-colors">{modelName || 'NO MODEL'} ▾</button>
          </div>
        </div>
      </div>
    </div>
  )
}
