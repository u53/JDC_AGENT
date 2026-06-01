import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { IconCheck, IconCopy } from '../icons'
import { copyToClipboard } from '../../lib/clipboard'
import { useToastStore } from '../../stores/toast-store'

interface ToolCopyButtonProps {
  text: string
  label?: string
  copiedLabel?: string
  title?: string
  iconOnly?: boolean
  className?: string
  toastLabel?: string
  children?: ReactNode
}

export function ToolCopyButton({
  text,
  label = 'Copy',
  copiedLabel = 'Copied',
  title = 'Copy',
  iconOnly = false,
  className,
  toastLabel,
  children,
}: ToolCopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<number | null>(null)
  const showToast = useToastStore((state) => state.showToast)

  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    }
  }, [])

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    try {
      await copyToClipboard(text)
      setCopied(true)
      showToast(`${toastLabel || label} copied`, 'success', 1300)
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
      resetTimer.current = window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
      showToast('Copy failed', 'error', 1800)
    }
  }

  return (
    <button
      className={[
        iconOnly ? 'jdc-tc-copy tool-copy-btn' : 'tool-copy-btn tool-copy-text',
        className,
      ].filter(Boolean).join(' ')}
      title={copied ? copiedLabel : title}
      aria-label={copied ? copiedLabel : title}
      data-copied={copied ? 'true' : 'false'}
      onClick={handleCopy}
      type="button"
    >
      {iconOnly ? (
        copied ? <IconCheck size={13} /> : children || <IconCopy size={13} />
      ) : (
        <span>{copied ? copiedLabel : label}</span>
      )}
    </button>
  )
}
