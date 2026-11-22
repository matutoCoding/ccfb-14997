// 全局数据模型：所有持久化对象都存 IndexedDB

export type Vec3 = [number, number, number]

export type ID = string

// 灯会项目
export interface Project {
  id: ID
  name: string
  venue: string
  startDate: string
  endDate: string
  createdAt: number
  updatedAt: number
}

// 钢丝杆件
export interface Rod {
  id: ID
  a: ID // 节点 id
  b: ID
  diameter: number // 钢丝直径 mm
}

// 骨架节点
export interface SkeletonNode {
  id: ID
  pos: Vec3
}

// 管状截面放样（龙身/凤身/荷梗等）
export interface LoftDef {
  id: ID
  name: string
  rings: LoftRing[] // 沿路径排序的截面
  radialSegments: number // 每截面环向分段
  rodDiameter: number // 钢丝直径 mm
  includeLongitudinal: boolean // 纵向主筋
  includeDiagonal: boolean // 斜向交叉筋
}

export interface LoftRing {
  center: Vec3
  radiusX: number // 截面椭圆半径 m
  radiusY: number
  twist: number // 环向扭转角 rad
}

export interface Segment {
  id: ID
  name: string
  // 手工/放样生成后的骨架
  nodes: SkeletonNode[]
  rods: Rod[]
  lofts: LoftDef[]
  // 运输限制 m，单段包围盒超任一尺寸即报警
  transportLimit: Vec3
}

// 绸布材质预设
export interface FabricMaterial {
  id: ID
  name: string
  color: string // 十六进制
  thicknessMm: number
  transmittance: number // 0~1 基础透射率 τ
  scatter: number // 0~1 朗伯散射占比
}

// 布面网格类型
export type PatchKind = 'quad' | 'loft'

export interface QuadPatch {
  kind: 'quad'
  corners: [ID, ID, ID, ID] // 四个骨架节点 id，环绕顺序
}

export interface LoftPatch {
  kind: 'loft'
  loftId: ID
  lengthSegments: number // 沿路径分段
  radialSegments: number
}

export interface FabricPatch {
  id: ID
  name: string
  source: QuadPatch | LoftPatch
  materialId: ID
  sag: number // 下垂量 m，按杆间跨度比例偏移
  // 手绘颜料层：UV 画布 blob 的 id（存在 blobs store），无则为空
  paintBlobId: ID | null
  paintOpacity: number // 颜料对透射的削弱强度 0~1
}

// LED 灯
export type LightKind = 'point' | 'strip'

export interface LightItem {
  id: ID
  name: string
  kind: LightKind
  position: Vec3
  // strip 专用：终点与步进
  end: Vec3 | null
  step: number // 灯带灯珠间距 m
  powerW: number // point: 单颗功率；strip: 每米功率
  cct: number // 色温 K
  luminousEfficacy: number // 光效 lm/W
  on: boolean
}

export interface LanternDoc {
  id: ID
  projectId: ID
  name: string
  segments: Segment[]
  materials: FabricMaterial[]
  patches: FabricPatch[]
  lights: LightItem[]
  // 光学评估参数
  ambientLux: number // 环境照度 lux（夜晚背景光）
  darkThreshold: number // 暗区判定 lux（出射照度低于此值）
  hotThreshold: number // 光斑判定 lux（高于此值）
  createdAt: number
  updatedAt: number
}

// 运行时统计
export interface SegmentStats {
  segmentId: ID
  rodCount: number
  nodeCount: number
  wireLengthM: number
  weightKg: number
  maxDeflectionMm: number
  bbox: { min: Vec3; max: Vec3; size: Vec3 }
  overTransport: boolean
}
