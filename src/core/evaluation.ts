// 整灯透光评估：汇总采样、均匀性统计、暗区/光斑判定、灯位建议
import { buildPatchMesh, type ClothMeshData } from './cloth_mesh'
import { evaluateSample, expandBeads, type LuminousBead, type SampleResult, type SurfaceSample } from './optics'
import { gridDarkness, loadPaintGrid, paintGridSize } from './paint'
import type { FabricPatch, LanternDoc, LightItem, Vec3 } from './types'
import { v3 } from './math_utils'

export interface PatchEvaluation {
  patchId: string
  areaM2: number
  samples: SampleResult[]
  avgExitLux: number
  minExitLux: number
  maxExitLux: number
  uniformity: number // min/avg，越接近 1 越均匀
  darkRatio: number // 低于暗区阈值的面积占比
  hotRatio: number // 高于光斑阈值的面积占比
  centroid: Vec3
  inwardPoint: Vec3 // 布面内侧建议布灯点
}

export interface EvaluationReport {
  patches: PatchEvaluation[]
  overallAvgLux: number
  overallUniformity: number
  totalDarkRatio: number
  totalHotRatio: number
  beads: LuminousBead[]
  meshes: ClothMeshData[]
}

export interface LightSuggestion {
  type: 'add' | 'move'
  reason: string
  position: Vec3
  targetPatchId: string
  expectedGainLux: number
  lightId?: string
}

// 应用颜料层后返回全部布面采样点与网格
export async function buildClothSamples(doc: LanternDoc): Promise<{ meshes: ClothMeshData[]; allSamples: SurfaceSample[] }> {
  const meshes: ClothMeshData[] = []
  const allSamples: SurfaceSample[] = []
  for (const patch of doc.patches) {
    const mesh = buildPatchMesh(doc, patch)
    const grid = await loadPaintGrid(patch.paintBlobId)
    const size = patch.paintBlobId ? await paintGridSize(patch.paintBlobId) : null
    if (grid && size) {
      mesh.samples.forEach((s) => {
        s.paintDarkness = gridDarkness(grid, size.width, size.height, s.uv) * patch.paintOpacity
      })
    }
    meshes.push(mesh)
    allSamples.push(...mesh.samples)
  }
  return { meshes, allSamples }
}

function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
}

export async function evaluateLantern(doc: LanternDoc): Promise<EvaluationReport> {
  const { meshes, allSamples } = await buildClothSamples(doc)
  const beads = expandBeads(doc.lights)
  const patchMap = new Map(doc.patches.map((p) => [p.id, p]))
  const evals: PatchEvaluation[] = []
  let weightedLuxSum = 0
  let areaSum = 0
  let darkArea = 0
  let hotArea = 0

  for (const mesh of meshes) {
    const patch = patchMap.get(mesh.patchId) as FabricPatch
    const results = mesh.samples.map((s) => evaluateSample(s, beads, doc.ambientLux))
    const lux = results.map((r) => r.exitLux)
    const avg = mean(lux)
    const area = mesh.areaM2
    const dark = results.filter((r) => r.exitLux < doc.darkThreshold).length / Math.max(1, results.length)
    const hot = results.filter((r) => r.exitLux > doc.hotThreshold).length / Math.max(1, results.length)
    const centroid = centroidOf(mesh)
    evals.push({
      patchId: patch.id,
      areaM2: area,
      samples: results,
      avgExitLux: avg,
      minExitLux: Math.min(...lux),
      maxExitLux: Math.max(...lux),
      uniformity: avg > 0 ? Math.min(...lux) / avg : 0,
      darkRatio: dark,
      hotRatio: hot,
      centroid,
      inwardPoint: inwardSuggestion(centroid, mesh)
    })
    weightedLuxSum += avg * area
    areaSum += area
    darkArea += dark * area
    hotArea += hot * area
  }

  const allLux = evals.flatMap((e) => e.samples.map((s) => s.exitLux))
  return {
    patches: evals,
    overallAvgLux: areaSum ? weightedLuxSum / areaSum : 0,
    overallUniformity: mean(allLux) > 0 ? Math.min(...allLux) / mean(allLux) : 0,
    totalDarkRatio: areaSum ? darkArea / areaSum : 0,
    totalHotRatio: areaSum ? hotArea / areaSum : 0,
    beads,
    meshes
  }
}

function centroidOf(mesh: ClothMeshData): Vec3 {
  const c: Vec3 = [0, 0, 0]
  const n = mesh.positions.length / 3
  for (let i = 0; i < n; i++) {
    c[0] += mesh.positions[i * 3] / n
    c[1] += mesh.positions[i * 3 + 1] / n
    c[2] += mesh.positions[i * 3 + 2] / n
  }
  return c
}

// 沿平均法线向内退一个“建议灯距”，避免灯珠贴布
function inwardSuggestion(centroid: Vec3, mesh: ClothMeshData): Vec3 {
  const n: Vec3 = [0, 0, 0]
  const count = mesh.normals.length / 3
  for (let i = 0; i < count; i++) {
    n[0] += mesh.normals[i * 3] / count
    n[1] += mesh.normals[i * 3 + 1] / count
    n[2] += mesh.normals[i * 3 + 2] / count
  }
  const normal = v3.normalize(n)
  const radius = Math.cbrt(mesh.areaM2 / (4 * Math.PI)) * 0.6 + 0.15
  return v3.sub(centroid, v3.scale(normal, radius))
}

// 灯位建议：暗区补灯、光斑区把最近的灯往里挪
export function suggestLights(doc: LanternDoc, report: EvaluationReport): LightSuggestion[] {
  const out: LightSuggestion[] = []
  const beads = report.beads
  for (const pe of report.patches) {
    if (pe.darkRatio > 0.25) {
      const gain = Math.max(0, doc.darkThreshold * 1.3 - pe.avgExitLux)
      out.push({
        type: 'add',
        reason: `布面 ${pe.darkRatio.toFixed(0)} 面积偏暗（均值 ${pe.avgExitLux.toFixed(0)} lux），内侧补一颗点光源`,
        position: pe.inwardPoint,
        targetPatchId: pe.patchId,
        expectedGainLux: gain
      })
    }
    if (pe.hotRatio > 0.2 && beads.length) {
      // 找对该布面贡献最大的灯珠，建议沿外法线反方向后移
      const top = pe.samples
        .filter((s) => s.exitLux > doc.hotThreshold)
        .flatMap((s) => s.contributions)
        .sort((a, b) => b.lux - a.lux)[0]
      if (top) {
        const bead = beads[top.beadIndex]
        const dir = v3.normalize(v3.sub(bead.pos, pe.centroid))
        out.push({
          type: 'move',
          reason: `灯珠距布仅 ${top.distance.toFixed(2)} m 形成光斑，建议后移 0.2~0.3 m`,
          position: v3.add(bead.pos, v3.scale(dir, 0.25)),
          targetPatchId: pe.patchId,
          expectedGainLux: 0,
          lightId: findLightId(doc.lights, bead.pos)
        })
      }
    }
  }
  return out.slice(0, 6)
}

function findLightId(lights: LightItem[], pos: Vec3): string | undefined {
  let best: LightItem | undefined
  let bestD = Infinity
  for (const l of lights) {
    const d = v3.dist(l.position, pos)
    if (d < bestD) {
      bestD = d
      best = l
    }
  }
  return best?.id
}
