import { useState, useEffect } from 'react'
import type { GeneratedImage, TaskGeneratedImages } from '../stores/image-store'
import { copyImageFile, copyToClipboard } from '../lib/clipboard'

export function GeneratedImageCard({ data }: { data: TaskGeneratedImages }) {
  const { images, error } = data
  if (error && !images?.length) {
    return (
      <div className="mb-3 rounded-[8px] border border-[color-mix(in_srgb,var(--accent)_28%,var(--border))] bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))] p-3">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--accent)]">Image Generation Failed</div>
        <pre className="text-[12px] whitespace-pre-wrap break-words text-[var(--text)] leading-5">{error}</pre>
      </div>
    )
  }
  if (!images?.length) return null
  return (
    <div className="mb-3 rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] p-3">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--accent)]">Generated Images</div>
      {error && <div className="mb-2 text-[11px] text-[var(--muted)]">{error}</div>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {images.filter((img) => img.path).map((img) => <ImageTile key={img.path} img={img} />)}
      </div>
    </div>
  )
}

function ImageTile({ img }: { img: GeneratedImage }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [zoomed, setZoomed] = useState(false)
  const [toast, setToast] = useState('')
  const isRemote = img.bytes === 0 && /^https?:\/\//.test(img.path)
  const isError = !img.path || img.downloadError
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 1500) }

  useEffect(() => {
    if (isRemote || isError || !img.path) return
    const api = (window as any).electronAPI
    if (api?.readImageFile) {
      api.readImageFile(img.path).then((res: any) => {
        if (res?.success && res.dataUrl) setDataUrl(res.dataUrl)
      }).catch(() => {})
    }
  }, [img.path, isRemote, isError])

  const doCopyImage = async () => {
    try { await copyImageFile(img.path); flash('已复制图片') } catch { flash('复制失败') }
  }
  const doCopyPath = async () => { await copyToClipboard(img.path); flash('已复制路径') }
  const doShow = async () => {
    const api = (window as any).electronAPI
    await api?.showImageInFolder?.(img.path)
  }

  return (
    <>
      <div className="overflow-hidden rounded-[6px] border border-[var(--border)]">
        <div
          className="relative cursor-pointer bg-[repeating-conic-gradient(#0002_0_25%,transparent_0_50%)] bg-[length:16px_16px]"
          onClick={dataUrl ? () => setZoomed(true) : undefined}
        >
          {isError
            ? <div className="flex h-32 items-center justify-center text-[11px] text-[var(--muted)]">生成失败</div>
            : isRemote
              ? <a href={img.path} target="_blank" rel="noreferrer" className="flex h-32 items-center justify-center text-[12px] text-[var(--accent)]">远程图片，点击打开</a>
              : dataUrl
                ? <img src={dataUrl} alt="" className="max-h-48 w-full object-contain" />
                : <div className="flex h-32 items-center justify-center text-[11px] text-[var(--muted)]">加载中…</div>}
        </div>
        <div className="flex flex-wrap gap-1 p-2 text-[11px]">
          {!isRemote && <button onClick={doCopyImage} className="rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--accent)]">复制图片</button>}
          <button onClick={doCopyPath} className="rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--accent)]">复制路径</button>
          {!isRemote && <button onClick={doShow} className="rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--accent)]">在文件夹显示</button>}
          {toast && <span className="self-center text-[var(--accent)]">{toast}</span>}
        </div>
        <div className="px-2 pb-2 text-[10px] text-[var(--muted)]">
          {img.width && img.height ? `${img.width}x${img.height} · ` : ''}{img.format}
          {img.downloadError ? ' · 下载失败' : ''}
        </div>
      </div>

      {zoomed && dataUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8"
          onClick={() => setZoomed(false)}
        >
          <img
            src={dataUrl}
            alt=""
            className="max-h-[90vh] max-w-[90vw] rounded-[8px] object-contain shadow-2xl"
          />
        </div>
      )}
    </>
  )
}
