// 手绘颜料层：dataURL -> 离屏 canvas -> UV 黑度采样
import { db } from './db'

const canvasCache = new Map<string, HTMLCanvasElement>()

async function loadCanvas(blobId: string): Promise<HTMLCanvasElement | null> {
  const cached = canvasCache.get(blobId)
  if (cached) return cached
  const rec = await db.getBlob(blobId)
  if (!rec) return null
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('颜料图加载失败'))
    img.src = rec.dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0)
  canvasCache.set(blobId, canvas)
  return canvas
}

// 按 UV 采样颜料黑度（alpha 越大越不透光），双线性插值
export async function samplePaintDarkness(
  blobId: string | null,
  uv: [number, number]
): Promise<number> {
  if (!blobId) return 0
  const canvas = await loadCanvas(blobId)
  if (!canvas) return 0
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return 0
  const x = Math.min(canvas.width - 1, Math.max(0, uv[0] * (canvas.width - 1)))
  const y = Math.min(canvas.height - 1, Math.max(0, (1 - uv[1]) * (canvas.height - 1)))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const x1 = Math.min(x0 + 1, canvas.width - 1)
  const y1 = Math.min(y0 + 1, canvas.height - 1)
  const a = ctx.getImageData(x0, y0, 1, 1).data[3] / 255
  const b = ctx.getImageData(x1, y0, 1, 1).data[3] / 255
  const c = ctx.getImageData(x0, y1, 1, 1).data[3] / 255
  const d = ctx.getImageData(x1, y1, 1, 1).data[3] / 255
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
}

export function clearPaintCache(): void {
  canvasCache.clear()
}

// 一次性读取整张颜料图（批量采样用，避免逐点 getImageData）
export async function loadPaintGrid(blobId: string | null): Promise<Uint8ClampedArray | null> {
  if (!blobId) return null
  const canvas = await loadCanvas(blobId)
  if (!canvas) return null
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data
}

export function gridDarkness(
  grid: Uint8ClampedArray,
  width: number,
  height: number,
  uv: [number, number]
): number {
  const x = Math.min(width - 1, Math.max(0, Math.round(uv[0] * (width - 1))))
  const y = Math.min(height - 1, Math.max(0, Math.round((1 - uv[1]) * (height - 1))))
  return grid[(y * width + x) * 4 + 3] / 255
}

export async function paintGridSize(blobId: string): Promise<{ width: number; height: number } | null> {
  const canvas = await loadCanvas(blobId)
  return canvas ? { width: canvas.width, height: canvas.height } : null
}
