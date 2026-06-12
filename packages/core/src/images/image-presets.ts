export interface SizePreset { label: string; value: string }

export const SIZE_PRESETS: SizePreset[] = [
  { label: '1K 方图 1:1 1024x1024', value: '1024x1024' },
  { label: '2K 方图 1:1 2048x2048', value: '2048x2048' },
  { label: '1K 横图 16:9 1792x1008', value: '1792x1008' },
  { label: '2K 横图 16:9 2048x1152', value: '2048x1152' },
  { label: '2.5K 横图 16:9 2560x1440', value: '2560x1440' },
  { label: '3K 横图 16:9 3072x1728', value: '3072x1728' },
  { label: '4K 横图 16:9 3840x2160', value: '3840x2160' },
  { label: '1K 竖图 9:16 1008x1792', value: '1008x1792' },
  { label: '2K 竖图 9:16 1152x2048', value: '1152x2048' },
  { label: '4K 竖图 9:16 2160x3840', value: '2160x3840' },
  { label: '1K 横图 3:2 1536x1024', value: '1536x1024' },
  { label: '1K 竖图 2:3 1024x1536', value: '1024x1536' },
  { label: 'auto 模型自动选择', value: 'auto' },
]

export const QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high'] as const
export const FORMAT_OPTIONS = ['png', 'jpeg', 'webp'] as const
export const BACKGROUND_OPTIONS = ['transparent', 'opaque', 'auto'] as const

const MAX_RATIO = 3

export interface ResolvedOutputSize { width: number | null; height: number | null }

export function resolveOutputSize(size: string): ResolvedOutputSize {
  const raw = size?.trim()
  if (!raw || raw === 'auto') return { width: null, height: null }
  const match = raw.match(/^(\d+)x(\d+)$/i)
  if (!match) throw new Error('尺寸格式必须是 宽x高，例如 1024x1024')
  const width = Number(match[1])
  const height = Number(match[2])
  if (width <= 0 || height <= 0) throw new Error('宽高必须大于 0')
  if (width % 16 !== 0 || height % 16 !== 0) throw new Error('宽高必须是 16 的倍数')
  const ratio = Math.max(width, height) / Math.min(width, height)
  if (ratio > MAX_RATIO) throw new Error('宽高比例不能超过 3:1')
  return { width, height }
}

export function clampCompression(value: number): number {
  const integer = Math.floor(Number(value))
  if (!Number.isFinite(integer)) return 100
  return Math.min(100, Math.max(0, integer))
}
