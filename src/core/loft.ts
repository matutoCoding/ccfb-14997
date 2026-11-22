// 截面放样：沿样条路径生成环向节点与钢丝杆件（龙身/凤身/花瓣/肢体通用）
import type { LoftDef, LoftRing, Rod, SkeletonNode, Vec3 } from './types'
import { catmullRom, clamp, lerp, v3 } from './math_utils'

export interface LoftFrame {
  center: Vec3
  tangent: Vec3
  normal: Vec3 // 环面基向量 n
  binormal: Vec3 // 环面基向量 b
  radiusX: number
  radiusY: number
  twist: number
}

const SUBDIV = 4 // 每两个编辑环之间的细分数

// 环上第 j 个顶点的位置
export function ringVertex(frame: LoftFrame, j: number, radial: number): Vec3 {
  const theta = (j / radial) * Math.PI * 2 + frame.twist
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  return [
    frame.center[0] + frame.normal[0] * c * frame.radiusX + frame.binormal[0] * s * frame.radiusY,
    frame.center[1] + frame.normal[1] * c * frame.radiusX + frame.binormal[1] * s * frame.radiusY,
    frame.center[2] + frame.normal[2] * c * frame.radiusX + frame.binormal[2] * s * frame.radiusY
  ]
}

// 平行传输标架：沿切线最小旋转传播，避免环面翻转
function buildFrames(rings: LoftRing[]): LoftFrame[] {
  const n = rings.length
  const centers = rings.map((r) => r.center)
  const tangents: Vec3[] = []
  for (let i = 0; i < n; i++) {
    const p0 = centers[Math.max(0, i - 1)]
    const p1 = centers[Math.min(n - 1, i + 1)]
    tangents.push(v3.normalize(v3.sub(p1, p0)))
  }
  const up: Vec3 = [0, 1, 0]
  let normal = v3.normalize(v3.sub(up, v3.scale(tangents[0], v3.dot(up, tangents[0]))))
  if (v3.len(normal) < 0.01) normal = [1, 0, 0]
  const frames: LoftFrame[] = []
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const axis = v3.cross(tangents[i - 1], tangents[i])
      const sinA = v3.len(axis)
      const cosA = clamp(v3.dot(tangents[i - 1], tangents[i]), -1, 1)
      if (sinA > 1e-6) {
        // Rodrigues 旋转
        const k = v3.scale(axis, 1 / sinA)
        const angle = Math.atan2(sinA, cosA)
        normal = rotateRodrigues(normal, k, angle)
      }
      normal = v3.normalize(v3.sub(normal, v3.scale(tangents[i], v3.dot(normal, tangents[i]))))
    }
    const binormal = v3.normalize(v3.cross(tangents[i], normal))
    frames.push({
      center: centers[i],
      tangent: tangents[i],
      normal,
      binormal,
      radiusX: rings[i].radiusX,
      radiusY: rings[i].radiusY,
      twist: rings[i].twist
    })
  }
  return frames
}

function rotateRodrigues(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const dot = v3.dot(k, v)
  const cross = v3.cross(k, v)
  return [
    v[0] * c + cross[0] * s + k[0] * dot * (1 - c),
    v[1] * c + cross[1] * s + k[1] * dot * (1 - c),
    v[2] * c + cross[2] * s + k[2] * dot * (1 - c)
  ]
}

// 把编辑环细分成平滑采样帧
export function computeLoftFrames(def: LoftDef): LoftFrame[] {
  const src = def.rings
  if (src.length < 2) return buildFrames(src)
  const out: LoftRing[] = []
  const last = src.length - 1
  for (let i = 0; i < last; i++) {
    const p0 = src[Math.max(0, i - 1)].center
    const p1 = src[i].center
    const p2 = src[i + 1].center
    const p3 = src[Math.min(src.length - 1, i + 2)].center
    for (let k = 0; k < SUBDIV; k++) {
      const t = k / SUBDIV
      out.push({
        center: catmullRom(p0, p1, p2, p3, t),
        radiusX: lerp(src[i].radiusX, src[i + 1].radiusX, t),
        radiusY: lerp(src[i].radiusY, src[i + 1].radiusY, t),
        twist: lerp(src[i].twist, src[i + 1].twist, t)
      })
    }
  }
  out.push(src[last])
  return buildFrames(out)
}

export function loftNodeId(loftId: string, ringIdx: number, segIdx: number): string {
  return `${loftId}_r${ringIdx}_s${segIdx}`
}

export interface LoftGeometry {
  nodes: SkeletonNode[]
  rods: Rod[]
  frames: LoftFrame[]
  radial: number
}

// 生成骨架节点与杆件（id 确定性，重复生成可直接覆盖）
export function generateLoft(def: LoftDef): LoftGeometry {
  const frames = computeLoftFrames(def)
  const radial = def.radialSegments
  const nodes: SkeletonNode[] = []
  const rods: Rod[] = []
  frames.forEach((f, i) => {
    for (let j = 0; j < radial; j++) {
      nodes.push({ id: loftNodeId(def.id, i, j), pos: ringVertex(f, j, radial) })
    }
  })
  const nid = (i: number, j: number) => loftNodeId(def.id, i, ((j % radial) + radial) % radial)
  for (let i = 0; i < frames.length; i++) {
    // 环向箍筋
    for (let j = 0; j < radial; j++) {
      rods.push({ id: `${def.id}_hoop_${i}_${j}`, a: nid(i, j), b: nid(i, j + 1), diameter: def.rodDiameter })
    }
    if (i === frames.length - 1) continue
    if (def.includeLongitudinal) {
      for (let j = 0; j < radial; j++) {
        rods.push({ id: `${def.id}_long_${i}_${j}`, a: nid(i, j), b: nid(i + 1, j), diameter: def.rodDiameter })
      }
    }
    if (def.includeDiagonal) {
      for (let j = 0; j < radial; j++) {
        rods.push({ id: `${def.id}_dia_a_${i}_${j}`, a: nid(i, j), b: nid(i + 1, j + 1), diameter: def.rodDiameter })
        rods.push({ id: `${def.id}_dia_b_${i}_${j}`, a: nid(i, j + 1), b: nid(i + 1, j), diameter: def.rodDiameter })
      }
    }
  }
  return { nodes, rods, frames, radial }
}
