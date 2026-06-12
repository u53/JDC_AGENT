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

export async function copyImageFile(filePath: string): Promise<void> {
  const api = (window as any).electronAPI
  if (api?.copyImageFile) {
    const res = await api.copyImageFile(filePath)
    if (res && res.success === false) throw new Error(res.error || '复制图片失败')
    return
  }
  // Browser fallback: fetch file:// usually blocked, try navigator.clipboard
  const resp = await fetch(`file://${filePath}`)
  const blob = await resp.blob()
  await (navigator.clipboard as any).write([new (window as any).ClipboardItem({ [blob.type]: blob })])
}
