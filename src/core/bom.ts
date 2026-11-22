// 下料单：钢丝长度/焊点数/布料面积/灯带米数，按段汇总
import { countWelds } from './structural'
import { lightStats } from './optics'
import { buildPatchMesh } from './cloth_mesh'
import type { LanternDoc } from './types'

export interface BomRow {
  name: string
  wireLengthM: number
  welds: number
  fabricM2: number
  stripM: number
  pointCount: number
  powerW: number
  weightKg: number
}

export interface BomReport {
  rows: BomRow[]
  total: BomRow
  generatedAt: string
}

export async function buildBom(doc: LanternDoc): Promise<BomReport> {
  const stats = lightStats(doc.lights)
  const rows: BomRow[] = []
  for (const seg of doc.segments) {
    const wireLengthM = seg.rods.reduce((sum, r) => {
      const a = seg.nodes.find((n) => n.id === r.a)
      const b = seg.nodes.find((n) => n.id === r.b)
      if (!a || !b) return sum
      const d = Math.hypot(
        a.pos[0] - b.pos[0],
        a.pos[1] - b.pos[1],
        a.pos[2] - b.pos[2]
      )
      return sum + d
    }, 0)
    const area = Math.PI * (wireDiameterAvg(seg.rods) / 1000 / 2) ** 2
    const weightKg = wireLengthM * area * 7850
    rows.push({
      name: seg.name,
      wireLengthM,
      welds: countWelds(seg.rods),
      fabricM2: 0,
      stripM: 0,
      pointCount: 0,
      powerW: 0,
      weightKg
    })
  }
  // 布料按所属放样/角点所在段归集，无法归属计入第一段
  for (const patch of doc.patches) {
    const mesh = buildPatchMesh(doc, patch)
    const row = rows[0]
    if (row) row.fabricM2 += mesh.areaM2 * 1.08 // 8% 搭接余量
  }
  // 灯带与点光源按最近节点归属段
  for (const light of doc.lights) {
    if (!light.on) continue
    const row = nearestSegmentRow(doc, rows, light.position)
    if (!row) continue
    if (light.kind === 'point') {
      row.pointCount += 1
      row.powerW += light.powerW
    } else if (light.end) {
      const len = Math.hypot(
        light.position[0] - light.end[0],
        light.position[1] - light.end[1],
        light.position[2] - light.end[2]
      )
      row.stripM += len
      row.powerW += light.powerW * len
    }
  }
  const total: BomRow = {
    name: '合计',
    wireLengthM: rows.reduce((s, r) => s + r.wireLengthM, 0),
    welds: rows.reduce((s, r) => s + r.welds, 0),
    fabricM2: rows.reduce((s, r) => s + r.fabricM2, 0),
    stripM: stats.stripLengthM,
    pointCount: stats.pointCount,
    powerW: stats.totalPowerW,
    weightKg: rows.reduce((s, r) => s + r.weightKg, 0)
  }
  return {
    rows,
    total,
    generatedAt: new Date().toLocaleString('zh-CN')
  }
}

function wireDiameterAvg(rods: { diameter: number }[]): number {
  if (!rods.length) return 3
  return rods.reduce((s, r) => s + r.diameter, 0) / rods.length
}

function nearestSegmentRow(doc: LanternDoc, rows: BomRow[], pos: [number, number, number]): BomRow | undefined {
  let best: BomRow | undefined
  let bestD = Infinity
  doc.segments.forEach((seg, i) => {
    if (!seg.nodes.length) return
    const d = Math.min(...seg.nodes.map((n) => Math.hypot(n.pos[0] - pos[0], n.pos[1] - pos[1], n.pos[2] - pos[2])))
    if (d < bestD) {
      bestD = d
      best = rows[i]
    }
  })
  return best
}
