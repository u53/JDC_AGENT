export function copyToClipboard(text: string): void {
  if ((window as any).electronAPI?.writeClipboard) {
    (window as any).electronAPI.writeClipboard(text)
    return
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}
