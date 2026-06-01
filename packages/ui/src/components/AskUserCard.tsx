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
      <div className="ask-user-card is-answered mb-3">
        <div className="ask-user-bar">
          <span className="ask-user-mark" />
          <span>ASK USER</span>
          <strong>ANSWERED</strong>
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
    <div className="ask-user-card mb-3">
      <div className="ask-user-bar">
        <span className="ask-user-mark is-live" />
        <span>ASK USER</span>
        <strong>WAITING FOR INPUT</strong>
      </div>
      <div className="ask-user-body">
        <p className="ask-user-question">{question}</p>
        {options && (
          <div className="ask-user-options">
            {options.map((opt) => (
              <label
                key={opt.label}
                className="ask-user-option"
                data-selected={selected.has(opt.label) ? 'true' : 'false'}
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
                  <span>{opt.label}</span>
                  {opt.description && (
                    <p>{opt.description}</p>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}
        <input
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && submit()}
          className="ask-user-input"
          placeholder={options ? '补充输入（可选）...' : '输入回答...'}
        />
        <button
          onClick={submit}
          className="ask-user-submit"
        >
          Submit
        </button>
      </div>
    </div>
  )
}
