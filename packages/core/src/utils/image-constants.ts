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
