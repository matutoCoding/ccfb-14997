// 灯光布置页：点光源/灯带增删、功率色温、实时数量与总功率统计
import { store } from '../core/store'
import { Viewport } from '../render/viewport'
import { LanternScene } from '../render/lantern_scene'
import { lightStats } from '../core/optics'
import { uid } from '../core/constants'
import type { LightItem, LanternDoc, Vec3 } from '../core/types'
import { cloneDoc, fmt, toast } from '../ui/feedback'
import { icon } from '../ui/icons'

let viewport: Viewport | null = null
let lanternScene: LanternScene | null = null
let selectedLightId: string | null = null
let stripPick: Vec3 | null = null

export function renderLights(root: HTMLElement): void {
  const doc = store.currentLantern
  if (!doc) {
    root.innerHTML = `<div class="empty-state" style="margin-top:64px;"><div class="icon-line">${icon('light', 24)}</div><h3 style="margin:0 0 8px;">未选择灯组</h3><p style="margin:0;">先到灯组列表打开灯组</p></div>`
    return
  }
  if (!selectedLightId || !doc.lights.some((l) => l.id === selectedLightId)) {
    selectedLightId = doc.lights[0]?.id ?? null
  }
  root.innerHTML = `
    <div class="workspace">
      <aside class="side-panel" id="light-side"></aside>
      <div class="viewport" id="light-viewport">
        <div class="viewport-toolbar">
          <button class="small" id="btn-fit">${icon('target', 14)} 适配视角</button>
          <button class="small" id="btn-add-point">${icon('plus', 14)} 放点光源</button>
          <button class="small" id="btn-add-strip">画灯带（两点）</button>
        </div>
        <div class="viewport-hint" id="light-hint">点光源按 W 计；灯带按 W/m 计，按步进自动展开灯珠参与透光计算</div>
      </div>
    </div>`

  lanternScene = new LanternScene()
  lanternScene.setMode('night')
  lanternScene.setVisibility({ showSkeleton: true, showNodes: false, showLights: true })
  viewport = new Viewport(root.querySelector('#light-viewport')!)
  viewport.scene.add(lanternScene.group)
  lanternScene.rebuild(doc)
  viewport.fitObject(lanternScene.group)

  root.querySelector('#btn-fit')!.addEventListener('click', () => viewport?.fitObject(lanternScene!.group))
  root.querySelector('#btn-add-point')!.addEventListener('click', addPoint)
  root.querySelector('#btn-add-strip')!.addEventListener('click', startStrip)
  bindPick()
  renderSide()
}

function bindPick(): void {
  const canvas = viewport!.renderer.domElement
  canvas.addEventListener('click', (e) => {
    if (!stripPick || !viewport || !lanternScene) return
    const ndc = viewport.toNDC(e)
    const hit = lanternScene.pickCloth(ndc, viewport.camera)
    if (!hit) return
    const point: Vec3 = [hit.point.x, hit.point.y, hit.point.z]
    if (!stripPick) return
    finishStrip(stripPick, point)
  })
}

function addPoint(): void {
  const doc = store.currentLantern!
  const center = centerOf(doc)
  const light: LightItem = {
    id: uid('light'),
    name: `点光源 ${doc.lights.filter((l) => l.kind === 'point').length + 1}`,
    kind: 'point',
    position: center,
    end: null,
    step: 0.2,
    powerW: 3,
    cct: 3000,
    luminousEfficacy: 90,
    on: true
  }
  doc.lights.push(light)
  selectedLightId = light.id
  refresh()
}

function startStrip(): void {
  stripPick = centerOf(store.currentLantern!)
  const hint = document.querySelector('#light-hint')!
  hint.textContent = '灯带模式：在布面/骨架上点选终点（起点默认灯组中心，可在参数里微调）'
  toast('点选布面确定灯带终点')
}

function finishStrip(a: Vec3, b: Vec3): void {
  const doc = store.currentLantern!
  const light: LightItem = {
    id: uid('light'),
    name: `灯带 ${doc.lights.filter((l) => l.kind === 'strip').length + 1}`,
    kind: 'strip',
    position: a,
    end: b,
    step: 0.17,
    powerW: 8,
    cct: 2700,
    luminousEfficacy: 95,
    on: true
  }
  doc.lights.push(light)
  selectedLightId = light.id
  stripPick = null
  document.querySelector('#light-hint')!.textContent = '点光源按 W 计；灯带按 W/m 计，按步进自动展开灯珠参与透光计算'
  refresh()
}

function centerOf(doc: LanternDoc): Vec3 {
  const all = doc.segments.flatMap((s) => s.nodes)
  if (!all.length) return [0, 1.2, 0]
  const c: Vec3 = [0, 0, 0]
  all.forEach((n) => {
    c[0] += n.pos[0] / all.length
    c[1] += n.pos[1] / all.length
    c[2] += n.pos[2] / all.length
  })
  return c
}

function renderSide(): void {
  const doc = store.currentLantern
  const side = document.querySelector<HTMLElement>('#light-side')
  if (!doc || !side) return
  const stats = lightStats(doc.lights)
  const selected = doc.lights.find((l) => l.id === selectedLightId) ?? null
  side.innerHTML = `
    <div class="row" style="justify-content:space-between;margin-bottom:16px;">
      <strong style="font-size:16px;">灯光布置</strong>
      <button class="small primary" id="btn-save">${icon('save', 14)} 保存</button>
    </div>

    <div class="stat-grid" style="grid-template-columns:1fr 1fr;">
      <div class="stat" style="padding:12px;"><div class="label">灯珠总数</div><div class="value" style="font-size:18px;">${stats.count}</div></div>
      <div class="stat" style="padding:12px;"><div class="label">灯带长度</div><div class="value" style="font-size:18px;">${fmt(stats.stripLengthM)} m</div></div>
      <div class="stat" style="padding:12px;"><div class="label">总功率</div><div class="value" style="font-size:18px;">${fmt(stats.totalPowerW)} W</div></div>
      <div class="stat" style="padding:12px;"><div class="label">总光通量</div><div class="value" style="font-size:18px;">${fmt(stats.totalLumen, 0)} lm</div></div>
    </div>

    <div class="section-title">灯具（${doc.lights.length}）</div>
    <div id="light-list">
      ${
        doc.lights.length
          ? doc.lights
              .map(
                (l) => `
          <div class="list-item ${l.id === selectedLightId ? 'selected' : ''}" style="padding:12px;" data-light="${l.id}">
            <div class="row" style="justify-content:space-between;">
              <strong style="font-size:14px;">${l.name}</strong>
              <div class="row">
                <span class="badge ${l.on ? 'success' : ''}">${l.on ? '开启' : '关闭'}</span>
                <button class="small ghost" data-del-light="${l.id}">${icon('trash', 13)}</button>
              </div>
            </div>
            <p class="muted" style="margin:6px 0 0;">
              ${l.kind === 'point' ? `${l.powerW}W 点光源` : `${l.powerW}W/m 灯带`} · ${l.cct}K
            </p>
          </div>`
              )
              .join('')
          : '<p class="muted">还没有灯具，用上方按钮添加</p>'
      }
    </div>

    ${
      selected
        ? `
    <div class="section-title">灯具参数</div>
    <label class="field" style="margin-bottom:12px;">名称<input id="l-name" value="${selected.name}"></label>
    <div class="row" style="gap:8px;margin-bottom:12px;">
      <label class="field" style="flex:1;">${selected.kind === 'point' ? '功率 W' : '功率 W/m'}
        <input type="number" step="0.5" id="l-power" value="${selected.powerW}">
      </label>
      <label class="field" style="flex:1;">色温 K
        <select id="l-cct">
          ${[2200, 2700, 3000, 3500, 4000, 5000, 6500].map((k) => `<option value="${k}" ${k === selected.cct ? 'selected' : ''}>${k}K</option>`).join('')}
        </select>
      </label>
    </div>
    <label class="field" style="margin-bottom:12px;">光效 lm/W
      <input type="number" step="1" id="l-eff" value="${selected.luminousEfficacy}">
    </label>
    ${
      selected.kind === 'strip'
        ? `<label class="field" style="margin-bottom:12px;">灯珠步进 m
        <input type="number" step="0.01" id="l-step" value="${selected.step}"></label>`
        : ''
    }
    <div class="row" style="gap:8px;margin-bottom:12px;">
      <label class="field" style="flex:1;">起点 X<input type="number" step="0.1" id="l-x" value="${selected.position[0].toFixed(2)}"></label>
      <label class="field" style="flex:1;">Y<input type="number" step="0.1" id="l-y" value="${selected.position[1].toFixed(2)}"></label>
      <label class="field" style="flex:1;">Z<input type="number" step="0.1" id="l-z" value="${selected.position[2].toFixed(2)}"></label>
    </div>
    ${
      selected.end
        ? `<div class="row" style="gap:8px;margin-bottom:12px;">
      <label class="field" style="flex:1;">终点 X<input type="number" step="0.1" id="l-ex" value="${selected.end[0].toFixed(2)}"></label>
      <label class="field" style="flex:1;">Y<input type="number" step="0.1" id="l-ey" value="${selected.end[1].toFixed(2)}"></label>
      <label class="field" style="flex:1;">Z<input type="number" step="0.1" id="l-ez" value="${selected.end[2].toFixed(2)}"></label>
    </div>`
        : ''
    }
    <div class="row" style="gap:8px;">
      <button class="small" id="l-toggle" style="flex:1;">${selected.on ? '关闭灯具' : '开启灯具'}</button>
    </div>`
        : ''
    }
  `
  bindSideEvents()
}

function bindSideEvents(): void {
  const side = document.querySelector<HTMLElement>('#light-side')!
  const doc = store.currentLantern!
  side.querySelector('#btn-save')?.addEventListener('click', persist)
  side.querySelectorAll<HTMLElement>('[data-light]').forEach((el) =>
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return
      selectedLightId = el.dataset.light!
      renderSide()
    })
  )
  side.querySelectorAll<HTMLElement>('[data-del-light]').forEach((el) =>
    el.addEventListener('click', () => {
      doc.lights = doc.lights.filter((l) => l.id !== el.dataset.delLight)
      if (selectedLightId === el.dataset.delLight) selectedLightId = doc.lights[0]?.id ?? null
      refresh()
    })
  )
  const selected = doc.lights.find((l) => l.id === selectedLightId)
  if (!selected) return
  const bind = (id: string, fn: (v: string) => void): void => {
    side.querySelector(id)?.addEventListener('input', (e) => fn((e.target as HTMLInputElement).value))
  }
  bind('#l-name', (v) => (selected.name = v))
  bind('#l-power', (v) => (selected.powerW = Math.max(0.1, Number(v))))
  bind('#l-eff', (v) => (selected.luminousEfficacy = Math.max(1, Number(v))))
  bind('#l-step', (v) => (selected.step = Math.max(0.05, Number(v))))
  side.querySelector('#l-cct')?.addEventListener('change', (e) => {
    selected.cct = Number((e.target as HTMLSelectElement).value)
    refresh()
  })
  bind('#l-x', (v) => (selected.position[0] = Number(v)))
  bind('#l-y', (v) => (selected.position[1] = Number(v)))
  bind('#l-z', (v) => (selected.position[2] = Number(v)))
  bind('#l-ex', (v) => selected.end && (selected.end[0] = Number(v)))
  bind('#l-ey', (v) => selected.end && (selected.end[1] = Number(v)))
  bind('#l-ez', (v) => selected.end && (selected.end[2] = Number(v)))
  // 坐标失焦后统一重建，避免每键一次重建场景
  side.querySelectorAll('input[type="number"]').forEach((el) =>
    el.addEventListener('change', () => refresh())
  )
  side.querySelector('#l-toggle')?.addEventListener('click', () => {
    selected.on = !selected.on
    refresh()
  })
}

function persist(): void {
  const doc = store.currentLantern
  if (!doc) return
  store.saveLantern(cloneDoc(doc)).then(() => toast('灯光布置已保存'))
}

function refresh(): void {
  const doc = store.currentLantern
  if (!doc || !lanternScene) return
  lanternScene.rebuild(doc)
  renderSide()
}

export function disposeLights(): void {
  viewport?.dispose()
  viewport = null
  lanternScene = null
  stripPick = null
}
