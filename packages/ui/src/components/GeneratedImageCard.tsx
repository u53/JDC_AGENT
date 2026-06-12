import { useState } from 'react'
import type { GeneratedImage } from '../stores/image-store'
import { copyImageFile, copyToClipboard } from '../lib/clipboard'
import { ipc } from '../lib/ipc-client'

export function GeneratedImageCard({ images }: { images: GeneratedImage[] }) {
  if (!images?.length) return null
  return (
    <div className="mb-3 rounded-[8px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_82%,transparent)] p-3">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--accent)]">Generated Images</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {images.map((img) => <ImageTile key={img.path} img={img} />)}
      </div>
    </div>
  )
}

function ImageTile({ img }: { img: GeneratedImage }) {
  const [toast, setToast] = useState('')
  const isRemote = img.bytes === 0 && /^https?:\/\//.test(img.path)
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(''), 1500) }

  const doCopyImage = async () => {
    try { await copyImageFile(img.path); flash('已复制图片') } catch { flash('复制失败') }
  }
  const doCopyPath = async () => { await copyToClipboard(img.path); flash('已复制路径') }
  const doShow = async () => { await ipc.images.showInFolder(img.path) }

  return (
    <div className="overflow-hidden rounded-[6px] border border-[var(--border)]">
      <div className="relative bg-[repeating-conic-gradient(#0002_0_25%,transparent_0_50%)] bg-[length:16px_16px]">
        {isRemote
          ? <a href={img.path} target="_blank" rel="noreferrer" className="flex h-32 items-center justify-center text-[12px] text-[var(--accent)]">远程图片，点击打开</a>
          : <img src={`file://${img.path}`} alt="" className="max-h-48 w-full object-contain" />}
      </div>
      <div className="flex flex-wrap gap-1 p-2 text-[11px]">
        {!isRemote && <button onClick={doCopyImage} className="rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--accent)]">复制图片</button>}
        <button onClick={doCopyPath} className="rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--accent)]">复制路径</button>
        {!isRemote && <button onClick={doShow} className="rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--accent)]">在文件夹显示</button>}
        {toast && <span className="self-center text-[var(--accent)]">{toast}</span>}
      </div>
      <div className="px-2 pb-2 text-[10px] text-[var(--muted)]">
        {img.width && img.height ? `${img.width}x${img.height} · ` : ''}{img.format}{img.transparent ? ' · 透明' : ''}
        {img.downloadError ? ' · 下载失败' : ''}
      </div>
    </div>
  )
}
