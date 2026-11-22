// 布面网格：按骨架节点生成带下垂的绸布网格，输出几何 + 光学采样点
import type { FabricMaterial, FabricPatch, LanternDoc, Segment, Vec3 } from './types'
import { computeLoftFrames } from './loft'
import { clamp, v3 } from './math_utils'
import type { SurfaceSample } from './optics'

export interface ClothMeshData {
  patchId: string
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  indices: Uint32Array
  samples: SurfaceSample[]
  areaM2: number
}

function materialOf(doc: LanternDoc, id: string): FabricMaterial {
  const m = doc.materials.find((x) => x.id === id)
  if (!m) throw new Error(`材质不存在: ${id}`)
  return m
}

function segOf(doc: LanternDoc): Segment[] {
  return doc.segments
}

// 四边形布面：双线性细分 + 中心下垂
function buildQuad(doc: LanternDoc, patch: FabricPatch, divU: number, divV: number): ClothMeshData {
  if (patch.source.kind !== 'quad') throw new Error('类型错误')
  const nodePos = new Map<string, Vec3>()
  segOf(doc).forEach((s) => s.nodes.forEach((n) => nodePos.set(n.id, n.pos)))
  const c = patch.source.corners.map((id) => nodePos.get(id)) as Vec3[]
  if (c.length !== 4 || c.some((p) => !p)) throw new Error('布面角点缺失')
  const rows = divV + 1
  const cols = divU + 1
  const positions = new Float32Array(rows * cols * 3)
  const uvs = new Float32Array(rows * cols * 2)
  const indices: number[] = []
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = i / divU
      const v = j / divV
      const top = v3.lerp(c[0], c[1], u)
      const bottom = v3.lerp(c[3], c[2], u)
      const p = v3.lerp(top, bottom, v)
      // 下垂：边缘为 0，中心最大，沿重力方向
      const sagShape = 4 * u * (1 - u) * 4 * v * (1 - v)
      p[1] -= patch.sag * sagShape
      const idx = j * cols + i
      positions.set(p, idx * 3)
      uvs.set([u, v], idx * 2)
    }
  }
  for (let j = 0; j < divV; j++) {
    for (let i = 0; i < divU; i++) {
      const a = j * cols + i
      const b = a + 1
      const d = (j + 1) * cols + i
      const e = d + 1
      indices.push(a, d, b, b, d, e)
    }
  }
  const normals = computeNormals(positions, indices)
  const material = materialOf(doc, patch.materialId)
  const samples = buildSamples(positions, normals, uvs, indices, patch, material)
  return { patchId: patch.id, positions, normals, uvs, indices: new Uint32Array(indices), samples, areaM2: areaOf(positions, indices) }
}

// 管状放样布面：复用放样标架，分段密度独立于骨架
function buildLoft(doc: LanternDoc, patch: FabricPatch): ClothMeshData {
  if (patch.source.kind !== 'loft') throw new Error('类型错误')
  const targetLoftId = patch.source.loftId
  let def = null as null | (typeof doc.segments)[number]['lofts'][number]
  for (const s of doc.segments) {
    const hit = s.lofts.find((l) => l.id === targetLoftId)
    if (hit) def = hit
  }
  if (!def) throw new Error('放样不存在')
  const frames = computeLoftFrames(def)
  const lenSeg = Math.max(2, patch.source.lengthSegments)
  const radSeg = Math.max(3, patch.source.radialSegments)
  const rows = lenSeg + 1
  const cols = radSeg + 1
  const positions = new Float32Array(rows * cols * 3)
  const uvs = new Float32Array(rows * cols * 2)
  const indices: number[] = []
  for (let j = 0; j < rows; j++) {
    const t = j / lenSeg
    const fi = clamp(Math.round(t * (frames.length - 1)), 0, frames.length - 1)
    const frame = frames[fi]
    for (let i = 0; i < cols; i++) {
      const u = i / radSeg
      const theta = u * Math.PI * 2 + frame.twist
      const ct = Math.cos(theta)
      const st = Math.sin(theta)
      const p: Vec3 = [
        frame.center[0] + frame.normal[0] * ct * frame.radiusX + frame.binormal[0] * st * frame.radiusY,
        frame.center[1] + frame.normal[1] * ct * frame.radiusX + frame.binormal[1] * st * frame.radiusY,
        frame.center[2] + frame.normal[2] * ct * frame.radiusX + frame.binormal[2] * st * frame.radiusY
      ]
      // 布在两环筋之间轻微内凹（模拟蒙布张力不足）
      const ringSag = patch.sag * Math.sin(Math.PI * t) * 0.5
      const inward = v3.normalize(v3.sub(frame.center, p))
      const shifted = v3.add(p, v3.scale(inward, ringSag))
      const idx = j * cols + i
      positions.set(shifted, idx * 3)
      uvs.set([u, t], idx * 2)
    }
  }
  for (let j = 0; j < lenSeg; j++) {
    for (let i = 0; i < radSeg; i++) {
      const a = j * cols + i
      const b = a + 1
      const d = (j + 1) * cols + i
      const e = d + 1
      indices.push(a, d, b, b, d, e)
    }
  }
  // 接缝闭合：最后一列与第一列位置相同
  const normals = computeNormals(positions, indices)
  const material = materialOf(doc, patch.materialId)
  const samples = buildSamples(positions, normals, uvs, indices, patch, material)
  return { patchId: patch.id, positions, normals, uvs, indices: new Uint32Array(indices), samples, areaM2: areaOf(positions, indices) }
}

function computeNormals(positions: Float32Array, indices: number[]): Float32Array {
  const normals = new Float32Array(positions.length)
  for (let k = 0; k < indices.length; k += 3) {
    const ia = indices[k] * 3
    const ib = indices[k + 1] * 3
    const ic = indices[k + 2] * 3
    const ab = [positions[ib] - positions[ia], positions[ib + 1] - positions[ia + 1], positions[ib + 2] - positions[ia + 2]]
    const ac = [positions[ic] - positions[ia], positions[ic + 1] - positions[ia + 1], positions[ic + 2] - positions[ia + 2]]
    const n = v3.cross(ab as Vec3, ac as Vec3)
    for (const vi of [ia, ib, ic]) {
      normals[vi] += n[0]
      normals[vi + 1] += n[1]
      normals[vi + 2] += n[2]
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1
    normals[i] /= l
    normals[i + 1] /= l
    normals[i + 2] /= l
  }
  return normals
}

function areaOf(positions: Float32Array, indices: number[]): number {
  let area = 0
  for (let k = 0; k < indices.length; k += 3) {
    const a = indices[k] * 3
    const b = indices[k + 1] * 3
    const c = indices[k + 2] * 3
    const ab = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]]
    const ac = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]]
    area += v3.len(v3.cross(ab as Vec3, ac as Vec3)) * 0.5
  }
  return area
}

// 以三角形重心为采样点，一个三角一个采样，兼顾精度与 CPU 求解规模
function buildSamples(
  positions: Float32Array,
  normals: Float32Array,
  uvs: Float32Array,
  indices: number[],
  patch: FabricPatch,
  material: FabricMaterial
): SurfaceSample[] {
  const out: SurfaceSample[] = []
  for (let k = 0; k < indices.length; k += 3) {
    const tri = [indices[k], indices[k + 1], indices[k + 2]]
    const p: Vec3 = [0, 0, 0]
    const n: Vec3 = [0, 0, 0]
    const uv: [number, number] = [0, 0]
    tri.forEach((vi) => {
      p[0] += positions[vi * 3] / 3
      p[1] += positions[vi * 3 + 1] / 3
      p[2] += positions[vi * 3 + 2] / 3
      n[0] += normals[vi * 3] / 3
      n[1] += normals[vi * 3 + 1] / 3
      n[2] += normals[vi * 3 + 2] / 3
      uv[0] += uvs[vi * 2] / 3
      uv[1] += uvs[vi * 2 + 1] / 3
    })
    out.push({ pos: p, normal: v3.normalize(n), uv, area: 0, patchId: patch.id, material, paintDarkness: 0 })
  }
  return out
}

export function buildPatchMesh(doc: LanternDoc, patch: FabricPatch): ClothMeshData {
  if (patch.source.kind === 'quad') return buildQuad(doc, patch, 6, 6)
  return buildLoft(doc, patch)
}
