import { useState, useRef, type KeyboardEvent } from 'react'

interface Props {
  onSend: (text: string) => void
  onAbort: () => void
  isStreaming: boolean
}

export function PromptInput({ onSend, onAbort, isStreaming }: Props) {
  const [text, setText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (text.trim() && !isStreaming) {
        onSend(text.trim())
        setText('')
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
    <div className="border-t border-[#EAEAEA] px-6 py-4">
      <div className="mx-auto max-w-[720px] flex items-end gap-3">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => { setText(e.target.value); handleInput() }}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="输入消息..."
          className="flex-1 resize-none rounded-[8px] border border-[#EAEAEA] bg-white px-4 py-3 text-sm text-[#2F3437] placeholder-[#787774] focus:border-[#111111] focus:outline-none transition-colors"
        />
        {isStreaming ? (
          <button
            onClick={onAbort}
            className="rounded-[6px] bg-[#FDEBEC] px-4 py-2.5 text-sm text-[#9F2F2D] hover:opacity-80 transition-opacity"
          >
            停止
          </button>
        ) : (
          <button
            onClick={() => { if (text.trim()) { onSend(text.trim()); setText('') } }}
            className="rounded-[6px] bg-[#111111] px-4 py-2.5 text-sm text-white hover:opacity-90 transition-opacity"
          >
            发送
          </button>
        )}
      </div>
    </div>
  )
}
