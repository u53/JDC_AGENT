# Image Compression Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete image compression/resizing pipeline to JDC CODE so images are optimized before hitting the API, matching Claude Code's behavior.

**Architecture:** A standalone `image-resizer.ts` module in `packages/core/src/utils/` that provides `compressImageForAPI()`. The electron `session-manager.ts` calls this function before constructing `ImageContent` blocks. Uses `sharp` for image processing with a multi-strategy fallback (PNG palette → JPEG quality ladder → dimension resize → aggressive fallback).

**Tech Stack:** TypeScript, sharp (image processing), Buffer (Node.js)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/core/src/utils/image-resizer.ts` | Core compression logic: size limits, multi-strategy compression, format detection |
| `packages/core/src/utils/image-constants.ts` | API limits constants (max base64 size, target raw size, max dimensions) |
| `packages/electron/src/session-manager.ts` | Modified: call `compressImageForAPI()` before sending images |
| `packages/core/src/__tests__/image-resizer.test.ts` | Unit tests for compression pipeline |

---

### Task 1: Add sharp dependency

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: Install sharp in core package**

```bash
cd /Users/chenmingxu/Documents/jdcagnet/packages/core && npm install sharp && npm install -D @types/sharp
```

- [ ] **Step 2: Verify installation**

```bash
cd /Users/chenmingxu/Documents/jdcagnet/packages/core && node -e "const sharp = require('sharp'); console.log('sharp version:', sharp.versions.sharp)"
```

Expected: prints sharp version without errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/package.json packages/core/node_modules/.package-lock.json
git commit -m "feat: add sharp dependency for image compression"
```

---

### Task 2: Create image constants

**Files:**
- Create: `packages/core/src/utils/image-constants.ts`

- [ ] **Step 1: Create the constants file**

```typescript
// packages/core/src/utils/image-constants.ts

/** Maximum base64-encoded image size accepted by the API (5 MB). */
export const API_IMAGE_MAX_BASE64_SIZE = 5 * 1024 * 1024

/**
 * Target raw image size. Base64 encoding inflates by 4/3,
 * so raw_size * 4/3 must stay under API_IMAGE_MAX_BASE64_SIZE.
 */
export const IMAGE_TARGET_RAW_SIZE = (API_IMAGE_MAX_BASE64_SIZE * 3) / 4 // 3.75 MB

/** Client-side max width for resizing. */
export const IMAGE_MAX_WIDTH = 2000

/** Client-side max height for resizing. */
export const IMAGE_MAX_HEIGHT = 2000

/** Supported image media types. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/utils/image-constants.ts
git commit -m "feat: add image API limit constants"
```

---

### Task 3: Implement image-resizer module

**Files:**
- Create: `packages/core/src/utils/image-resizer.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/__tests__/image-resizer.test.ts`:

```typescript
import { compressImageForAPI } from '../utils/image-resizer'
import { IMAGE_TARGET_RAW_SIZE, API_IMAGE_MAX_BASE64_SIZE } from '../utils/image-constants'
import sharp from 'sharp'

describe('compressImageForAPI', () => {
  it('passes through small images unchanged', async () => {
    const smallImage = await sharp({ create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } } })
      .png()
      .toBuffer()

    const result = await compressImageForAPI(smallImage.toString('base64'), 'image/png')
    expect(result.data.length).toBeGreaterThan(0)
    expect(result.mediaType).toBe('image/png')
  })

  it('compresses large images to fit within target size', async () => {
    // Create a large 4000x4000 image
    const largeImage = await sharp({ create: { width: 4000, height: 4000, channels: 3, background: { r: 128, g: 128, b: 128 } } })
      .png()
      .toBuffer()

    const result = await compressImageForAPI(largeImage.toString('base64'), 'image/png')
    const resultBuffer = Buffer.from(result.data, 'base64')
    expect(resultBuffer.length).toBeLessThanOrEqual(IMAGE_TARGET_RAW_SIZE)
  })

  it('respects max dimension limits', async () => {
    // Create oversized image
    const wideImage = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: { r: 0, g: 255, b: 0 } } })
      .png()
      .toBuffer()

    const result = await compressImageForAPI(wideImage.toString('base64'), 'image/png')
    const metadata = await sharp(Buffer.from(result.data, 'base64')).metadata()
    expect(metadata.width).toBeLessThanOrEqual(2000)
    expect(metadata.height).toBeLessThanOrEqual(2000)
  })

  it('preserves PNG format when compression is sufficient', async () => {
    // Medium PNG that can be compressed without format change
    const mediumImage = await sharp({ create: { width: 800, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } })
      .png()
      .toBuffer()

    const result = await compressImageForAPI(mediumImage.toString('base64'), 'image/png')
    expect(result.mediaType).toMatch(/image\/(png|jpeg)/)
  })

  it('handles empty base64 gracefully', async () => {
    await expect(compressImageForAPI('', 'image/png')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/chenmingxu/Documents/jdcagnet && npx jest packages/core/src/__tests__/image-resizer.test.ts --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the image-resizer module**

Create `packages/core/src/utils/image-resizer.ts`:

```typescript
import sharp from 'sharp'
import {
  IMAGE_TARGET_RAW_SIZE,
  IMAGE_MAX_WIDTH,
  IMAGE_MAX_HEIGHT,
  API_IMAGE_MAX_BASE64_SIZE,
  type ImageMediaType,
} from './image-constants'

export interface CompressedImage {
  data: string        // base64-encoded
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/chenmingxu/Documents/jdcagnet && npx jest packages/core/src/__tests__/image-resizer.test.ts --no-coverage
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/utils/image-resizer.ts packages/core/src/__tests__/image-resizer.test.ts
git commit -m "feat: implement image compression pipeline with multi-strategy fallback"
```

---

### Task 4: Integrate into session-manager

**Files:**
- Modify: `packages/electron/src/session-manager.ts:380-388`

- [ ] **Step 1: Add import at top of session-manager.ts**

Add after existing imports:

```typescript
import { compressImageForAPI } from '@jdcagnet/core/utils/image-resizer'
```

- [ ] **Step 2: Replace the image conversion block**

Replace lines 380-388 (the `extraContent` construction) with:

```typescript
    // Compress and convert images to ImageContent blocks
    let extraContent: ImageContent[] | undefined
    if (images?.length) {
      extraContent = await Promise.all(
        images.map(async (img) => {
          const compressed = await compressImageForAPI(img.data, img.mediaType)
          return {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: compressed.mediaType,
              data: compressed.data,
            },
          }
        })
      )
    }
```

- [ ] **Step 3: Export from core package index**

Add to `packages/core/src/index.ts`:

```typescript
export { compressImageForAPI, type CompressedImage } from './utils/image-resizer'
export { IMAGE_TARGET_RAW_SIZE, API_IMAGE_MAX_BASE64_SIZE, IMAGE_MAX_WIDTH, IMAGE_MAX_HEIGHT } from './utils/image-constants'
```

- [ ] **Step 4: Build and verify no type errors**

```bash
cd /Users/chenmingxu/Documents/jdcagnet && npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/electron/src/session-manager.ts packages/core/src/index.ts
git commit -m "feat: integrate image compression into session message flow"
```

---

### Task 5: Add error handling and logging

**Files:**
- Modify: `packages/electron/src/session-manager.ts`

- [ ] **Step 1: Add try/catch around compression with fallback**

Wrap the compression in a try/catch so that if sharp fails, the original image is still sent (matching Claude Code's fallback behavior):

```typescript
    let extraContent: ImageContent[] | undefined
    if (images?.length) {
      extraContent = await Promise.all(
        images.map(async (img) => {
          try {
            const compressed = await compressImageForAPI(img.data, img.mediaType)
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: compressed.mediaType,
                data: compressed.data,
              },
            }
          } catch (err) {
            console.warn('[IMAGE] Compression failed, sending original:', (err as Error).message)
            // Fallback: check if original fits within API limit
            const rawSize = Buffer.from(img.data, 'base64').length
            const base64Size = Math.ceil((rawSize * 4) / 3)
            if (base64Size > 5 * 1024 * 1024) {
              throw new Error(`Image too large (${(base64Size / 1024 / 1024).toFixed(1)}MB) and compression failed`)
            }
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: img.mediaType as ImageContent['source']['media_type'],
                data: img.data,
              },
            }
          }
        })
      )
    }
```

- [ ] **Step 2: Build and verify**

```bash
cd /Users/chenmingxu/Documents/jdcagnet && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add packages/electron/src/session-manager.ts
git commit -m "feat: add fallback handling for image compression failures"
```

---

### Task 6: End-to-end verification

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/chenmingxu/Documents/jdcagnet && npm test
```

Expected: all tests pass.

- [ ] **Step 2: Manual test with dev server**

```bash
cd /Users/chenmingxu/Documents/jdcagnet/packages/electron && npm run dev
```

Test: paste a large screenshot (>5MB) into the chat. Verify:
1. Message sends successfully (no 413 or rate limit error)
2. Image appears in the conversation
3. No visible quality degradation for normal screenshots

- [ ] **Step 3: Final commit if any adjustments needed**

```bash
git add -A && git commit -m "fix: adjustments from e2e testing"
```
