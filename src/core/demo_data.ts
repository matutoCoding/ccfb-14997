// 测试灯组生成器：祥龙 / 荷花 / 人物（仕女），全部参数化写入标准文档结构
import { DEFAULT_TRANSPORT_LIMIT, FABRIC_PRESETS, uid } from './constants'
import { addLoft, addNode, addRod, rebuildLofts } from './skeleton_ops'
import type {
  FabricMaterial,
  FabricPatch,
  LanternDoc,
  LightItem,
  LoftRing,
  Project,
  Segment,
  Vec3
} from './types'

function baseDoc(name: string, projectId: string): LanternDoc {
  const materials: FabricMaterial[] = FABRIC_PRESETS.slice(0, 3).map((p, i) => ({
    id: `mat_${i}`,
    name: p.name,
    color: p.color,
    thicknessMm: p.thicknessMm,
    transmittance: p.transmittance,
    scatter: p.scatter
  }))
  return {
    id: uid('lan'),
    projectId,
    name,
    segments: [],
    materials,
    patches: [],
    lights: [],
    ambientLux: 2,
    darkThreshold: 2,
    hotThreshold: 300,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

function newSegment(name: string): Segment {
  return {
    id: uid('seg'),
    name,
    nodes: [],
    rods: [],
    lofts: [],
    transportLimit: [...DEFAULT_TRANSPORT_LIMIT] as Vec3
  }
}

function ring(center: Vec3, radiusX: number, radiusY = radiusX, twist = 0): LoftRing {
  return { center, radiusX, radiusY, twist }
}

function pointLight(pos: Vec3, powerW = 3, cct = 3000): LightItem {
  return {
    id: uid('light'),
    name: 'LED 点光源',
    kind: 'point',
    position: pos,
    end: null,
    step: 0.2,
    powerW,
    cct,
    luminousEfficacy: 90,
    on: true
  }
}

function stripLight(a: Vec3, b: Vec3, wpm = 8, cct = 2700): LightItem {
  return {
    id: uid('light'),
    name: 'LED 灯带',
    kind: 'strip',
    position: a,
    end: b,
    step: 0.17,
    powerW: wpm,
    cct,
    luminousEfficacy: 95,
    on: true
  }
}

// ---------- 祥龙：6 段蛇身放样 + 龙头 + 龙尾，约 14 米 ----------
export function makeDragon(projectId: string): LanternDoc {
  const doc = baseDoc('祥龙迎辉（约14米）', projectId)
  const bodySeg = newSegment('龙身（6 拆段）')
  doc.segments.push(bodySeg)

  const segCount = 6
  const ringsPerSeg = 5
  const allRings: LoftRing[] = []
  for (let i = 0; i <= segCount * ringsPerSeg; i++) {
    const t = i / (segCount * ringsPerSeg)
    const x = -7 + t * 14
    const y = 2.2 + Math.sin(t * Math.PI * 3) * 0.7
    const z = Math.cos(t * Math.PI * 3) * 0.9
    const r = 0.78 - t * 0.32 + Math.sin(t * Math.PI * 6) * 0.05
    allRings.push(ring([x, y, z], r, r * 0.92, t * 0.6))
  }
  // 按段切分放样，每段独立 LoftDef，方便单独编辑与运输检查
  for (let s = 0; s < segCount; s++) {
    const rings = allRings.slice(s * ringsPerSeg, (s + 1) * ringsPerSeg + 1)
    addLoft(bodySeg, {
      name: `龙身段 ${s + 1}`,
      rings,
      radialSegments: 10,
      rodDiameter: 4,
      includeLongitudinal: true,
      includeDiagonal: s % 2 === 0
    })
  }

  // 龙尾锥段
  const tailSeg = newSegment('龙尾')
  doc.segments.push(tailSeg)
  const tailStart = allRings[allRings.length - 1].center
  addLoft(tailSeg, {
    name: '龙尾锥',
    rings: [
      ring(tailStart, 0.42, 0.4),
      ring([tailStart[0] + 0.9, tailStart[1] + 0.25, tailStart[2]], 0.24, 0.22),
      ring([tailStart[0] + 1.7, tailStart[1] + 0.5, tailStart[2]], 0.06, 0.05)
    ],
    radialSegments: 8,
    rodDiameter: 3,
    includeLongitudinal: true,
    includeDiagonal: false
  })

  // 龙头：椭球放样 + 手工龙角/下颚杆
  const headSeg = newSegment('龙头')
  doc.segments.push(headSeg)
  const headBase = allRings[0].center
  addLoft(headSeg, {
    name: '龙头椭球',
    rings: [
      ring([headBase[0] - 0.5, headBase[1], headBase[2]], 0.3, 0.28),
      ring([headBase[0] - 1.0, headBase[1] + 0.15, headBase[2]], 0.62, 0.55),
      ring([headBase[0] - 1.55, headBase[1] + 0.1, headBase[2]], 0.5, 0.42),
      ring([headBase[0] - 1.9, headBase[1], headBase[2]], 0.22, 0.18)
    ],
    radialSegments: 10,
    rodDiameter: 4,
    includeLongitudinal: true,
    includeDiagonal: true
  })
  rebuildLofts(headSeg)
  const hornRootL = addNode(headSeg, [headBase[0] - 1.1, headBase[1] + 0.6, headBase[2] + 0.25])
  const hornTipL = addNode(headSeg, [headBase[0] - 1.25, headBase[1] + 1.35, headBase[2] + 0.45])
  addRod(headSeg, hornRootL.id, hornTipL.id, 3)
  const hornRootR = addNode(headSeg, [headBase[0] - 1.1, headBase[1] + 0.6, headBase[2] - 0.25])
  const hornTipR = addNode(headSeg, [headBase[0] - 1.25, headBase[1] + 1.35, headBase[2] - 0.45])
  addRod(headSeg, hornRootR.id, hornTipR.id, 3)

  // 蒙布：每段一个放样布面
  doc.segments.forEach((seg) => {
    seg.lofts.forEach((loft) => {
      const patch: FabricPatch = {
        id: uid('patch'),
        name: `${loft.name}绸布`,
        source: { kind: 'loft', loftId: loft.id, lengthSegments: 14, radialSegments: 16 },
        materialId: 'mat_0',
        sag: 0.04,
        paintBlobId: null,
        paintOpacity: 0.8
      }
      doc.patches.push(patch)
    })
  })

  // 灯：龙身每段双条灯带（实际扎制常见做法）+ 龙头两颗点光源
  for (let s = 0; s < segCount; s++) {
    const rings = bodySeg.lofts[s].rings
    const a0 = rings[0].center
    const a1 = rings[rings.length - 1].center
    doc.lights.push(
      stripLight([a0[0], a0[1], a0[2] + 0.22], [a1[0], a1[1], a1[2] + 0.22], 14, 2700),
      stripLight([a0[0], a0[1], a0[2] - 0.22], [a1[0], a1[1], a1[2] - 0.22], 14, 2700)
    )
  }
  doc.lights.push(pointLight([headBase[0] - 1.1, headBase[1], headBase[2] + 0.2], 5, 3200))
  doc.lights.push(pointLight([headBase[0] - 1.1, headBase[1], headBase[2] - 0.2], 5, 3200))
  doc.lights.push(pointLight(tailStart, 3, 3000))
  return doc
}

// ---------- 荷花：3 层花瓣放样 + 莲蓬 + 荷梗，花朵直径约 4.5 米 ----------
export function makeLotus(projectId: string): LanternDoc {
  const doc = baseDoc('盛世荷花（直径4.5米）', projectId)
  const petalSeg = newSegment('花瓣层')
  const stemSeg = newSegment('荷梗与莲蓬')
  doc.segments.push(petalSeg, stemSeg)

  // 荷梗
  addLoft(stemSeg, {
    name: '荷梗',
    rings: [ring([0, 0.1, 0], 0.16), ring([0, 1.4, 0], 0.13), ring([0, 2.6, 0], 0.11)],
    radialSegments: 8,
    rodDiameter: 3,
    includeLongitudinal: true,
    includeDiagonal: false
  })
  // 莲蓬
  addLoft(stemSeg, {
    name: '莲蓬',
    rings: [ring([0, 2.55, 0], 0.34, 0.22), ring([0, 2.85, 0], 0.3, 0.24), ring([0, 3.05, 0], 0.16, 0.14)],
    radialSegments: 9,
    rodDiameter: 3,
    includeLongitudinal: true,
    includeDiagonal: false
  })

  // 花瓣：沿环向布置的弯锥形放样，三层不同仰角
  const layers = [
    { count: 9, tilt: 1.15, len: 2.0, radius: 0.5, mat: 'mat_2' },
    { count: 7, tilt: 0.75, len: 1.7, radius: 0.42, mat: 'mat_0' },
    { count: 5, tilt: 0.4, len: 1.3, radius: 0.34, mat: 'mat_0' }
  ]
  layers.forEach((layer, li) => {
    for (let i = 0; i < layer.count; i++) {
      const angle = (i / layer.count) * Math.PI * 2 + li * 0.35
      const dir: Vec3 = [Math.cos(angle) * Math.sin(layer.tilt), Math.cos(layer.tilt), Math.sin(angle) * Math.sin(layer.tilt)]
      const base: Vec3 = [Math.cos(angle) * 0.25, 2.55, Math.sin(angle) * 0.25]
      const p = (t: number): Vec3 => [
        base[0] + dir[0] * layer.len * t + Math.cos(angle) * 0.35 * t * t,
        base[1] + dir[1] * layer.len * t - 0.18 * t * t,
        base[2] + dir[2] * layer.len * t + Math.sin(angle) * 0.35 * t * t
      ]
      addLoft(petalSeg, {
        name: `花瓣 L${li + 1}-${i + 1}`,
        rings: [
          ring(p(0), layer.radius * 0.5, layer.radius * 0.28),
          ring(p(0.45), layer.radius, layer.radius * 0.5),
          ring(p(0.8), layer.radius * 0.42, layer.radius * 0.24),
          ring(p(1), 0.03, 0.02)
        ],
        radialSegments: 7,
        rodDiameter: 3,
        includeLongitudinal: true,
        includeDiagonal: false
      })
    }
  })

  doc.segments.forEach((seg) => {
    seg.lofts.forEach((loft, idx) => {
      doc.patches.push({
        id: uid('patch'),
        name: `${loft.name}绸布`,
        source: { kind: 'loft', loftId: loft.id, lengthSegments: 10, radialSegments: 12 },
        materialId: idx % 3 === 0 ? 'mat_2' : 'mat_0',
        sag: 0.03,
        paintBlobId: null,
        paintOpacity: 0.8
      })
    })
  })

  // 灯光：莲蓬中心暖白点源 + 十字双灯带 + 荷梗灯带，外层花瓣尖端留暗区用于演示
  doc.lights.push(pointLight([0, 2.7, 0], 8, 3500))
  doc.lights.push(stripLight([0.7, 2.4, 0], [-0.7, 2.4, 0], 14, 2700))
  doc.lights.push(stripLight([0, 2.4, 0.7], [0, 2.4, -0.7], 14, 2700))
  doc.lights.push(stripLight([0, 0.2, 0], [0, 2.4, 0], 10, 3000))
  doc.lights.push(
    pointLight([0.5, 2.2, 0.5], 3, 3000),
    pointLight([-0.5, 2.2, 0.5], 3, 3000),
    pointLight([0, 2.2, -0.6], 3, 3000)
  )
  return doc
}

// ---------- 人物：仕女立像，头/躯干/裙摆/四肢放样，高约 3.6 米 ----------
export function makeFigure(projectId: string): LanternDoc {
  const doc = baseDoc('花灯仕女（高3.6米）', projectId)
  const body = newSegment('仕女主体')
  doc.segments.push(body)

  addLoft(body, {
    name: '裙摆',
    rings: [
      ring([0, 0.15, 0], 0.75, 0.6),
      ring([0, 0.7, 0], 0.6, 0.48),
      ring([0, 1.35, 0], 0.42, 0.34),
      ring([0, 1.9, 0], 0.3, 0.26)
    ],
    radialSegments: 10,
    rodDiameter: 4,
    includeLongitudinal: true,
    includeDiagonal: true
  })
  addLoft(body, {
    name: '躯干',
    rings: [ring([0, 1.9, 0], 0.3, 0.24), ring([0, 2.5, 0], 0.34, 0.26), ring([0, 2.85, 0], 0.18, 0.16)],
    radialSegments: 9,
    rodDiameter: 3.5,
    includeLongitudinal: true,
    includeDiagonal: false
  })
  addLoft(body, {
    name: '头颈',
    rings: [ring([0, 2.85, 0], 0.1, 0.1), ring([0, 3.05, 0], 0.09, 0.09), ring([0, 3.2, 0], 0.2, 0.22), ring([0, 3.45, 0], 0.19, 0.2)],
    radialSegments: 9,
    rodDiameter: 3,
    includeLongitudinal: true,
    includeDiagonal: false
  })
  // 双臂：微抬
  const armL = [
    ring([0.28, 2.7, 0], 0.09, 0.08),
    ring([0.55, 2.5, 0.1], 0.075, 0.07),
    ring([0.8, 2.35, 0.22], 0.06, 0.055),
    ring([0.95, 2.45, 0.3], 0.04, 0.035)
  ]
  const armR = armL.map((r) => ring([-r.center[0], r.center[1], r.center[2]], r.radiusX, r.radiusY, r.twist))
  addLoft(body, { name: '左臂', rings: armL, radialSegments: 7, rodDiameter: 3, includeLongitudinal: true, includeDiagonal: false })
  addLoft(body, { name: '右臂', rings: armR, radialSegments: 7, rodDiameter: 3, includeLongitudinal: true, includeDiagonal: false })

  body.lofts.forEach((loft) => {
    doc.patches.push({
      id: uid('patch'),
      name: `${loft.name}绸布`,
      source: { kind: 'loft', loftId: loft.id, lengthSegments: 12, radialSegments: 14 },
      materialId: loft.name === '裙摆' ? 'mat_1' : 'mat_0',
      sag: 0.025,
      paintBlobId: null,
      paintOpacity: 0.85
    })
  })

  // 灯光：躯干内竖向双灯带 + 双臂灯带 + 头灯，裙摆外侧一颗灯贴近布面制造光斑
  doc.lights.push(stripLight([0.12, 0.4, 0], [0.12, 2.8, 0], 14, 2700))
  doc.lights.push(stripLight([-0.12, 0.4, 0], [-0.12, 2.8, 0], 14, 2700))
  doc.lights.push(stripLight([0.25, 1.0, 0.15], [0.7, 2.2, 0.2], 8, 3000))
  doc.lights.push(stripLight([-0.25, 1.0, 0.15], [-0.7, 2.2, 0.2], 8, 3000))
  doc.lights.push(pointLight([0, 3.2, 0.05], 3, 3500))
  doc.lights.push(pointLight([0.55, 0.5, 0.45], 4, 2700))
  return doc
}

export function demoProject(): Project {
  return {
    id: uid('proj'),
    name: '自贡灯会 · 示例展区',
    venue: '自贡中华彩灯大世界',
    startDate: '2027-01-20',
    endDate: '2027-03-10',
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}
