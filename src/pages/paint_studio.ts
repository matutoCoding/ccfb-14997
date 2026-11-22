// 手绘工作室：UV 画布，画笔/橡皮/粗细/颜色，导出 dataURL（alpha 驱动透光折减）
import type { FabricPatch } from '../core/types'
import { db } from '../core/db'
import { toast } from '../ui/feedback'

const W = 1024
const H = 1024

export function openPaintStudio(patch: FabricPatch, onSave: (dataUrl: string) => void): void {
  const mask = document.createElement('div')
  mask.className = 'modal-mask'
  mask.innerHTML = `
    <div class="modal" style="width:640px;">
      <div class="row" style="justify-content:space-between;margin-bottom:12px;">
        <h3 style="margin:0;font-size:18px;">手绘图案：${patch.name}</h3>
        <button class="small ghost" data-close>关闭</button>
      </div>
      <div class="row wrap" style="gap:12px;margin-bottom:12px;">
        <label class="field" style="flex-direction:row;align-items:center;gap:6px;">颜色
          <input type="color" id="paint-color" value="#1a1a1a" style="width:48px;height:34px;padding:2px;">
        </label>
        <label class="field">笔刷 <span id="brush-v">28</span> px
          <input type="range" id="brush-size" min="4" max="120" value="28" style="width:140px;">
        </label>
        <button class="small" id="brush-mode">画笔</button>
        <button class="small" id="btn-clear-canvas">清空</button>
      </div>
      <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;background:#f8fafc;">
        <canvas id="paint-canvas" width="${W}" height="${H}" style="width:100%;display:block;aspect-ratio:1;cursor:crosshair;touch-action:none;"></canvas>
      </div>
      <p class="muted" style="margin:8px 0 0;">颜料覆盖处按黑度折减透射率，画笔越深遮光越强；橡皮可恢复透光</p>
      <div class="row" style="justify-content:flex-end;margin-top:16px;gap:8px;">
        <button data-close>取消</button>
        <button class="primary" data-save>保存图案</button>
      </div>
    </div>`
  document.body.appendChild(mask)

  const canvas = mask.querySelector<HTMLCanvasElement>('#paint-canvas')!
  const ctx = canvas.getContext('2d')!
  let eraser = false
  let drawing = false
  let last = { x: 0, y: 0 }

  // 载入已有图案
  if (patch.paintBlobId) {
    db.getBlob(patch.paintBlobId).then((rec) => {
      if (!rec) return
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, W, H)
      img.src = rec.dataUrl
    })
  }

  const pos = (e: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H
    }
  }
  const sizeInput = mask.querySelector<HTMLInputElement>('#brush-size')!
  sizeInput.addEventListener('input', () => (mask.querySelector('#brush-v')!.textContent = sizeInput.value))
  mask.querySelector('#brush-mode')!.addEventListener('click', (e) => {
    eraser = !eraser
    ;(e.target as HTMLButtonElement).textContent = eraser ? '橡皮' : '画笔'
    ;(e.target as HTMLButtonElement).classList.toggle('primary', eraser)
  })
  mask.querySelector('#btn-clear-canvas')!.addEventListener('click', () => {
    ctx.clearRect(0, 0, W, H)
  })
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true
    last = pos(e)
    canvas.setPointerCapture(e.pointerId)
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return
    const p = pos(e)
    const size = Number(sizeInput.value)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = size
    if (eraser) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.strokeStyle = 'rgba(0,0,0,1)'
    } else {
      ctx.globalCompositeOperation = 'source-over'
      ctx.strokeStyle = mask.querySelector<HTMLInputElement>('#paint-color')!.value
      ctx.globalAlpha = 0.92
    }
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ctx.globalAlpha = 1
    last = p
  })
  canvas.addEventListener('pointerup', () => (drawing = false))

  mask.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target === mask || target.closest('[data-close]')) mask.remove()
    if (target.closest('[data-save]')) {
      onSave(canvas.toDataURL('image/png'))
      mask.remove()
      toast('图案已写入布面 UV')
    }
  })
}
