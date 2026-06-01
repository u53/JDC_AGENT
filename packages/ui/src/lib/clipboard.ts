export async function copyToClipboard(text: string): Promise<void> {
  if (!text) {
    throw new Error('Nothing to copy')
  }

  if ((window as any).electronAPI?.writeClipboard) {
    await Promise.resolve((window as any).electronAPI.writeClipboard(text))
    return
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  const copied = document.execCommand('copy')
  document.body.removeChild(ta)

  if (!copied) {
    throw new Error('Copy command failed')
  }
}
