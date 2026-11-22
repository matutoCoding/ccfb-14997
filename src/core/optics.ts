// 透光计算核心（光度学，单位制：m / lm / lux / cd/m²）
// 物理链路：
//   点光源发光强度 I = Φ/4π (cd)
//   布面内表面入射照度 E = Σ I·cosθ/d² (lux)，cosθ 为入射角余弦
//   颜料削弱后透射率 τ' = τ·(1 - paintOpacity·颜料黑度)
//   出射照度 Et = τ'·E + τ'·ambient (lux)
//   朗伯散射面亮度 L = Et·scatter/π (cd/m²)
// GPU 着色器与此处同一公式，保证所见即所算
import type { FabricMaterial, LightItem, Vec3 } from './types'
import { clamp, v3 } from './math_utils'

export interface LuminousBead {
  pos: Vec3
  flux: number // 单颗光通量 lm
  cctRgb: Vec3 // 色温归一化颜色
}

// 灯带展开为离散灯珠
export function expandBeads(lights: LightItem[]): LuminousBead[] {
  const beads: LuminousBead[] = []
  for (const light of lights) {
    if (!light.on) continue
    const rgb = cctRgbCached(light.cct)
    if (light.kind === 'point') {
      beads.push({ pos: light.position, flux: light.powerW * light.luminousEfficacy, cctRgb: rgb })
    } else if (light.end) {
      const len = v3.dist(light.position, light.end)
      const n = Math.max(1, Math.round(len / Math.max(0.05, light.step)))
      const totalFlux = light.powerW * light.luminousEfficacy * len // W/m × m × lm/W
      const per = totalFlux / n
      for (let i = 0; i < n; i++) {
        beads.push({
          pos: v3.lerp(light.position, light.end, (i + 0.5) / n),
          flux: per,
          cctRgb: rgb
        })
      }
    }
  }
  return beads
}

const cctCache = new Map<number, Vec3>()
function cctRgbCached(cct: number): Vec3 {
  let v = cctCache.get(cct)
  if (!v) {
    v = cctToRgb(cct)
    cctCache.set(cct, v)
  }
  return v
}

function cctToRgb(kelvin: number): Vec3 {
  const t = kelvin / 100
  let r: number, g: number, b: number
  if (t <= 66) {
    r = 255
    g = 99.4708 * Math.log(t) - 161.12
    b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04
  } else {
    r = 329.7 * Math.pow(t - 60, -0.1332)
    g = 288.12 * Math.pow(t - 60, -0.0755)
    b = 255
  }
  return [clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255]
}

export interface SurfaceSample {
  pos: Vec3 // 布面中点（下垂后的实际位置）
  normal: Vec3 // 外法线
  uv: [number, number]
  area: number // m²
  patchId: string
  material: FabricMaterial
  // 颜料黑度 0~1（手绘层在该点的 alpha 采样），由网格模块填充
  paintDarkness: number
}

export interface SampleResult {
  pos: Vec3
  incidentLux: number // 内表面入射照度
  transmittance: number // 该点实际透射率（含颜料）
  exitLux: number // 外表面出射照度
  luminance: number // cd/m²
  // 主导光源贡献，供手算对账与灯位建议
  contributions: { beadIndex: number; lux: number; distance: number; cosTheta: number }[]
}

// 单个布面采样点的完整照度求解
export function evaluateSample(
  sample: SurfaceSample,
  beads: LuminousBead[],
  ambientLux: number,
  topN = 4
): SampleResult {
  const inward = v3.scale(sample.normal, -1) // 灯在布内侧，入射角相对内法线
  let incident = 0
  const all: SampleResult['contributions'] = []
  for (let i = 0; i < beads.length; i++) {
    const bead = beads[i]
    const delta = v3.sub(bead.pos, sample.pos)
    const dist = v3.len(delta)
    if (dist < 0.02) continue
    const dir = v3.scale(delta, 1 / dist)
    const cosTheta = Math.max(0, v3.dot(dir, inward))
    if (cosTheta <= 0.001) continue
    const intensity = bead.flux / (4 * Math.PI)
    const lux = (intensity * cosTheta) / (dist * dist)
    incident += lux
    all.push({ beadIndex: i, lux, distance: dist, cosTheta })
  }
  // 颜料覆盖处透射率按黑度线性折减
  const tau = sample.material.transmittance * (1 - sample.paintDarkness)
  const exitLux = tau * (incident + ambientLux)
  const luminance = (exitLux * sample.material.scatter) / Math.PI
  all.sort((a, b) => b.lux - a.lux)
  return {
    pos: sample.pos,
    incidentLux: incident,
    transmittance: tau,
    exitLux,
    luminance,
    contributions: all.slice(0, topN)
  }
}

// 手算对账探针：给定世界坐标与外法线，输出逐项计算过程
export interface ProbeLine {
  bead: number
  distanceM: number
  cosTheta: number
  intensityCd: number
  lux: number
}

export interface ProbeReport {
  position: Vec3
  incidentLux: number
  ambientTransmittedLux: number
  exitLux: number
  luminance: number
  lines: ProbeLine[]
  formula: string
}

export function photometricProbe(
  pos: Vec3,
  outwardNormal: Vec3,
  material: FabricMaterial,
  paintDarkness: number,
  beads: LuminousBead[],
  ambientLux: number
): ProbeReport {
  const inward = v3.scale(v3.normalize(outwardNormal), -1)
  const lines: ProbeLine[] = []
  let incident = 0
  beads.forEach((bead, i) => {
    const delta = v3.sub(bead.pos, pos)
    const dist = v3.len(delta)
    if (dist < 0.02) return
    const cosTheta = Math.max(0, v3.dot(v3.scale(delta, 1 / dist), inward))
    if (cosTheta <= 0.001) return
    const intensity = bead.flux / (4 * Math.PI)
    const lux = (intensity * cosTheta) / (dist * dist)
    incident += lux
    lines.push({ bead: i, distanceM: dist, cosTheta, intensityCd: intensity, lux })
  })
  lines.sort((a, b) => b.lux - a.lux)
  const tau = material.transmittance * (1 - paintDarkness)
  const exitLux = tau * (incident + ambientLux)
  return {
    position: pos,
    incidentLux: incident,
    ambientTransmittedLux: tau * ambientLux,
    exitLux,
    luminance: (exitLux * material.scatter) / Math.PI,
    lines: lines.slice(0, 8),
    formula: 'E=Σ(Φ/4π)·cosθ/d² ; Et=τ·(E+Eamb) ; L=Et·scatter/π'
  }
}

// 灯光统计
export function lightStats(lights: LightItem[]): {
  count: number
  pointCount: number
  stripBeadCount: number
  stripLengthM: number
  totalPowerW: number
  totalLumen: number
} {
  let count = 0
  let pointCount = 0
  let stripBeadCount = 0
  let stripLengthM = 0
  let totalPowerW = 0
  let totalLumen = 0
  for (const l of lights) {
    if (!l.on) continue
    if (l.kind === 'point') {
      count += 1
      pointCount += 1
      totalPowerW += l.powerW
      totalLumen += l.powerW * l.luminousEfficacy
    } else if (l.end) {
      const len = v3.dist(l.position, l.end)
      const n = Math.max(1, Math.round(len / Math.max(0.05, l.step)))
      count += n
      stripBeadCount += n
      stripLengthM += len
      totalPowerW += l.powerW * len
      totalLumen += l.powerW * l.luminousEfficacy * len
    }
  }
  return { count, pointCount, stripBeadCount, stripLengthM, totalPowerW, totalLumen }
}
