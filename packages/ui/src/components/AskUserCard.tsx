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
      <div className="mb-3 border border-[#333] px-3 py-2 text-xs text-[#666]">
        <span className="uppercase tracking-[0.1em]">
          &gt;&gt;&gt; ask_user
        </span>
        <span className="text-[#4AF626] ml-2">[ANSWERED]</span>
      </div>
    )
  }

  const submit = () => {
    let answer: string
    if (options && selected.size > 0) {
      answer = Array.from(selected).join(', ')
    } else {
      answer = textInput
    }
    if (!answer) return
    setResponded(true)
    onRespond(id, answer)
  }

  return (
    <div className="mb-3 border border-[#4AF626] bg-[#0A0A0A] p-4">
      <p className="text-sm text-[#EAEAEA] mb-3">{question}</p>
      {options ? (
        <div className="space-y-2 mb-3">
          {options.map((opt) => (
            <label
              key={opt.label}
              className="flex items-start gap-2 cursor-pointer text-xs text-[#EAEAEA] hover:text-[#4AF626]"
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
              <span>
                {opt.label}
                {opt.description && (
                  <span className="text-[#666] ml-2">
                    — {opt.description}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      ) : (
        <input
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          className="w-full bg-[#050505] border border-[#333] px-3 py-2 text-sm text-[#EAEAEA] mb-3 focus:border-[#4AF626] outline-none"
          placeholder="Type your answer..."
        />
      )}
      <button
        onClick={submit}
        className="border border-[#4AF626] text-[#4AF626] px-4 py-1.5 text-xs uppercase tracking-[0.05em] hover:bg-[#4AF626] hover:text-[#0A0A0A]"
      >
        Submit
      </button>
    </div>
  )
}
