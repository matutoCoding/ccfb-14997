// 绸布透光着色器：与 core/optics.ts 同一光度学公式，GPU 实时求解
// 支持模式：夜景发光 / 热力图（暗区-蓝，正常-绿，光斑-红）/ 仅材质
import * as THREE from 'three'
import type { LuminousBead } from '../core/optics'

export type ClothViewMode = 'night' | 'heat' | 'material'

export const MAX_GPU_BEADS = 160

export interface ClothMaterialParams {
  baseColor: THREE.Color
  transmittance: number
  scatter: number
  ambientLux: number
  darkThreshold: number
  hotThreshold: number
  exposure: number
  mode: ClothViewMode
}

const vertex = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`

const fragment = /* glsl */ `
  precision highp float;
  #define MAX_BEADS ${MAX_GPU_BEADS}
  uniform vec3 uBeadPos[MAX_BEADS];
  uniform vec3 uBeadColor[MAX_BEADS];
  uniform float uBeadFlux[MAX_BEADS];
  uniform int uBeadCount;
  uniform vec3 uBaseColor;
  uniform float uTau;
  uniform float uScatter;
  uniform float uAmbient;
  uniform float uDark;
  uniform float uHot;
  uniform float uExposure;
  uniform int uMode; // 0 night 1 heat 2 material
  uniform sampler2D uPaint;
  uniform float uPaintOpacity;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying vec2 vUv;

  vec3 heatRamp(float t) {
    t = clamp(t, 0.0, 1.0);
    vec3 blue = vec3(0.16, 0.42, 0.95);
    vec3 green = vec3(0.20, 0.78, 0.42);
    vec3 red = vec3(0.95, 0.28, 0.20);
    if (t < 0.5) return mix(blue, green, t * 2.0);
    return mix(green, red, (t - 0.5) * 2.0);
  }

  void main() {
    float paintA = texture2D(uPaint, vUv).a * uPaintOpacity;
    float tau = uTau * (1.0 - paintA);
    vec3 nrm = normalize(vNormalW);
    vec3 inward = -nrm;
    vec3 irradiance = vec3(0.0);
    float incidentLux = 0.0;
    for (int i = 0; i < MAX_BEADS; i++) {
      if (i >= uBeadCount) break;
      vec3 delta = uBeadPos[i] - vWorldPos;
      float d = length(delta);
      if (d < 0.02) continue;
      float cosT = max(dot(delta / d, inward), 0.0);
      if (cosT <= 0.001) continue;
      float intensity = uBeadFlux[i] / 12.5663706; // 4π
      float lux = intensity * cosT / (d * d);
      incidentLux += lux;
      irradiance += uBeadColor[i] * lux;
    }
    float exitLux = tau * (incidentLux + uAmbient);

    if (uMode == 2) {
      // 材质模式：白日观感，显示绸布本色与颜料
      vec3 paintColor = texture2D(uPaint, vUv).rgb;
      float pa = texture2D(uPaint, vUv).a;
      vec3 day = mix(uBaseColor, paintColor, pa * 0.85);
      gl_FragColor = vec4(day, 1.0);
      return;
    }
    if (uMode == 1) {
      // 热力图：按暗区/光斑阈值归一化
      float t = clamp((exitLux - uDark) / max(1.0, uHot - uDark), 0.0, 1.0);
      gl_FragColor = vec4(heatRamp(t), 1.0);
      return;
    }
    // 夜景：朗伯发光，色调映射
    vec3 transmitted = irradiance * tau;
    vec3 lin = transmitted * uScatter + uBaseColor * (tau * uAmbient);
    vec3 mapped = vec3(1.0) - exp(-lin * uExposure / 200.0);
    mapped = pow(mapped, vec3(1.0 / 2.2));
    gl_FragColor = vec4(mapped, 1.0);
  }
`

export function createClothMaterial(params: ClothMaterialParams): THREE.ShaderMaterial {
  const pos = new Array(MAX_GPU_BEADS).fill(0).map(() => new THREE.Vector3(0, 0, 0))
  const colors = new Array(MAX_GPU_BEADS).fill(0).map(() => new THREE.Vector3(0, 0, 0))
  const flux = new Float32Array(MAX_GPU_BEADS)
  return new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.DoubleSide,
    uniforms: {
      uBeadPos: { value: pos },
      uBeadColor: { value: colors },
      uBeadFlux: { value: flux },
      uBeadCount: { value: 0 },
      uBaseColor: { value: params.baseColor.clone() },
      uTau: { value: params.transmittance },
      uScatter: { value: params.scatter },
      uAmbient: { value: params.ambientLux },
      uDark: { value: params.darkThreshold },
      uHot: { value: params.hotThreshold },
      uExposure: { value: params.exposure },
      uMode: { value: params.mode === 'night' ? 0 : params.mode === 'heat' ? 1 : 2 },
      uPaint: { value: new THREE.Texture() },
      uPaintOpacity: { value: 1 }
    }
  })
}

// 上传灯珠：超出上限时按空间网格聚类（通量累加、位置通量加权），保证覆盖范围不丢
export function uploadBeads(mat: THREE.ShaderMaterial, beads: LuminousBead[]): number {
  const clustered = beads.length > MAX_GPU_BEADS ? clusterBeads(beads, MAX_GPU_BEADS) : beads
  const n = clustered.length
  const pos = mat.uniforms.uBeadPos.value as THREE.Vector3[]
  const col = mat.uniforms.uBeadColor.value as THREE.Vector3[]
  const flux = mat.uniforms.uBeadFlux.value as Float32Array
  for (let i = 0; i < n; i++) {
    pos[i].set(...clustered[i].pos)
    col[i].set(...clustered[i].cctRgb)
    flux[i] = clustered[i].flux
  }
  mat.uniforms.uBeadCount.value = n
  return beads.length - n
}

// 均匀空间网格分桶，通量加权合并；桶仍超限时按通量取前 N
function clusterBeads(beads: LuminousBead[], max: number): LuminousBead[] {
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const b of beads) {
    minX = Math.min(minX, b.pos[0]); maxX = Math.max(maxX, b.pos[0])
    minY = Math.min(minY, b.pos[1]); maxY = Math.max(maxY, b.pos[1])
    minZ = Math.min(minZ, b.pos[2]); maxZ = Math.max(maxZ, b.pos[2])
  }
  const cells = Math.max(2, Math.floor(Math.cbrt(max)))
  const sx = Math.max(0.01, (maxX - minX) / cells)
  const sy = Math.max(0.01, (maxY - minY) / cells)
  const sz = Math.max(0.01, (maxZ - minZ) / cells)
  const buckets = new Map<string, LuminousBead[]>()
  for (const b of beads) {
    const key = `${Math.floor((b.pos[0] - minX) / sx)},${Math.floor((b.pos[1] - minY) / sy)},${Math.floor((b.pos[2] - minZ) / sz)}`
    const arr = buckets.get(key)
    if (arr) arr.push(b)
    else buckets.set(key, [b])
  }
  let merged = [...buckets.values()].map((arr) => {
    if (arr.length === 1) return arr[0]
    let f = 0, px = 0, py = 0, pz = 0, r = 0, g = 0, bl = 0
    for (const b of arr) {
      f += b.flux
      px += b.pos[0] * b.flux; py += b.pos[1] * b.flux; pz += b.pos[2] * b.flux
      r += b.cctRgb[0] * b.flux; g += b.cctRgb[1] * b.flux; bl += b.cctRgb[2] * b.flux
    }
    return {
      pos: [px / f, py / f, pz / f] as [number, number, number],
      flux: f,
      cctRgb: [r / f, g / f, bl / f] as [number, number, number]
    }
  })
  if (merged.length > max) {
    merged = merged.sort((a, b) => b.flux - a.flux).slice(0, max)
  }
  return merged
}

export function setMode(mat: THREE.ShaderMaterial, mode: ClothViewMode): void {
  mat.uniforms.uMode.value = mode === 'night' ? 0 : mode === 'heat' ? 1 : 2
}
