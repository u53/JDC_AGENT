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
      <div className="mb-3 border border-[var(--border)] px-3 py-2 rounded-[8px]">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.1em]">
          <span className="text-[var(--muted)]">&gt;&gt;&gt; ASK_USER</span>
          <span className="text-[var(--good)]">[ANSWERED]</span>
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
    <div className="mb-3 border border-[var(--border)] bg-[var(--surface)] rounded-[8px]">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] text-[10px] uppercase tracking-[0.1em]">
        <span className="inline-block h-2 w-2 rounded-full bg-[var(--good)] animate-pulse" />
        <span className="text-[var(--good)]">WAITING FOR INPUT</span>
      </div>
      <div className="px-4 py-3">
        <p className="text-sm text-[var(--text)] mb-4">{question}</p>
        {options && (
          <div className="space-y-1.5 mb-4">
            {options.map((opt) => (
              <label
                key={opt.label}
                className={`flex items-start gap-2.5 px-3 py-2 cursor-pointer border transition-colors rounded-[4px] ${
                  selected.has(opt.label)
                    ? 'border-[var(--border)] bg-[var(--accent-soft)]'
                    : 'border-[var(--border)] hover:bg-[var(--surface-2)]'
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
                  className="mt-0.5 accent-[var(--good)]"
                />
                <div>
                  <span className="text-sm text-[var(--text)]">{opt.label}</span>
                  {opt.description && (
                    <span className="text-xs text-[var(--muted)] ml-2">{opt.description}</span>
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
          className="w-full bg-[var(--surface-2)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text)] mb-4 focus:border-[var(--good)] outline-none placeholder-[var(--muted)]"
          placeholder={options ? '补充输入（可选）...' : '输入回答...'}
        />
        <button
          onClick={submit}
          className="border border-[var(--good)] text-[var(--good)] px-5 py-2 text-[10px] uppercase tracking-[0.1em] hover:opacity-80 transition-colors"
        >
          Submit
        </button>
      </div>
    </div>
  )
}
