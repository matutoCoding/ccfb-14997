// 段骨架维护：放样结果写回、节点/杆件增删
import { uid } from './constants'
import { generateLoft } from './loft'
import type { LoftDef, Rod, Segment, SkeletonNode, Vec3 } from './types'

// 放样节点 id 形如 loft_xxxx_r3_s2，手工节点为 n_xxxx
function isLoftNodeId(id: string): boolean {
  return id.startsWith('loft_') && id.includes('_r') && id.includes('_s')
}

// 重新生成某个段内所有放样并与手工节点/杆件合并
export function rebuildLofts(segment: Segment): void {
  segment.nodes = segment.nodes.filter((n) => !isLoftNodeId(n.id))
  segment.rods = segment.rods.filter((r) => !isLoftNodeId(r.a) && !isLoftNodeId(r.b))
  for (const loft of segment.lofts) {
    const geo = generateLoft(loft)
    segment.nodes.push(...geo.nodes)
    segment.rods.push(...geo.rods)
  }
}

export function addNode(segment: Segment, pos: Vec3): SkeletonNode {
  const node: SkeletonNode = { id: uid('n'), pos }
  segment.nodes.push(node)
  return node
}

export function addRod(segment: Segment, a: string, b: string, diameterMm: number): Rod {
  const rod: Rod = { id: uid('rod'), a, b, diameter: diameterMm }
  segment.rods.push(rod)
  return rod
}

export function addLoft(segment: Segment, def: Omit<LoftDef, 'id'>): LoftDef {
  const loft: LoftDef = { ...def, id: uid('loft') }
  segment.lofts.push(loft)
  rebuildLofts(segment)
  return loft
}

export function removeLoft(segment: Segment, loftId: string): void {
  segment.lofts = segment.lofts.filter((l) => l.id !== loftId)
  rebuildLofts(segment)
}
