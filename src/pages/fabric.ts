// 蒙布页：材质库 / 布面贴附 / 下垂 / 手绘画布（颜料削弱透光）
import { store } from '../core/store'
import { Viewport } from '../render/viewport'
import { LanternScene } from '../render/lantern_scene'
import { db, dbPut } from '../core/db'
import { FABRIC_PRESETS, uid } from '../core/constants'
import type { FabricMaterial, FabricPatch, LanternDoc } from '../core/types'
import { cloneDoc, toast } from '../ui/feedback'
import { icon } from '../ui/icons'
import { openPaintStudio } from './paint_studio'

let viewport: Viewport | null = null
let lanternScene: LanternScene | null = null
let selectedPatchId: string | null = null

export function renderFabric(root: HTMLElement): void {
  const doc = store.currentLantern
  if (!doc) {
    root.innerHTML = `<div class="empty-state" style="margin-top:64px;"><div class="icon-line">${icon('fabric', 24)}</div><h3 style="margin:0 0 8px;">未选择灯组</h3><p style="margin:0;">先到灯组列表打开灯组</p></div>`
    return
  }
  if (!selectedPatchId || !doc.patches.some((p) => p.id === selectedPatchId)) {
    selectedPatchId = doc.patches[0]?.id ?? null
  }
  root.innerHTML = `
    <div class="workspace">
      <aside class="side-panel" id="fabric-side"></aside>
      <div class="viewport" id="fabric-viewport">
        <div class="viewport-toolbar">
          <button class="small" id="btn-fit">${icon('target', 14)} 适配视角</button>
          <button class="small" id="btn-material-mode">材质观感</button>
          <button class="small" id="btn-night-mode">透光灯效</button>
        </div>
        <div class="viewport-hint">布面按放样或四角节点贴附，下垂沿重力方向；颜料区域透光率下降</div>
      </div>
    </div>`

  lanternScene = new LanternScene()
  lanternScene.setMode('material')
  lanternScene.setVisibility({ showSkeleton: true, showNodes: false, showLights: true })
  viewport = new Viewport(root.querySelector('#fabric-viewport')!)
  viewport.scene.add(lanternScene.group)
  lanternScene.rebuild(doc)
  loadPaintTextures(doc)
  viewport.fitObject(lanternScene.group)

  root.querySelector('#btn-fit')!.addEventListener('click', () => viewport?.fitObject(lanternScene!.group))
  root.querySelector('#btn-material-mode')!.addEventListener('click', () => lanternScene?.setMode('material'))
  root.querySelector('#btn-night-mode')!.addEventListener('click', () => lanternScene?.setMode('night'))

  renderSide()
}

async function loadPaintTextures(doc: LanternDoc): Promise<void> {
  for (const patch of doc.patches) {
    if (!patch.paintBlobId) continue
    const rec = await db.getBlob(patch.paintBlobId)
    if (rec) lanternScene?.setPaintDataUrl(patch.id, rec.dataUrl)
  }
}

function renderSide(): void {
  const doc = store.currentLantern
  const side = document.querySelector<HTMLElement>('#fabric-side')
  if (!doc || !side) return
  const patch = doc.patches.find((p) => p.id === selectedPatchId) ?? null
  side.innerHTML = `
    <div class="row" style="justify-content:space-between;margin-bottom:16px;">
      <strong style="font-size:16px;">蒙布与材质</strong>
      <button class="small primary" id="btn-save">${icon('save', 14)} 保存</button>
    </div>

    <div class="section-title" style="margin-top:0;">绸布材质库（${doc.materials.length}）</div>
    <div id="mat-list">
      ${doc.materials
        .map(
          (m) => `
        <div class="list-item" style="padding:12px;" data-mat="${m.id}">
          <div class="row" style="gap:10px;">
            <span style="width:28px;height:28px;border-radius:6px;background:${m.color};border:1px solid var(--border);flex-shrink:0;"></span>
            <div style="flex:1;">
              <strong style="font-size:14px;">${m.name}</strong>
              <p class="muted" style="margin:2px 0 0;">厚 ${m.thicknessMm}mm · 透射 ${(m.transmittance * 100).toFixed(0)}% · 散射 ${(m.scatter * 100).toFixed(0)}%</p>
            </div>
            <button class="small ghost" data-edit-mat="${m.id}">调</button>
          </div>
        </div>`
        )
        .join('')}
    </div>
    <button class="small" id="btn-add-mat" style="width:100%;margin-top:8px;">${icon('plus', 14)} 从预设添加材质</button>

    <div class="section-title">布面（${doc.patches.length}）</div>
    <div id="patch-list">
      ${
        doc.patches.length
          ? doc.patches
              .map(
                (p) => `
          <div class="list-item ${p.id === selectedPatchId ? 'selected' : ''}" style="padding:12px;" data-patch="${p.id}">
            <div class="row" style="justify-content:space-between;">
              <strong style="font-size:14px;">${p.name}</strong>
              <button class="small ghost" data-del-patch="${p.id}">${icon('trash', 13)}</button>
            </div>
            <p class="muted" style="margin:6px 0 0;">
              ${p.source.kind === 'loft' ? '放样贴附' : '四角贴附'} · 下垂 ${p.sag.toFixed(2)}m · ${p.paintBlobId ? '含手绘' : '无手绘'}
            </p>
          </div>`
              )
              .join('')
          : '<p class="muted">还没有布面，点击下方按钮按放样生成</p>'
      }
    </div>
    <div class="row" style="margin-top:8px;gap:8px;">
      <button class="small" id="btn-add-patch-loft" style="flex:1;">放样生成布面</button>
    </div>

    ${
      patch
        ? `
    <div class="section-title">布面参数：${patch.name}</div>
    <label class="field" style="margin-bottom:12px;">绸布材质
      <select id="patch-mat">
        ${doc.materials.map((m) => `<option value="${m.id}" ${m.id === patch.materialId ? 'selected' : ''}>${m.name}（τ ${(m.transmittance * 100).toFixed(0)}%）</option>`).join('')}
      </select>
    </label>
    <label class="field" style="margin-bottom:12px;">杆间下垂量 <span id="sag-val">${patch.sag.toFixed(3)}</span> m
      <input type="range" id="patch-sag" min="0" max="0.25" step="0.005" value="${patch.sag}">
    </label>
    <label class="field" style="margin-bottom:12px;">颜料透光削弱强度 <span id="paint-op-val">${(patch.paintOpacity * 100).toFixed(0)}%</span>
      <input type="range" id="paint-op" min="0" max="1" step="0.05" value="${patch.paintOpacity}">
    </label>
    <div class="row" style="gap:8px;">
      <button class="small" id="btn-paint" style="flex:1;">${icon('fabric', 14)} 手绘图案</button>
      ${patch.paintBlobId ? '<button class="small danger" id="btn-clear-paint">清除图案</button>' : ''}
    </div>`
        : ''
    }
  `
  bindEvents()
}

function bindEvents(): void {
  const side = document.querySelector<HTMLElement>('#fabric-side')!
  const doc = store.currentLantern!
  side.querySelector('#btn-save')?.addEventListener('click', () => persist())
  side.querySelector('#btn-add-mat')?.addEventListener('click', () => addMaterial())
  side.querySelectorAll<HTMLElement>('[data-edit-mat]').forEach((el) =>
    el.addEventListener('click', () => editMaterial(doc.materials.find((m) => m.id === el.dataset.editMat)!))
  )
  side.querySelectorAll<HTMLElement>('[data-patch]').forEach((el) =>
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return
      selectedPatchId = el.dataset.patch!
      renderSide()
    })
  )
  side.querySelectorAll<HTMLElement>('[data-del-patch]').forEach((el) =>
    el.addEventListener('click', () => {
      doc.patches = doc.patches.filter((p) => p.id !== el.dataset.delPatch)
      if (selectedPatchId === el.dataset.delPatch) selectedPatchId = doc.patches[0]?.id ?? null
      refresh()
    })
  )
  side.querySelector('#btn-add-patch-loft')?.addEventListener('click', () => addLoftPatch())
  side.querySelector('#patch-mat')?.addEventListener('change', (e) => {
    const patch = doc.patches.find((p) => p.id === selectedPatchId)
    if (!patch) return
    patch.materialId = (e.target as HTMLSelectElement).value
    refresh()
  })
  side.querySelector('#patch-sag')?.addEventListener('input', (e) => {
    const patch = doc.patches.find((p) => p.id === selectedPatchId)
    if (!patch) return
    patch.sag = Number((e.target as HTMLInputElement).value)
    side.querySelector('#sag-val')!.textContent = patch.sag.toFixed(3)
  })
  side.querySelector('#patch-sag')?.addEventListener('change', () => refresh())
  side.querySelector('#paint-op')?.addEventListener('input', (e) => {
    const patch = doc.patches.find((p) => p.id === selectedPatchId)
    if (!patch) return
    patch.paintOpacity = Number((e.target as HTMLInputElement).value)
    side.querySelector('#paint-op-val')!.textContent = `${(patch.paintOpacity * 100).toFixed(0)}%`
    lanternScene?.setPaintOpacity(patch.id, patch.paintOpacity)
  })
  side.querySelector('#btn-paint')?.addEventListener('click', () => {
    const patch = doc.patches.find((p) => p.id === selectedPatchId)
    if (!patch) return
    openPaintStudio(patch, async (dataUrl) => {
      const blobId = patch.paintBlobId ?? uid('blob')
      await dbPut('blobs', { id: blobId, dataUrl })
      patch.paintBlobId = blobId
      lanternScene?.setPaintDataUrl(patch.id, dataUrl)
      renderSide()
      toast('手绘图案已保存，颜料区透光自动削弱')
    })
  })
  side.querySelector('#btn-clear-paint')?.addEventListener('click', async () => {
    const patch = doc.patches.find((p) => p.id === selectedPatchId)
    if (!patch || !patch.paintBlobId) return
    await db.deleteBlob(patch.paintBlobId)
    patch.paintBlobId = null
    refresh()
  })
}

function addMaterial(): void {
  const doc = store.currentLantern!
  const preset = FABRIC_PRESETS[doc.materials.length % FABRIC_PRESETS.length]
  const mat: FabricMaterial = {
    id: uid('mat'),
    name: `${preset.name} ${doc.materials.length + 1}`,
    color: preset.color,
    thicknessMm: preset.thicknessMm,
    transmittance: preset.transmittance,
    scatter: preset.scatter
  }
  doc.materials.push(mat)
  renderSide()
}

function editMaterial(m: FabricMaterial): void {
  const mask = document.createElement('div')
  mask.className = 'modal-mask'
  mask.innerHTML = `
    <div class="modal">
      <h3 style="margin:0 0 16px;font-size:18px;">材质：${m.name}</h3>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <label class="field">名称<input id="m-name" value="${m.name}"></label>
        <label class="field">颜色<input type="color" id="m-color" value="${m.color}" style="height:40px;padding:4px;"></label>
        <label class="field">厚度 mm<input type="number" step="0.01" id="m-thick" value="${m.thicknessMm}"></label>
        <label class="field">透射率 τ <span id="tau-v">${(m.transmittance * 100).toFixed(0)}%</span>
          <input type="range" id="m-tau" min="0.01" max="0.8" step="0.01" value="${m.transmittance}"></label>
        <label class="field">朗伯散射占比 <span id="sc-v">${(m.scatter * 100).toFixed(0)}%</span>
          <input type="range" id="m-sc" min="0.3" max="1" step="0.01" value="${m.scatter}"></label>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:20px;gap:8px;">
        <button data-cancel>取消</button>
        <button class="primary" data-ok>应用</button>
      </div>
    </div>`
  document.body.appendChild(mask)
  mask.querySelector('#m-tau')!.addEventListener('input', (e) => {
    mask.querySelector('#tau-v')!.textContent = `${(Number((e.target as HTMLInputElement).value) * 100).toFixed(0)}%`
  })
  mask.querySelector('#m-sc')!.addEventListener('input', (e) => {
    mask.querySelector('#sc-v')!.textContent = `${(Number((e.target as HTMLInputElement).value) * 100).toFixed(0)}%`
  })
  mask.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target === mask || target.closest('[data-cancel]')) return mask.remove()
    if (!target.closest('[data-ok]')) return
    m.name = mask.querySelector<HTMLInputElement>('#m-name')!.value
    m.color = mask.querySelector<HTMLInputElement>('#m-color')!.value
    m.thicknessMm = Number(mask.querySelector<HTMLInputElement>('#m-thick')!.value)
    m.transmittance = Number(mask.querySelector<HTMLInputElement>('#m-tau')!.value)
    m.scatter = Number(mask.querySelector<HTMLInputElement>('#m-sc')!.value)
    mask.remove()
    refresh()
  })
}

function addLoftPatch(): void {
  const doc = store.currentLantern!
  const loftIds = new Set(doc.segments.flatMap((s) => s.lofts.map((l) => l.id)))
  const used = new Set(doc.patches.filter((p) => p.source.kind === 'loft').map((p) => (p.source as { loftId: string }).loftId))
  const available = [...loftIds].filter((id) => !used.has(id))
  if (!available.length) {
    toast('所有放样都已贴布，可在骨架页新增放样')
    return
  }
  const materialId = doc.materials[0]?.id
  if (!materialId) {
    toast('请先添加绸布材质')
    return
  }
  available.forEach((loftId) => {
    const patch: FabricPatch = {
      id: uid('patch'),
      name: `布面 ${doc.patches.length + 1}`,
      source: { kind: 'loft', loftId, lengthSegments: 14, radialSegments: 16 },
      materialId,
      sag: 0.04,
      paintBlobId: null,
      paintOpacity: 0.8
    }
    doc.patches.push(patch)
  })
  selectedPatchId = doc.patches[doc.patches.length - 1].id
  refresh()
  toast(`已生成 ${available.length} 块布面`)
}

function persist(): void {
  const doc = store.currentLantern
  if (!doc) return
  store.saveLantern(cloneDoc(doc)).then(() => toast('蒙布数据已保存'))
}

function refresh(): void {
  const doc = store.currentLantern
  if (!doc || !lanternScene) return
  lanternScene.rebuild(doc)
  loadPaintTextures(doc)
  renderSide()
}

export function disposeFabric(): void {
  viewport?.dispose()
  viewport = null
  lanternScene = null
}
