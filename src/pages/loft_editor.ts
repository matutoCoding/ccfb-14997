// 放样截面环编辑器：表格化编辑每个环，实时回写并触发骨架重建
import type { LoftDef, Segment } from '../core/types'
import { rebuildLofts } from '../core/skeleton_ops'
import { toast } from '../ui/feedback'

export function openLoftEditor(loft: LoftDef, segment: Segment, onChange: () => void): void {
  const mask = document.createElement('div')
  mask.className = 'modal-mask'
  const row = (r: LoftDef['rings'][number], i: number): string => `
    <tr data-ring="${i}">
      <td>#${i + 1}</td>
      <td><input data-f="center0" type="number" step="0.1" value="${r.center[0]}"></td>
      <td><input data-f="center1" type="number" step="0.1" value="${r.center[1]}"></td>
      <td><input data-f="center2" type="number" step="0.1" value="${r.center[2]}"></td>
      <td><input data-f="rx" type="number" step="0.05" min="0.02" value="${r.radiusX}"></td>
      <td><input data-f="ry" type="number" step="0.05" min="0.02" value="${r.radiusY}"></td>
      <td><input data-f="twist" type="number" step="0.1" value="${r.twist.toFixed(2)}"></td>
      <td><button class="small ghost" data-del-ring="${i}">删</button></td>
    </tr>`

  mask.innerHTML = `
    <div class="modal" style="width:760px;">
      <div class="row" style="justify-content:space-between;margin-bottom:16px;">
        <h3 style="margin:0;font-size:18px;">放样编辑：${loft.name}</h3>
        <button class="small ghost" data-close>关闭</button>
      </div>
      <label class="field" style="margin-bottom:12px;">放样名称
        <input id="loft-name" value="${loft.name}">
      </label>
      <div class="row wrap" style="gap:16px;margin-bottom:16px;">
        <label class="field">环向分段
          <input id="loft-radial" type="number" min="4" max="24" value="${loft.radialSegments}" style="width:96px;">
        </label>
        <label class="field">钢丝直径 mm
          <input id="loft-dia" type="number" step="0.5" min="1" value="${loft.rodDiameter}" style="width:96px;">
        </label>
        <label class="field" style="flex-direction:row;align-items:center;gap:8px;margin-top:18px;">
          <input type="checkbox" id="loft-long" ${loft.includeLongitudinal ? 'checked' : ''} style="width:auto;"> 纵向主筋
        </label>
        <label class="field" style="flex-direction:row;align-items:center;gap:8px;margin-top:18px;">
          <input type="checkbox" id="loft-diag" ${loft.includeDiagonal ? 'checked' : ''} style="width:auto;"> 斜向交叉筋
        </label>
      </div>
      <div style="overflow:auto;max-height:340px;border:1px solid var(--border);border-radius:10px;">
        <table class="table">
          <thead><tr><th>#</th><th>中心X</th><th>Y</th><th>Z</th><th>半径X</th><th>半径Y</th><th>扭转</th><th></th></tr></thead>
          <tbody id="ring-rows">${loft.rings.map(row).join('')}</tbody>
        </table>
      </div>
      <div class="row" style="margin-top:12px;gap:8px;">
        <button class="small" id="add-ring">追加截面环</button>
        <span class="muted">中心单位 m，扭转 rad；改完点“应用并重建”</span>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:20px;gap:8px;">
        <button data-close>取消</button>
        <button class="primary" data-apply>应用并重建</button>
      </div>
    </div>`
  document.body.appendChild(mask)

  const tbody = mask.querySelector<HTMLElement>('#ring-rows')!
  const rerenderRows = (): void => {
    tbody.innerHTML = loft.rings.map(row).join('')
  }
  tbody.addEventListener('input', (e) => {
    const tr = (e.target as HTMLElement).closest('tr') as HTMLElement
    const i = Number(tr.dataset.ring)
    const f = (e.target as HTMLInputElement).dataset.f
    const v = Number((e.target as HTMLInputElement).value)
    const ringDef = loft.rings[i]
    if (f === 'center0') ringDef.center[0] = v
    if (f === 'center1') ringDef.center[1] = v
    if (f === 'center2') ringDef.center[2] = v
    if (f === 'rx') ringDef.radiusX = Math.max(0.02, v)
    if (f === 'ry') ringDef.radiusY = Math.max(0.02, v)
    if (f === 'twist') ringDef.twist = v
  })
  tbody.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-del-ring]') as HTMLElement | null
    if (!btn) return
    if (loft.rings.length <= 2) return toast('至少保留两个截面环')
    loft.rings.splice(Number(btn.dataset.delRing), 1)
    rerenderRows()
  })
  mask.querySelector('#add-ring')!.addEventListener('click', () => {
    const last = loft.rings[loft.rings.length - 1]
    loft.rings.push({
      center: [last.center[0] + 1, last.center[1], last.center[2]],
      radiusX: last.radiusX,
      radiusY: last.radiusY,
      twist: last.twist
    })
    rerenderRows()
  })
  mask.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target === mask || target.closest('[data-close]')) mask.remove()
  })
  mask.querySelector('[data-apply]')!.addEventListener('click', () => {
    loft.name = mask.querySelector<HTMLInputElement>('#loft-name')!.value || loft.name
    loft.radialSegments = Math.max(4, Math.min(24, Number(mask.querySelector<HTMLInputElement>('#loft-radial')!.value)))
    loft.rodDiameter = Math.max(1, Number(mask.querySelector<HTMLInputElement>('#loft-dia')!.value))
    loft.includeLongitudinal = mask.querySelector<HTMLInputElement>('#loft-long')!.checked
    loft.includeDiagonal = mask.querySelector<HTMLInputElement>('#loft-diag')!.checked
    rebuildLofts(segment)
    onChange()
    mask.remove()
    toast('放样已重建')
  })
}
