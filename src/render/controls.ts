// 轨道控制器 + 第一人称行走（夜景巡场），自实现无外部依赖
import * as THREE from 'three'

export class ViewportControls {
  readonly camera: THREE.PerspectiveCamera
  target = new THREE.Vector3(0, 1.2, 0)
  private sph = { radius: 12, phi: 1.15, theta: 0.6 }
  private el: HTMLElement
  private dragging = false
  private panning = false
  private lastX = 0
  private lastY = 0
  walkMode = false
  walkYaw = 0
  walkPitch = 0
  eyeHeight = 1.65
  private keys = new Set<string>()

  constructor(camera: THREE.PerspectiveCamera, el: HTMLElement) {
    this.camera = camera
    this.el = el
    el.addEventListener('pointerdown', this.onDown)
    window.addEventListener('pointermove', this.onMove)
    window.addEventListener('pointerup', this.onUp)
    el.addEventListener('wheel', this.onWheel, { passive: false })
    el.addEventListener('contextmenu', (e) => e.preventDefault())
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('keyup', this.onKeyUp)
    this.syncOrbit()
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onDown)
    window.removeEventListener('pointermove', this.onMove)
    window.removeEventListener('pointerup', this.onUp)
    this.el.removeEventListener('wheel', this.onWheel)
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('keyup', this.onKeyUp)
  }

  private onDown = (e: PointerEvent): void => {
    if (this.walkMode) return
    this.dragging = e.button === 0
    this.panning = e.button === 2 || e.button === 1
    this.lastX = e.clientX
    this.lastY = e.clientY
  }

  private onMove = (e: PointerEvent): void => {
    if (this.walkMode) {
      if (document.pointerLockElement === this.el) {
        this.walkYaw -= e.movementX * 0.0022
        this.walkPitch = THREE.MathUtils.clamp(this.walkPitch - e.movementY * 0.0022, -1.2, 1.2)
      }
      return
    }
    const dx = e.clientX - this.lastX
    const dy = e.clientY - this.lastY
    this.lastX = e.clientX
    this.lastY = e.clientY
    if (this.dragging) {
      this.sph.theta -= dx * 0.006
      this.sph.phi = THREE.MathUtils.clamp(this.sph.phi - dy * 0.006, 0.12, Math.PI - 0.12)
      this.syncOrbit()
    } else if (this.panning) {
      const pan = new THREE.Vector3()
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0)
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1)
      pan.addScaledVector(right, -dx * this.sph.radius * 0.0012)
      pan.addScaledVector(up, dy * this.sph.radius * 0.0012)
      this.target.add(pan)
      this.syncOrbit()
    }
  }

  private onUp = (): void => {
    this.dragging = false
    this.panning = false
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault()
    if (this.walkMode) return
    this.sph.radius = THREE.MathUtils.clamp(this.sph.radius * (1 + e.deltaY * 0.001), 1.2, 120)
    this.syncOrbit()
  }

  private onKey = (e: KeyboardEvent): void => {
    this.keys.add(e.key.toLowerCase())
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.key.toLowerCase())
  }

  setWalk(on: boolean): void {
    this.walkMode = on
    if (on) {
      this.walkYaw = this.sph.theta + Math.PI
      this.walkPitch = this.sph.phi - Math.PI / 2
      this.camera.position.set(this.target.x, this.eyeHeight, this.target.z + this.sph.radius * 0.5)
      this.el.requestPointerLock?.()
    } else {
      document.exitPointerLock?.()
      this.syncOrbit()
    }
  }

  // 每帧调用：行走模式 WASD 移动
  update(dt: number): void {
    if (!this.walkMode) return
    const speed = (this.keys.has('shift') ? 4.5 : 1.8) * dt
    const forward = new THREE.Vector3(-Math.sin(this.walkYaw), 0, -Math.cos(this.walkYaw))
    const right = new THREE.Vector3(-forward.z, 0, forward.x)
    const move = new THREE.Vector3()
    if (this.keys.has('w')) move.add(forward)
    if (this.keys.has('s')) move.sub(forward)
    if (this.keys.has('d')) move.add(right)
    if (this.keys.has('a')) move.sub(right)
    if (move.lengthSq() > 0) this.camera.position.addScaledVector(move.normalize(), speed)
    this.camera.position.y = this.eyeHeight
    const dir = new THREE.Vector3(
      -Math.sin(this.walkYaw) * Math.cos(this.walkPitch),
      Math.sin(this.walkPitch),
      -Math.cos(this.walkYaw) * Math.cos(this.walkPitch)
    )
    this.camera.lookAt(this.camera.position.clone().add(dir))
  }

  private syncOrbit(): void {
    const { radius, phi, theta } = this.sph
    this.camera.position.set(
      this.target.x + radius * Math.sin(phi) * Math.sin(theta),
      this.target.y + radius * Math.cos(phi),
      this.target.z + radius * Math.sin(phi) * Math.cos(theta)
    )
    this.camera.lookAt(this.target)
  }

  fit(box: THREE.Box3): void {
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    this.target.copy(center)
    this.sph.radius = Math.max(size.length() * 0.9, 3)
    this.syncOrbit()
  }
}
