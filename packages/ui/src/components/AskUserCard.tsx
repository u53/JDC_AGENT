import { useState } from 'react'

interface AskUserProps {
  id: string
  question: string
  options?: { label: string; description?: string }[]
  multiSelect?: boolean
  onRespond: (id: string, answer: string) => void
}

export function AskUserCard({
  id,
  question,
  options,
  multiSelect,
  onRespond,
}: AskUserProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [textInput, setTextInput] = useState('')
  const [responded, setResponded] = useState(false)

  if (responded) {
    return (
      <div className="mb-3 border border-[#333] px-3 py-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em]">
          <span className="text-[#666]">&gt;&gt;&gt; ASK_USER</span>
          <span className="text-[#4AF626]">[ANSWERED]</span>
        </div>
      </div>
    )
  }

  const submit = () => {
    const parts: string[] = []
    if (selected.size > 0) parts.push(Array.from(selected).join(', '))
    if (textInput.trim()) parts.push(textInput.trim())
    const answer = parts.join('; ')
    if (!answer) return
    setResponded(true)
    onRespond(id, answer)
  }

  return (
    <div className="mb-3 border border-[#4AF626]/60 bg-[#0A0A0A]">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[#333] text-[10px] uppercase tracking-[0.1em]">
        <span className="inline-block h-2 w-2 rounded-full bg-[#4AF626] animate-pulse" />
        <span className="text-[#4AF626]">WAITING FOR INPUT</span>
      </div>
      <div className="px-4 py-3">
        <p className="text-sm text-[#EAEAEA] mb-4">{question}</p>
        {options && (
          <div className="space-y-1.5 mb-4">
            {options.map((opt) => (
              <label
                key={opt.label}
                className={`flex items-start gap-2.5 px-3 py-2 cursor-pointer border transition-colors ${
                  selected.has(opt.label)
                    ? 'border-[#4AF626]/50 bg-[#4AF626]/5'
                    : 'border-[#333] hover:border-[#666]'
                }`}
              >
                <input
                  type={multiSelect ? 'checkbox' : 'radio'}
                  name={`ask-${id}`}
                  checked={selected.has(opt.label)}
                  onChange={() => {
                    const next = new Set(multiSelect ? selected : [])
                    if (next.has(opt.label)) next.delete(opt.label)
                    else next.add(opt.label)
                    setSelected(next)
                  }}
                  className="mt-0.5 accent-[#4AF626]"
                />
                <div>
                  <span className="text-sm text-[#EAEAEA]">{opt.label}</span>
                  {opt.description && (
                    <span className="text-xs text-[#666] ml-2">{opt.description}</span>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}
        <input
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="w-full bg-[#050505] border border-[#333] px-3 py-2 text-sm text-[#EAEAEA] mb-4 focus:border-[#4AF626] outline-none placeholder-[#666]"
          placeholder={options ? '补充输入（可选）...' : '输入回答...'}
        />
        <button
          onClick={submit}
          className="border border-[#4AF626] text-[#4AF626] px-5 py-2 text-[10px] uppercase tracking-[0.1em] hover:bg-[#4AF626] hover:text-[#0A0A0A] transition-colors"
        >
          [SUBMIT]
        </button>
      </div>
    </div>
  )
}
