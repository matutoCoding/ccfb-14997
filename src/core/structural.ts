// 结构粗算：钢丝长度/自重/挠度/包围盒/运输超限
import { STEEL_DENSITY, STEEL_E } from './constants'
import type { Rod, Segment, SegmentStats, SkeletonNode, Vec3 } from './types'
import { v3 } from './math_utils'

function nodeMap(nodes: SkeletonNode[]): Map<string, Vec3> {
  const m = new Map<string, Vec3>()
  nodes.forEach((n) => m.set(n.id, n.pos))
  return m
}

// 圆截面面积 m²（d 单位 mm）
function wireArea(diameterMm: number): number {
  const d = diameterMm / 1000
  return Math.PI * d * d / 4
}

// 均布载荷简支梁最大挠度 δ = 5qL⁴/(384EI)，q = ρAg
function deflectionMm(lengthM: number, diameterMm: number): number {
  const d = diameterMm / 1000
  const area = Math.PI * d * d / 4
  const inertia = Math.PI * d ** 4 / 64
  const q = STEEL_DENSITY * area * 9.81 // N/m
  return (5 * q * lengthM ** 4) / (384 * STEEL_E * inertia) * 1000
}

function bboxOf(nodes: SkeletonNode[]): { min: Vec3; max: Vec3; size: Vec3 } {
  if (!nodes.length) {
    const z: Vec3 = [0, 0, 0]
    return { min: z, max: z, size: z }
  }
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const n of nodes) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], n.pos[k])
      max[k] = Math.max(max[k], n.pos[k])
    }
  }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] }
}

export function calcSegmentStats(segment: Segment): SegmentStats {
  const pos = nodeMap(segment.nodes)
  let wireLengthM = 0
  let weightKg = 0
  let maxDeflectionMm = 0
  const seenRods = new Set<string>()
  for (const rod of segment.rods) {
    const a = pos.get(rod.a)
    const b = pos.get(rod.b)
    if (!a || !b) continue
    const key = [rod.a, rod.b].sort().join('|')
    if (seenRods.has(key)) continue // 放样与手工可能重复
    seenRods.add(key)
    const len = v3.dist(a, b)
    const area = wireArea(rod.diameter)
    wireLengthM += len
    weightKg += len * area * STEEL_DENSITY
    maxDeflectionMm = Math.max(maxDeflectionMm, deflectionMm(len, rod.diameter))
  }
  const bbox = bboxOf(segment.nodes)
  const overTransport = bbox.size.some((s, k) => s > segment.transportLimit[k])
  return {
    segmentId: segment.id,
    rodCount: seenRods.size,
    nodeCount: segment.nodes.length,
    wireLengthM,
    weightKg,
    maxDeflectionMm,
    bbox,
    overTransport
  }
}

// 焊点数：每个被杆件引用的节点计一个焊点（交点连接）
export function countWelds(rods: Rod[]): number {
  const used = new Set<string>()
  rods.forEach((r) => {
    used.add(r.a)
    used.add(r.b)
  })
  return used.size
}
