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
    <div className="border-t border-[#333] px-6 py-4">
      <div className="mx-auto max-w-[720px] flex items-end gap-3">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => { setText(e.target.value); handleInput() }}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="输入消息..."
          className="flex-1 resize-none bg-transparent border border-[#333] px-4 py-3 text-sm text-[#EAEAEA] placeholder-[#666] focus:border-[#EAEAEA] focus:outline-none transition-colors"
        />
        {isStreaming ? (
          <button
            onClick={onAbort}
            className="border border-[#E61919] text-[#E61919] px-4 py-2 text-xs uppercase tracking-[0.05em] hover:bg-[#E61919] hover:text-[#EAEAEA] transition-colors"
          >
            停止
          </button>
        ) : (
          <button
            onClick={() => { if (text.trim()) { onSend(text.trim()); setText('') } }}
            className="border border-[#EAEAEA] text-[#EAEAEA] px-4 py-2 text-xs uppercase tracking-[0.05em] hover:bg-[#EAEAEA] hover:text-[#0A0A0A] transition-colors"
          >
            发送
          </button>
        )}
      </div>
    </div>
  )
}
