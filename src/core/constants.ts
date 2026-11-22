// 工程常量与材质预设

export const STEEL_DENSITY = 7850 // kg/m³
export const STEEL_E = 2.06e11 // 弹性模量 Pa
export const PI_M3 = Math.PI

// 新建灯组默认运输限制 m（典型 9.6 米货车）
export const DEFAULT_TRANSPORT_LIMIT: [number, number, number] = [9.6, 2.5, 3.0]

// 绸布材质预设：厚度 mm + 典型透射率
export const FABRIC_PRESETS = [
  { name: '电力纺（薄绸）', color: '#e8453c', thicknessMm: 0.12, transmittance: 0.42, scatter: 0.85 },
  { name: '素绉缎（中厚）', color: '#c8342c', thicknessMm: 0.22, transmittance: 0.28, scatter: 0.9 },
  { name: '织锦缎（厚）', color: '#9e2b25', thicknessMm: 0.35, transmittance: 0.16, scatter: 0.95 },
  { name: '纱绸（高透）', color: '#f2d8a0', thicknessMm: 0.08, transmittance: 0.58, scatter: 0.7 },
  { name: '涂层布（低透）', color: '#37424f', thicknessMm: 0.5, transmittance: 0.07, scatter: 0.98 }
] as const

export function uid(prefix = 'id'): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
}

export function nowMs(): number {
  return Date.now()
}
