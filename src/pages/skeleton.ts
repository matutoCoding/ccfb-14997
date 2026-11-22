// 骨架编辑页：分段管理 / 节点拖拽 / 杆件 / 截面放样 / 结构粗算 / 运输超限
import * as THREE from 'three'
import { store } from '../core/store'
import { Viewport } from '../render/viewport'
import { LanternScene } from '../render/lantern_scene'
import { addLoft, addNode, addRod, rebuildLofts, removeLoft } from '../core/skeleton_ops'
import { calcSegmentStats } from '../core/structural'
import { uid } from '../core/constants'
import type { Segment, Vec3 } from '../core/types'
import { cloneDoc, fmt, toast } from '../ui/feedback'
import { icon } from '../ui/icons'
import { openLoftEditor } from './loft_editor'

let viewport: Viewport | null = null
let lanternScene: LanternScene | null = null
let selectedSegId: string | null = null
let connectMode = false
let connectFirst: string | null = null
let dragState: { index: number; plane: THREE.Plane } | null = null

export function renderSkeleton(root: HTMLElement): void {
  const doc = store.currentLantern
  if (!doc) {
    renderEmpty(root)
    return
  }
  if (!selectedSegId || !doc.segments.some((s) => s.id === selectedSegId)) {
    selectedSegId = doc.segments[0]?.id ?? null
  }
  root.innerHTML = `
    <div class="workspace">
      <aside class="side-panel" id="skeleton-side"></aside>
      <div class="viewport" id="skeleton-viewport">
        <div class="viewport-toolbar">
          <button class="small" id="btn-fit">${icon('target', 14)} 适配视角</button>
          <button class="small" id="btn-connect">${icon('skeleton', 14)} 杆件连接</button>
          <button class="small" id="btn-add-node">${icon('plus', 14)} 加节点</button>
        </div>
        <div class="viewport-hint">左键旋转 · 右键平移 · 滚轮缩放 · 拖动橙色节点改骨架 · 杆件模式点两个节点连线</div>
      </div>
    </div>`

  lanternScene = new LanternScene()
  lanternScene.setMode('material')
  lanternScene.setVisibility({ showSkeleton: true, showNodes: true, showLights: false })
  viewport = new Viewport(root.querySelector('#skeleton-viewport')!)
  viewport.scene.add(lanternScene.group)
  lanternScene.rebuild(doc)
  viewport.fitObject(lanternScene.group)
  bindViewportEvents(root)

  root.querySelector('#btn-fit')!.addEventListener('click', () => viewport?.fitObject(lanternScene!.group))
  root.querySelector('#btn-connect')!.addEventListener('click', toggleConnect)
  root.querySelector('#btn-add-node')!.addEventListener('click', addNodeAtCenter)

  renderSide()
}

function renderEmpty(root: HTMLElement): void {
  root.innerHTML = `
    <div class="empty-state" style="margin-top:64px;">
      <div class="icon-line">${icon('lantern', 24)}</div>
      <h3 style="margin:0 0 8px;">未选择灯组</h3>
      <p style="margin:0;">先到灯组列表打开或新建一个灯组</p>
    </div>`
}

function currentSegment(): Segment | null {
  const doc = store.currentLantern
  if (!doc || !selectedSegId) return null
  return doc.segments.find((s) => s.id === selectedSegId) ?? null
}

function renderSide(): void {
  const doc = store.currentLantern
  const side = document.querySelector<HTMLElement>('#skeleton-side')
  if (!doc || !side) return
  const seg = currentSegment()
  const stats = seg ? calcSegmentStats(seg) : null
  side.innerHTML = `
    <div class="row" style="justify-content:space-between;margin-bottom:16px;">
      <strong style="font-size:16px;">${doc.name}</strong>
      <button class="small primary" id="btn-save">${icon('save', 14)} 保存</button>
    </div>

    <div class="section-title" style="margin-top:0;">分段（${doc.segments.length}）</div>
    <div id="seg-list">
      ${doc.segments
        .map(
          (s) => `
        <div class="list-item ${s.id === selectedSegId ? 'selected' : ''}" data-seg="${s.id}" style="padding:12px;">
          <div class="row" style="justify-content:space-between;">
            <strong style="font-size:15px;">${s.name}</strong>
            <button class="small ghost" data-del-seg="${s.id}">${icon('trash', 13)}</button>
          </div>
          <p class="muted" style="margin:6px 0 0;">${s.nodes.length} 节点 / ${s.rods.length} 杆件 / ${s.lofts.length} 放样</p>
        </div>`
        )
        .join('')}
    </div>
    <button class="small" id="btn-add-seg" style="margin-top:8px;width:100%;">${icon('plus', 14)} 新增分段</button>

    ${
      seg && stats
        ? `
    <div class="section-title">结构粗算</div>
    <div class="stat-grid" style="grid-template-columns:1fr 1fr;">
      <div class="stat" style="padding:12px;"><div class="label">钢丝总长</div><div class="value" style="font-size:18px;">${fmt(stats.wireLengthM)} m</div></div>
      <div class="stat" style="padding:12px;"><div class="label">自重</div><div class="value" style="font-size:18px;">${fmt(stats.weightKg)} kg</div></div>
      <div class="stat" style="padding:12px;"><div class="label">最大挠度</div><div class="value" style="font-size:18px;">${fmt(stats.maxDeflectionMm)} mm</div></div>
      <div class="stat" style="padding:12px;"><div class="label">焊点数</div><div class="value" style="font-size:18px;">${stats.rodCount}</div></div>
    </div>
    <div style="margin-top:12px;">
      <div class="muted" style="margin-bottom:6px;">包围盒尺寸（运输限制 ${seg.transportLimit.map((v) => fmt(v, 1)).join(' × ')} m）</div>
      <div class="row wrap">
        <span class="badge ${stats.overTransport ? 'danger' : 'success'}">
          ${stats.bbox.size.map((v) => fmt(v, 2)).join(' × ')} m ${stats.overTransport ? '· 超限需拆段' : '· 可运输'}
        </span>
      </div>
      <label class="field" style="margin-top:12px;">运输限制 长/宽/高 m
        <input id="transport-limit" value="${seg.transportLimit.join(',')}">
      </label>
    </div>

    <div class="section-title">截面放样（${seg.lofts.length}）</div>
    <div id="loft-list">
      ${seg.lofts
        .map(
          (l, i) => `
        <div class="list-item" style="padding:12px;">
          <div class="row" style="justify-content:space-between;">
            <strong style="font-size:14px;">${l.name}</strong>
            <div class="row">
              <button class="small" data-edit-loft="${i}">编辑环</button>
              <button class="small ghost" data-del-loft="${i}">${icon('trash', 13)}</button>
            </div>
          </div>
          <p class="muted" style="margin:6px 0 0;">${l.rings.length} 环 · ${l.radialSegments} 向分段 · ${l.rodDiameter}mm 钢丝</p>
        </div>`
        )
        .join('')}
    </div>
    <div class="row" style="margin-top:8px;gap:8px;">
      <button class="small" id="btn-add-loft" style="flex:1;">${icon('plus', 14)} 管状放样</button>
    </div>

    <div class="section-title">手工节点/杆件</div>
    <p class="muted" style="font-size:13px;">节点 ${seg.nodes.filter((n) => n.id.startsWith('n_')).length} 个（放样节点不计），杆件直径
      <input id="rod-dia" type="number" value="4" style="width:72px;display:inline-block;margin:0 6px;"> mm
    </p>`
        : ''
    }
  `
  bindSideEvents()
}

function bindSideEvents(): void {
  const side = document.querySelector<HTMLElement>('#skeleton-side')!
  side.querySelectorAll<HTMLElement>('[data-seg]').forEach((el) =>
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return
      selectedSegId = el.dataset.seg!
      connectMode = false
      renderSide()
    })
  )
  side.querySelector('#btn-save')?.addEventListener('click', persist)
  side.querySelector('#btn-add-seg')?.addEventListener('click', () => {
    const doc = store.currentLantern!
    doc.segments.push({
      id: uid('seg'),
      name: `第 ${doc.segments.length + 1} 段`,
      nodes: [],
      rods: [],
      lofts: [],
      transportLimit: [9.6, 2.5, 3.0]
    })
    selectedSegId = doc.segments[doc.segments.length - 1].id
    refresh()
  })
  side.querySelectorAll<HTMLElement>('[data-del-seg]').forEach((el) =>
    el.addEventListener('click', async () => {
      const doc = store.currentLantern!
      if (doc.segments.length <= 1) return toast('至少保留一个分段')
      doc.segments = doc.segments.filter((s) => s.id !== el.dataset.delSeg)
      selectedSegId = doc.segments[0].id
      refresh()
    })
  )
  side.querySelector('#transport-limit')?.addEventListener('change', (e) => {
    const seg = currentSegment()
    if (!seg) return
    const vals = (e.target as HTMLInputElement).value.split(',').map((v) => Number(v.trim()))
    if (vals.length === 3 && vals.every((v) => v > 0)) {
      seg.transportLimit = vals as Vec3
      renderSide()
    }
  })
  side.querySelector('#btn-add-loft')?.addEventListener('click', () => {
    const seg = currentSegment()!
    addLoft(seg, {
      name: `放样 ${seg.lofts.length + 1}`,
      rings: [
        { center: [0, 1, 0], radiusX: 0.5, radiusY: 0.5, twist: 0 },
        { center: [1.5, 1, 0], radiusX: 0.45, radiusY: 0.45, twist: 0.3 },
        { center: [3, 1, 0], radiusX: 0.3, radiusY: 0.3, twist: 0.6 }
      ],
      radialSegments: 8,
      rodDiameter: 4,
      includeLongitudinal: true,
      includeDiagonal: false
    })
    refresh()
  })
  side.querySelectorAll<HTMLElement>('[data-edit-loft]').forEach((el) =>
    el.addEventListener('click', () => {
      const seg = currentSegment()!
      const loft = seg.lofts[Number(el.dataset.editLoft)]
      openLoftEditor(loft, seg, () => {
        refresh()
      })
    })
  )
  side.querySelectorAll<HTMLElement>('[data-del-loft]').forEach((el) =>
    el.addEventListener('click', () => {
      const seg = currentSegment()!
      removeLoft(seg, seg.lofts[Number(el.dataset.delLoft)].id)
      refresh()
    })
  )
}

function toggleConnect(): void {
  connectMode = !connectMode
  connectFirst = null
  const btn = document.querySelector<HTMLButtonElement>('#btn-connect')!
  btn.classList.toggle('primary', connectMode)
  toast(connectMode ? '连接模式：依次点两个节点' : '已退出连接模式')
}

function addNodeAtCenter(): void {
  const seg = currentSegment()
  if (!seg) return
  const node = addNode(seg, [0, 1, 0])
  refresh()
  toast(`已加节点 ${node.id.slice(-4)}，可在视口中拖动`)
}

function bindViewportEvents(root: HTMLElement): void {
  const canvas = root.querySelector('#skeleton-viewport canvas') as HTMLElement
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerUp)
}

function onPointerDown(e: PointerEvent): void {
  if (e.button !== 0 || !viewport || !lanternScene) return
  const ndc = viewport.toNDC(e)
  const hit = lanternScene.pickNode(ndc, viewport.camera)
  if (!hit) return
  if (connectMode) {
    handleConnect(hit.id)
    return
  }
  const pos = lanternScene.getNodeWorldPosition(hit.index)
  if (!pos) return
  const normal = viewport.camera.getWorldDirection(new THREE.Vector3()).negate()
  dragState = { index: hit.index, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, pos) }
}

function handleConnect(nodeId: string): void {
  const seg = currentSegment()
  if (!seg) return
  if (!connectFirst) {
    connectFirst = nodeId
    toast('已选第一个节点，再点一个')
    return
  }
  if (connectFirst === nodeId) {
    connectFirst = null
    return
  }
  const dia = Number(document.querySelector<HTMLInputElement>('#rod-dia')?.value ?? 4)
  addRod(seg, connectFirst, nodeId, dia)
  connectFirst = null
  refresh()
  toast('杆件已连接')
}

function onPointerMove(e: PointerEvent): void {
  if (!dragState || !viewport || !lanternScene) return
  const ndc = viewport.toNDC(e)
  lanternScene.dragNode(dragState.index, dragState.plane, ndc, viewport.camera)
}

function onPointerUp(): void {
  if (dragState) {
    syncNodePositionsBack()
    dragState = null
  }
}

// 拖拽后的 Three 坐标写回文档节点
function syncNodePositionsBack(): void {
  const seg = currentSegment()
  if (!seg || !lanternScene) return
  const snapshot = lanternScene.snapshotNodePositions()
  const byId = new Map(seg.nodes.map((n) => [n.id, n]))
  for (const item of snapshot) {
    const node = byId.get(item.id)
    if (node) node.pos = item.pos
  }
  // 节点移动后放样布面需重建
  rebuildLofts(seg)
}

function persist(): void {
  const doc = store.currentLantern
  if (!doc) return
  syncNodePositionsBack()
  store.saveLantern(cloneDoc(doc)).then(() => toast('骨架已保存到 IndexedDB'))
}

function refresh(): void {
  const doc = store.currentLantern
  if (!doc || !lanternScene) return
  lanternScene.rebuild(doc)
  renderSide()
}

export function disposeSkeleton(): void {
  viewport?.dispose()
  viewport = null
  lanternScene = null
  dragState = null
  connectMode = false
  connectFirst = null
}
