import { describe, it, expect } from 'vitest'
import { compressImageForAPI } from '../utils/image-resizer.js'
import { IMAGE_TARGET_RAW_SIZE } from '../utils/image-constants.js'
import sharp from 'sharp'

describe('compressImageForAPI', () => {
  it('passes through small images unchanged', async () => {
    const smallImage = await sharp({
      create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer()

    const result = await compressImageForAPI(smallImage.toString('base64'), 'image/png')
    expect(result.data.length).toBeGreaterThan(0)
    expect(result.mediaType).toBe('image/png')
  })

  it('compresses large images to fit within target size', async () => {
    const largeImage = await sharp({
      create: { width: 4000, height: 4000, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .png()
      .toBuffer()

    const result = await compressImageForAPI(largeImage.toString('base64'), 'image/png')
    const resultBuffer = Buffer.from(result.data, 'base64')
    expect(resultBuffer.length).toBeLessThanOrEqual(IMAGE_TARGET_RAW_SIZE)
  })

  it('respects max dimension limits', async () => {
    const wideImage = await sharp({
      create: { width: 3000, height: 1000, channels: 3, background: { r: 0, g: 255, b: 0 } },
    })
      .png()
      .toBuffer()

    const result = await compressImageForAPI(wideImage.toString('base64'), 'image/png')
    const metadata = await sharp(Buffer.from(result.data, 'base64')).metadata()
    expect(metadata.width).toBeLessThanOrEqual(2000)
  })

  it('handles empty base64 gracefully', async () => {
    await expect(compressImageForAPI('', 'image/png')).rejects.toThrow('Image data is empty')
  })

  it('normalizes jpg to jpeg format', async () => {
    const jpgImage = await sharp({
      create: { width: 50, height: 50, channels: 3, background: { r: 0, g: 0, b: 255 } },
    })
      .jpeg()
      .toBuffer()

    const result = await compressImageForAPI(jpgImage.toString('base64'), 'image/jpg')
    expect(result.mediaType).toBe('image/jpeg')
  })
})
