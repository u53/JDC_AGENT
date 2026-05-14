import { useEffect } from 'react'

type HotkeyHandler = () => void
type HotkeyMap = Record<string, HotkeyHandler>

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

function normalizeEvent(e: KeyboardEvent): string {
  const parts: string[] = []

  if (isMac ? e.metaKey : e.ctrlKey) parts.push('mod')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')

  const key = e.key.toLowerCase()

  // Don't include modifier keys themselves as the base key
  if (['meta', 'control', 'shift', 'alt'].includes(key)) return ''

  parts.push(key === 'escape' ? 'escape' : key)
  return parts.join('+')
}

export function useHotkeys(map: HotkeyMap): void {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const combo = normalizeEvent(e)
      if (!combo) return

      const action = map[combo]
      if (action) {
        e.preventDefault()
        e.stopPropagation()
        action()
      }
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [map])
}
