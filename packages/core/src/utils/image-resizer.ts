import sharp from 'sharp'
import {
  IMAGE_TARGET_RAW_SIZE,
  IMAGE_MAX_WIDTH,
  IMAGE_MAX_HEIGHT,
  type ImageMediaType,
} from './image-constants.js'

export interface CompressedImage {
  data: string
  mediaType: ImageMediaType
}

export async function compressImageForAPI(
  base64Data: string,
  mediaType: string,
): Promise<CompressedImage> {
  const imageBuffer = Buffer.from(base64Data, 'base64')

  if (imageBuffer.length === 0) {
    throw new Error('Image data is empty')
  }

  const image = sharp(imageBuffer)
  const metadata = await image.metadata()

  const format = normalizeFormat(metadata.format ?? mediaType.split('/')[1] ?? 'png')
  const isPng = format === 'png'

  const width = metadata.width ?? 0
  const height = metadata.height ?? 0

  // Fast path: image already within all limits
  if (
    imageBuffer.length <= IMAGE_TARGET_RAW_SIZE &&
    width <= IMAGE_MAX_WIDTH &&
    height <= IMAGE_MAX_HEIGHT
  ) {
    return { data: base64Data, mediaType: `image/${format}` as ImageMediaType }
  }

  const needsResize = width > IMAGE_MAX_WIDTH || height > IMAGE_MAX_HEIGHT

  // Strategy 1: Compression only (no resize needed)
  if (!needsResize && imageBuffer.length > IMAGE_TARGET_RAW_SIZE) {
    const compressed = await tryCompressionOnly(imageBuffer, isPng)
    if (compressed) return compressed
  }

  // Strategy 2: Resize to fit dimension limits
  let targetWidth = width
  let targetHeight = height

  if (targetWidth > IMAGE_MAX_WIDTH) {
    targetHeight = Math.round((targetHeight * IMAGE_MAX_WIDTH) / targetWidth)
    targetWidth = IMAGE_MAX_WIDTH
  }
  if (targetHeight > IMAGE_MAX_HEIGHT) {
    targetWidth = Math.round((targetWidth * IMAGE_MAX_HEIGHT) / targetHeight)
    targetHeight = IMAGE_MAX_HEIGHT
  }

  const resizedBuffer = await sharp(imageBuffer)
    .resize(targetWidth, targetHeight, { fit: 'inside', withoutEnlargement: true })
    .toBuffer()

  if (resizedBuffer.length <= IMAGE_TARGET_RAW_SIZE) {
    const resizedMeta = await sharp(resizedBuffer).metadata()
    const outFormat = normalizeFormat(resizedMeta.format ?? format)
    return {
      data: resizedBuffer.toString('base64'),
      mediaType: `image/${outFormat}` as ImageMediaType,
    }
  }

  // Strategy 3: Resize + compression
  if (isPng) {
    const pngCompressed = await sharp(imageBuffer)
      .resize(targetWidth, targetHeight, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 9, palette: true })
      .toBuffer()
    if (pngCompressed.length <= IMAGE_TARGET_RAW_SIZE) {
      return { data: pngCompressed.toString('base64'), mediaType: 'image/png' }
    }
  }

  for (const quality of [80, 60, 40, 20]) {
    const jpegBuffer = await sharp(imageBuffer)
      .resize(targetWidth, targetHeight, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality })
      .toBuffer()
    if (jpegBuffer.length <= IMAGE_TARGET_RAW_SIZE) {
      return { data: jpegBuffer.toString('base64'), mediaType: 'image/jpeg' }
    }
  }

  // Strategy 4: Aggressive fallback — shrink to 1000px + JPEG quality 20
  const smallerWidth = Math.min(targetWidth, 1000)
  const smallerHeight = Math.round((targetHeight * smallerWidth) / Math.max(targetWidth, 1))
  const aggressiveBuffer = await sharp(imageBuffer)
    .resize(smallerWidth, smallerHeight, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 20 })
    .toBuffer()

  return { data: aggressiveBuffer.toString('base64'), mediaType: 'image/jpeg' }
}

async function tryCompressionOnly(
  imageBuffer: Buffer,
  isPng: boolean,
): Promise<CompressedImage | null> {
  if (isPng) {
    const pngCompressed = await sharp(imageBuffer)
      .png({ compressionLevel: 9, palette: true })
      .toBuffer()
    if (pngCompressed.length <= IMAGE_TARGET_RAW_SIZE) {
      return { data: pngCompressed.toString('base64'), mediaType: 'image/png' }
    }
  }

  for (const quality of [80, 60, 40, 20]) {
    const jpegBuffer = await sharp(imageBuffer).jpeg({ quality }).toBuffer()
    if (jpegBuffer.length <= IMAGE_TARGET_RAW_SIZE) {
      return { data: jpegBuffer.toString('base64'), mediaType: 'image/jpeg' }
    }
  }

  return null
}

function normalizeFormat(format: string): string {
  if (format === 'jpg') return 'jpeg'
  if (['png', 'jpeg', 'gif', 'webp'].includes(format)) return format
  return 'png'
}
