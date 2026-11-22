// 通用 three.js 视口：渲染循环、自适应、拾取坐标换算
import * as THREE from 'three'
import { ViewportControls } from './controls'

export class Viewport {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: ViewportControls
  private container: HTMLElement
  private raf = 0
  private lastT = performance.now()
  private resizeObs: ResizeObserver
  private extraUpdaters: ((dt: number, t: number) => void)[] = []

  constructor(container: HTMLElement, bg = 0x070b14) {
    this.container = container
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    } catch (err) {
      container.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#cbd5e1;
          font-size:14px;padding:32px;text-align:center;line-height:1.8;">
          WebGL 初始化失败：${String(err instanceof Error ? err.message : err)}<br>
          请更新显卡驱动或更换支持 WebGL2 的浏览器
        </div>`
      throw err
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(this.renderer.domElement)
    this.scene.background = new THREE.Color(bg)
    this.scene.fog = new THREE.FogExp2(bg, 0.012)

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.05, 300)
    this.controls = new ViewportControls(this.camera, this.renderer.domElement)

    const hemi = new THREE.HemisphereLight(0x8fb4ff, 0x1a1208, 0.55)
    this.scene.add(hemi)
    const dir = new THREE.DirectionalLight(0xffffff, 1.1)
    dir.position.set(6, 12, 8)
    this.scene.add(dir)

    this.resizeObs = new ResizeObserver(() => this.resize())
    this.resizeObs.observe(container)
    this.resize()
    this.loop()
    // 调试/性能自动化钩子：仅暴露实例与最小工厂，不挂 THREE 命名空间，避免 Tree-Shaking 失效
    ;(window as unknown as Record<string, unknown>).__LANTERN_DEBUG__ = {
      viewport: this,
      makeMesh: (positions: Float32Array, indices: number[], color = 0x334455) => {
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
        geo.setIndex(indices)
        geo.computeVertexNormals()
        return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }))
      }
    }
  }

  addUpdater(fn: (dt: number, t: number) => void): void {
    this.extraUpdaters.push(fn)
  }

  // 屏幕像素 -> NDC
  toNDC(e: PointerEvent | MouseEvent): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1
    }
  }

  fitObject(obj: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(obj)
    if (!box.isEmpty()) this.controls.fit(box)
  }

  private resize(): void {
    const w = this.container.clientWidth || 800
    const h = this.container.clientHeight || 600
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  // 最近一帧的渲染统计快照（render 之后读取，此时 info 尚未被下一帧 reset）
  lastRenderInfo = { triangles: 0, calls: 0, lines: 0, points: 0 }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    const now = performance.now()
    const dt = Math.min(0.05, (now - this.lastT) / 1000)
    this.lastT = now
    this.controls.update(dt)
    const t = now / 1000
    this.extraUpdaters.forEach((fn) => fn(dt, t))
    this.renderer.render(this.scene, this.camera)
    const info = this.renderer.info.render
    this.lastRenderInfo = { triangles: info.triangles, calls: info.calls, lines: info.lines, points: info.points }
  }

  dispose(): void {
    cancelAnimationFrame(this.raf)
    this.resizeObs.disconnect()
    this.controls.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
