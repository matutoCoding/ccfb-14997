// 透光计算手算对账：node --experimental-strip-types tests/optics_check.ts
// 典型工况：3W 点光源（90lm/W），距布 0.5m，正入射，τ=0.28 素绉缎
import { evaluateSample, expandBeads, photometricProbe, type SurfaceSample } from '../src/core/optics'
import type { FabricMaterial, LightItem } from '../src/core/types'
import { makeDragon, makeLotus, makeFigure } from '../src/core/demo_data'
import { evaluateLantern } from '../src/core/evaluation'
import { calcSegmentStats } from '../src/core/structural'

let pass = 0
let fail = 0
function assertClose(actual: number, expected: number, tol: number, label: string): void {
  const ok = Math.abs(actual - expected) <= tol
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: 实算=${actual.toFixed(4)} 手算=${expected.toFixed(4)} 差=${Math.abs(actual - expected).toFixed(5)}`)
  ok ? pass++ : fail++
}

const mat: FabricMaterial = {
  id: 'm1',
  name: '素绉缎',
  color: '#c8342c',
  thicknessMm: 0.22,
  transmittance: 0.28,
  scatter: 0.9
}

// 灯在布内侧 0.5m，法线朝外 +Z，灯位于 -Z
const light: LightItem = {
  id: 'l1',
  name: 'test',
  kind: 'point',
  position: [0, 0, -0.5],
  end: null,
  step: 0.2,
  powerW: 3,
  cct: 3000,
  luminousEfficacy: 90,
  on: true
}
const beads = expandBeads([light])
const flux = 3 * 90 // 270 lm
const intensity = flux / (4 * Math.PI) // cd
const expectedIncident = intensity / (0.5 * 0.5) // 正入射 cos=1
const expectedExit = 0.28 * (expectedIncident + 0)
const expectedLum = (expectedExit * 0.9) / Math.PI

const sample: SurfaceSample = {
  pos: [0, 0, 0],
  normal: [0, 0, 1],
  uv: [0.5, 0.5],
  area: 0.01,
  patchId: 'p',
  material: mat,
  paintDarkness: 0
}
const r = evaluateSample(sample, beads, 0)
assertClose(beads[0].flux, flux, 1e-9, '单颗光通量 lm')
assertClose(r.incidentLux, expectedIncident, 1e-6, '正入射照度 E=I/d² lux')
assertClose(r.exitLux, expectedExit, 1e-6, '出射照度 Et=τ·E lux')
assertClose(r.luminance, expectedLum, 1e-6, '朗伯亮度 L=Et·scatter/π cd/m²')

// 斜入射 60 度：cosθ=0.5，距离 1m
const light2: LightItem = { ...light, position: [Math.sin(Math.PI / 3), 0, -Math.cos(Math.PI / 3)] }
const beads2 = expandBeads([light2])
const r2 = evaluateSample(sample, beads2, 0)
const expected2 = (flux / (4 * Math.PI)) * 0.5 / 1
assertClose(r2.incidentLux, expected2, 1e-6, '60°斜入射照度含 cosθ')

// 颜料黑度 50%：τ 折半
const painted = evaluateSample({ ...sample, paintDarkness: 0.5 }, beads, 0)
assertClose(painted.exitLux, expectedExit * 0.5, 1e-6, '颜料区透射率折减')

// 环境光：ambient=5 lux 同样被 τ 折减
const amb = evaluateSample(sample, [], 5)
assertClose(amb.exitLux, 0.28 * 5, 1e-6, '环境照度透射')

// 探针与批量评估一致
const probe = photometricProbe([0, 0, 0], [0, 0, 1], mat, 0, beads, 0)
assertClose(probe.exitLux, r.exitLux, 1e-9, '探针与采样结果一致')

// 三个演示灯组端到端：评估必须成功且数值为正、有限
for (const [name, make] of [
  ['祥龙', makeDragon],
  ['荷花', makeLotus],
  ['仕女', makeFigure]
] as const) {
  const doc = make('proj_test')
  const stats = doc.segments.map(calcSegmentStats)
  const report = await evaluateLantern(doc)
  const finite = Number.isFinite(report.overallAvgLux) && report.overallAvgLux > 0
  console.log(`${finite ? 'PASS' : 'FAIL'} ${name} 端到端评估: 平均照度=${report.overallAvgLux.toFixed(1)}lux, 布面=${report.patches.length}, 灯珠=${report.beads.length}, 段=${doc.segments.length}`)
  finite ? pass++ : fail++
  const overLimit = stats.filter((s) => s.overTransport).length
  console.log(
    `  结构: 钢丝${stats.reduce((a, s) => a + s.wireLengthM, 0).toFixed(1)}m, 自重${stats.reduce((a, s) => a + s.weightKg, 0).toFixed(1)}kg, 超限段=${overLimit}`
  )
  // 龙身单段长度应接近 14/6≈2.3m，不超 9.6m 运输限制
  for (const s of stats) {
    const ok = s.bbox.size.every((v, k) => v <= doc.segments.find((x) => x.id === s.segmentId)!.transportLimit[k] + 1e-9) || s.overTransport
    if (!ok) fail++
  }
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`)
if (fail) process.exit(1)
