/**
 * Pure client-side image operations for the canvas image tools (crop / transform /
 * upscale). Each returns a PNG data URL; persistence + node creation is handled by
 * the `addDerivedImage` graph action.
 */

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface AngleTransform {
  /** clockwise rotation in degrees (any value; 90-steps keep it lossless) */
  rotate: number
  flipH: boolean
  flipV: boolean
}

function toPngDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/png')
}

/** Crop a region (in source pixels) out of the image. */
export function cropImage(image: HTMLImageElement, rect: CropRect): string | null {
  const w = Math.round(Math.max(1, rect.width))
  const h = Math.round(Math.max(1, rect.height))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.drawImage(image, Math.round(rect.x), Math.round(rect.y), w, h, 0, 0, w, h)
  return toPngDataUrl(canvas)
}

/** Rotate (any angle) and/or flip the image. Output canvas is sized to fit the rotation. */
export function transformImage(image: HTMLImageElement, t: AngleTransform): string | null {
  const sw = image.naturalWidth
  const sh = image.naturalHeight
  const rad = (t.rotate * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const outW = Math.max(1, Math.round(sw * cos + sh * sin))
  const outH = Math.max(1, Math.round(sw * sin + sh * cos))

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.translate(outW / 2, outH / 2)
  ctx.rotate(rad)
  ctx.scale(t.flipH ? -1 : 1, t.flipV ? -1 : 1)
  ctx.drawImage(image, -sw / 2, -sh / 2)
  return toPngDataUrl(canvas)
}

/** Upscale by a factor using high-quality bilinear interpolation (local, no model). */
export function upscaleImageLocal(image: HTMLImageElement, factor: number): string | null {
  const scale = Math.max(1, factor)
  const w = Math.round(image.naturalWidth * scale)
  const h = Math.round(image.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(image, 0, 0, w, h)
  return toPngDataUrl(canvas)
}
