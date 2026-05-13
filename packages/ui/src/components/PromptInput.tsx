import { useState, useRef, useCallback, type KeyboardEvent, type ClipboardEvent, type DragEvent } from 'react'
import { ImagePreview } from './ImagePreview'

interface Props {
  onSend: (text: string, images?: { data: string; mediaType: string }[]) => void
  onAbort: () => void
  isStreaming: boolean
}

export function PromptInput({ onSend, onAbort, isStreaming }: Props) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<{ data: string; mediaType: string }[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const addImageFile = useCallback((file: File) => {
    const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
    if (!validTypes.includes(file.type)) return
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      if (base64) {
        setImages(prev => [...prev, { data: base64, mediaType: file.type }])
      }
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
    const files = e.dataTransfer?.files
    if (!files) return
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        addImageFile(file)
      }
    }
  }, [addImageFile])

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
  }, [])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
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
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }

  return (
    <div className="border-t border-[#333] px-6 py-4" onDrop={handleDrop} onDragOver={handleDragOver}>
      <ImagePreview images={images} onRemove={(i) => setImages(prev => prev.filter((_, idx) => idx !== i))} />
      <div className="mx-auto max-w-[760px] flex items-end gap-3">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => { setText(e.target.value); handleInput() }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={1}
          placeholder="> ENTER COMMAND..."
          className="flex-1 resize-none bg-transparent border border-[#333] px-4 py-3 text-sm text-[#EAEAEA] placeholder-[#666] focus:border-[#EAEAEA] focus:outline-none transition-colors"
        />
        {isStreaming ? (
          <button
            onClick={onAbort}
            className="border border-[#E61919] text-[#E61919] px-4 py-2 text-[10px] uppercase tracking-[0.05em] hover:bg-[#E61919] hover:text-[#EAEAEA] transition-colors"
          >
            [ABORT]
          </button>
        ) : (
          <button
            onClick={() => { if (text.trim() || images.length > 0) { onSend(text.trim(), images.length > 0 ? images : undefined); setText(''); setImages([]) } }}
            className="border border-[#EAEAEA] text-[#EAEAEA] px-4 py-2 text-[10px] uppercase tracking-[0.05em] hover:bg-[#EAEAEA] hover:text-[#0A0A0A] transition-colors"
          >
            [SEND]
          </button>
        )}
      </div>
    </div>
  )
}
