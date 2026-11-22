// 夜景预览页：场地+水面倒影+巡场 / 热力图 / 手算对账探针 / 灯位自动建议
import * as THREE from 'three'
import { store } from '../core/store'
import { Viewport } from '../render/viewport'
import { LanternScene } from '../render/lantern_scene'
import { NightVenue } from '../render/night_venue'
import { db } from '../core/db'
import { evaluateLantern, suggestLights, type EvaluationReport } from '../core/evaluation'
import { expandBeads, photometricProbe } from '../core/optics'
import type { ClothViewMode } from '../render/cloth_shader'
import { fmt, toast } from '../ui/feedback'
import { icon } from '../ui/icons'
import type { FabricMaterial, LanternDoc, Vec3 } from '../core/types'

let viewport: Viewport | null = null
let lanternScene: LanternScene | null = null
let venue: NightVenue | null = null
let report: EvaluationReport | null = null
let evalBusy = false

export function renderPreview(root: HTMLElement): void {
  const doc = store.currentLantern
  if (!doc) {
    root.innerHTML = `<div class="empty-state" style="margin-top:64px;"><div class="icon-line">${icon('preview', 24)}</div><h3 style="margin:0 0 8px;">未选择灯组</h3><p style="margin:0;">先到灯组列表打开灯组</p></div>`
    return
  }
  root.innerHTML = `
    <div class="workspace">
      <aside class="side-panel" id="preview-side"></aside>
      <div class="viewport" id="preview-viewport">
        <div class="viewport-toolbar">
          <button class="small" id="btn-fit">${icon('target', 14)} 适配视角</button>
          <button class="small primary" id="btn-mode-night">夜景</button>
          <button class="small" id="btn-mode-heat">热力图</button>
          <button class="small" id="btn-mode-mat">材质</button>
          <button class="small" id="btn-walk">第一人称巡场</button>
          <button class="small" id="btn-probe">照度探针</button>
        </div>
        <div class="viewport-hint" id="preview-hint">夜景含水面倒影；巡场模式 WASD 移动、鼠标转头、Shift 加速、Esc 退出</div>
      </div>
    </div>`

  lanternScene = new LanternScene()
  lanternScene.setMode('night')
  lanternScene.setVisibility({ showSkeleton: false, showNodes: false, showLights: false })
  viewport = new Viewport(root.querySelector('#preview-viewport')!)
  viewport.scene.background = new THREE.Color(0x05080f)
  viewport.scene.fog = new THREE.FogExp2(0x05080f, 0.018)
  viewport.scene.add(lanternScene.group)

  venue = new NightVenue(50)
  viewport.scene.add(venue.group)
  lanternScene.rebuild(doc)
  loadPaints(doc)
  viewport.fitObject(lanternScene.group)

  // 水面倒影每帧渲染
  viewport.addUpdater((_dt, t) => {
    if (!viewport || !venue) return
    venue.setTime(t)
    venue.renderReflection(viewport.renderer, viewport.camera, viewport.scene)
  })

  root.querySelector('#btn-fit')!.addEventListener('click', () => viewport?.fitObject(lanternScene!.group))
  root.querySelector('#btn-mode-night')!.addEventListener('click', () => setMode('night'))
  root.querySelector('#btn-mode-heat')!.addEventListener('click', () => setMode('heat'))
  root.querySelector('#btn-mode-mat')!.addEventListener('click', () => setMode('material'))
  root.querySelector('#btn-walk')!.addEventListener('click', toggleWalk)
  root.querySelector('#btn-probe')!.addEventListener('click', toggleProbe)

  renderSide()
  runEvaluation()
}

async function loadPaints(doc: LanternDoc): Promise<void> {
  for (const patch of doc.patches) {
    if (!patch.paintBlobId) continue
    const rec = await db.getBlob(patch.paintBlobId)
    if (rec) lanternScene?.setPaintDataUrl(patch.id, rec.dataUrl)
  }
}

function setMode(mode: ClothViewMode): void {
  lanternScene?.setMode(mode)
  ;['night', 'heat', 'mat'].forEach((m) => {
    const btn = document.querySelector<HTMLElement>(`#btn-mode-${m}`)!
    btn.classList.toggle('primary', (m === 'mat' ? 'material' : m) === mode)
  })
}

function toggleWalk(): void {
  if (!viewport) return
  const on = !viewport.controls.walkMode
  viewport.controls.setWalk(on)
  document.querySelector('#btn-walk')!.classList.toggle('primary', on)
  document.querySelector('#preview-hint')!.textContent = on
    ? '巡场中：WASD 移动，鼠标转头，Shift 加速，再点按钮或 Esc 退出'
    : '夜景含水面倒影；巡场模式 WASD 移动、鼠标转头、Shift 加速、Esc 退出'
  if (!on) viewport.fitObject(lanternScene!.group)
}

let probeMode = false
function toggleProbe(): void {
  probeMode = !probeMode
  document.querySelector('#btn-probe')!.classList.toggle('primary', probeMode)
  toast(probeMode ? '探针模式：点击布面查看逐项照度' : '已退出探针')
  if (probeMode) {
    viewport?.renderer.domElement.addEventListener('click', onProbeClick)
  } else {
    viewport?.renderer.domElement.removeEventListener('click', onProbeClick)
  }
}

function onProbeClick(e: MouseEvent): void {
  const doc = store.currentLantern
  if (!doc || !viewport || !lanternScene || !report) return
  const ndc = viewport.toNDC(e)
  const hit = lanternScene.pickCloth(ndc, viewport.camera)
  if (!hit) return
  const patchId = (hit.object.userData.patchId as string) ?? ''
  const patch = doc.patches.find((p) => p.id === patchId)
  const material: FabricMaterial | undefined = doc.materials.find((m) => m.id === patch?.materialId)
  if (!patch || !material) return
  const pe = report.patches.find((p) => p.patchId === patchId)
  // 从该布面评估采样里找距点击点最近的一条，取其颜料折减后的实际透射率反推黑度
  let paint = 0
  if (pe) {
    let nearest = pe.samples[0]
    let bestD = Infinity
    for (const s of pe.samples) {
      const d = (s.pos[0] - hit.point.x) ** 2 + (s.pos[1] - hit.point.y) ** 2 + (s.pos[2] - hit.point.z) ** 2
      if (d < bestD) {
        bestD = d
        nearest = s
      }
    }
    paint = 1 - nearest.transmittance / Math.max(0.001, material.transmittance)
  }
  const beads = expandBeads(doc.lights)
  const normal: Vec3 = hit.face
    ? (hit.face.normal.clone().transformDirection(hit.object.matrixWorld).toArray() as Vec3)
    : [0, 1, 0]
  const probe = photometricProbe(
    [hit.point.x, hit.point.y, hit.point.z],
    normal,
    material,
    paint,
    beads,
    doc.ambientLux
  )
  showProbeModal(probe)
}

function showProbeModal(probe: ReturnType<typeof photometricProbe>): void {
  const mask = document.createElement('div')
  mask.className = 'modal-mask'
  mask.innerHTML = `
    <div class="modal" style="width:620px;">
      <div class="row" style="justify-content:space-between;margin-bottom:12px;">
        <h3 style="margin:0;font-size:18px;">照度探针（手算对账）</h3>
        <button class="small ghost" data-close>关闭</button>
      </div>
      <div class="stat-grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:16px;">
        <div class="stat" style="padding:12px;"><div class="label">入射照度 E</div><div class="value" style="font-size:18px;">${fmt(probe.incidentLux, 1)} lx</div></div>
        <div class="stat" style="padding:12px;"><div class="label">出射照度 Et</div><div class="value" style="font-size:18px;">${fmt(probe.exitLux, 1)} lx</div></div>
        <div class="stat" style="padding:12px;"><div class="label">亮度 L</div><div class="value" style="font-size:18px;">${fmt(probe.luminance, 2)} cd/m²</div></div>
      </div>
      <p class="muted" style="font-size:13px;">公式：${probe.formula}</p>
      <div style="overflow:auto;max-height:280px;border:1px solid var(--border);border-radius:10px;">
        <table class="table">
          <thead><tr><th>灯珠</th><th>距离 m</th><th>cosθ</th><th>I (cd)</th><th>照度 lx</th></tr></thead>
          <tbody>
            ${probe.lines
              .map(
                (l) => `<tr><td>#${l.bead}</td><td>${fmt(l.distanceM, 3)}</td><td>${fmt(l.cosTheta, 3)}</td><td>${fmt(l.intensityCd, 2)}</td><td>${fmt(l.lux, 2)}</td></tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <p class="muted" style="margin-top:8px;">环境透射照度 ${fmt(probe.ambientTransmittedLux, 2)} lx；各项相加即入射照度，与纸面手算逐项对应</p>
    </div>`
  document.body.appendChild(mask)
  mask.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target === mask || target.closest('[data-close]')) mask.remove()
  })
}

async function runEvaluation(): Promise<void> {
  const doc = store.currentLantern
  if (!doc || evalBusy) return
  evalBusy = true
  try {
    report = await evaluateLantern(doc)
    renderSide()
  } finally {
    evalBusy = false
  }
}

function renderSide(): void {
  const doc = store.currentLantern
  const side = document.querySelector<HTMLElement>('#preview-side')
  if (!doc || !side) return
  const suggestions = report ? suggestLights(doc, report) : []
  side.innerHTML = `
    <strong style="font-size:16px;display:block;margin-bottom:16px;">亮度均匀性评估</strong>
    ${
      !report
        ? '<p class="muted">正在求解布面照度…</p>'
        : `
    <div class="stat-grid" style="grid-template-columns:1fr 1fr;">
      <div class="stat" style="padding:12px;"><div class="label">平均出射照度</div><div class="value" style="font-size:18px;">${fmt(report.overallAvgLux, 0)} lx</div></div>
      <div class="stat" style="padding:12px;"><div class="label">整体均匀度</div><div class="value" style="font-size:18px;">${fmt(report.overallUniformity, 3)}</div></div>
      <div class="stat" style="padding:12px;"><div class="label">暗区面积占比</div><div class="value" style="font-size:18px;color:${report.totalDarkRatio > 0.2 ? 'var(--danger)' : 'inherit'};">${fmt(report.totalDarkRatio * 100, 1)}%</div></div>
      <div class="stat" style="padding:12px;"><div class="label">光斑面积占比</div><div class="value" style="font-size:18px;color:${report.totalHotRatio > 0.2 ? 'var(--warning)' : 'inherit'};">${fmt(report.totalHotRatio * 100, 1)}%</div></div>
    </div>

    <div class="section-title">各布面明细（阈值 ${doc.darkThreshold}/${doc.hotThreshold} lx）</div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${report.patches
        .map((pe) => {
          const patch = doc.patches.find((p) => p.id === pe.patchId)
          const status = pe.darkRatio > 0.25 ? 'danger' : pe.hotRatio > 0.2 ? 'warning' : 'success'
          const statusText = pe.darkRatio > 0.25 ? '偏暗' : pe.hotRatio > 0.2 ? '光斑' : '均匀'
          return `
          <div class="list-item" style="padding:12px;">
            <div class="row" style="justify-content:space-between;">
              <strong style="font-size:14px;">${patch?.name ?? pe.patchId}</strong>
              <span class="badge ${status}">${statusText}</span>
            </div>
            <p class="muted" style="margin:6px 0 0;">
              均值 ${fmt(pe.avgExitLux, 0)} lx · 最低 ${fmt(pe.minExitLux, 0)} · 最高 ${fmt(pe.maxExitLux, 0)} · 均匀度 ${fmt(pe.uniformity, 2)}
            </p>
          </div>`
        })
        .join('')}
    </div>

    <div class="section-title">灯位自动建议</div>
    ${
      suggestions.length
        ? suggestions
            .map(
              (s) => `
        <div class="list-item" style="padding:12px;border-left:3px solid ${s.type === 'add' ? 'var(--primary)' : 'var(--info)'};">
          <div class="row" style="gap:8px;margin-bottom:6px;">
            <span class="badge ${s.type === 'add' ? 'info' : 'warning'}">${s.type === 'add' ? '补灯' : '挪灯'}</span>
            <span class="muted" style="font-size:12px;">坐标 ${s.position.map((v) => fmt(v, 2)).join(', ')}</span>
          </div>
          <p style="margin:0;font-size:13px;">${s.reason}</p>
          <button class="small" data-apply-sug style="margin-top:8px;">应用到灯光页数据</button>
        </div>`
            )
            .join('')
        : '<p class="muted">当前布光均匀，无自动调整建议</p>'
    }

    <div class="section-title">评估参数</div>
    <div class="row" style="gap:8px;">
      <label class="field" style="flex:1;">暗区阈值 lx<input type="number" id="ev-dark" value="${doc.darkThreshold}"></label>
      <label class="field" style="flex:1;">光斑阈值 lx<input type="number" id="ev-hot" value="${doc.hotThreshold}"></label>
    </div>
    <label class="field" style="margin-top:8px;">环境照度 lx<input type="number" id="ev-amb" value="${doc.ambientLux}"></label>
    <button class="small" id="btn-re-eval" style="width:100%;margin-top:12px;">${icon('refresh', 14)} 重新评估</button>
    `
    }
  `

  side.querySelector('#ev-dark')?.addEventListener('change', (e) => {
    doc.darkThreshold = Number((e.target as HTMLInputElement).value)
  })
  side.querySelector('#ev-hot')?.addEventListener('change', (e) => {
    doc.hotThreshold = Number((e.target as HTMLInputElement).value)
  })
  side.querySelector('#ev-amb')?.addEventListener('change', (e) => {
    doc.ambientLux = Number((e.target as HTMLInputElement).value)
  })
  side.querySelector('#btn-re-eval')?.addEventListener('click', () => {
    lanternScene?.rebuild(doc)
    runEvaluation()
  })
  side.querySelectorAll<HTMLElement>('[data-apply-sug]').forEach((el, i) =>
    el.addEventListener('click', () => applySuggestion(i))
  )
}

function applySuggestion(index: number): void {
  const doc = store.currentLantern
  if (!doc || !report) return
  const suggestions = suggestLights(doc, report)
  const s = suggestions[index]
  if (!s) return
  if (s.type === 'add') {
    doc.lights.push({
      id: crypto.randomUUID(),
      name: `建议补灯 ${doc.lights.length + 1}`,
      kind: 'point',
      position: s.position,
      end: null,
      step: 0.2,
      powerW: 3,
      cct: 3000,
      luminousEfficacy: 90,
      on: true
    })
    toast('已按建议加入点光源，点重新评估查看效果')
  } else if (s.lightId) {
    const light = doc.lights.find((l) => l.id === s.lightId)
    if (light) light.position = s.position
    toast('灯位已后移，点重新评估查看效果')
  }
  lanternScene?.rebuild(doc)
  runEvaluation()
}

export function disposePreview(): void {
  probeMode = false
  viewport?.dispose()
  viewport = null
  lanternScene = null
  venue = null
  report = null
}
