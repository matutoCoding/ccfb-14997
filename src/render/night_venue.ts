// 夜景场地：地面、水面平面反射（镜像相机 + RenderTarget）、场地灯
import * as THREE from 'three'

export class NightVenue {
  readonly group = new THREE.Group()
  private reflection: THREE.WebGLRenderTarget
  private mirrorCamera = new THREE.PerspectiveCamera()
  private textureMatrix = new THREE.Matrix4()
  private water!: THREE.Mesh
  private ground!: THREE.Mesh
  readonly waterY = -0.02
  private size: number

  constructor(size = 60) {
    this.size = size
    this.reflection = new THREE.WebGLRenderTarget(1024, 1024, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter
    })
    this.buildGround()
    this.buildWater()
    this.buildStars()
  }

  private buildGround(): void {
    const geo = new THREE.PlaneGeometry(this.size * 2, this.size * 2)
    const mat = new THREE.MeshStandardMaterial({ color: 0x1d2430, roughness: 0.95, metalness: 0 })
    this.ground = new THREE.Mesh(geo, mat)
    this.ground.rotation.x = -Math.PI / 2
    this.ground.position.y = -0.05
    this.group.add(this.ground)

    const grid = new THREE.GridHelper(this.size, this.size, 0x39455a, 0x2a3444)
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = 0.35
    grid.position.y = -0.04
    this.group.add(grid)
  }

  private buildWater(): void {
    const geo = new THREE.PlaneGeometry(this.size, this.size * 0.7, 1, 1)
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        tReflection: { value: this.reflection.texture },
        textureMatrix: { value: this.textureMatrix },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x0a1626) }
      },
      vertexShader: /* glsl */ `
        uniform mat4 textureMatrix;
        varying vec4 vMirrorCoord;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vMirrorCoord = textureMatrix * wp;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tReflection;
        uniform float uTime;
        uniform vec3 uColor;
        varying vec4 vMirrorCoord;
        varying vec2 vUv;
        void main() {
          // 波纹扰动采样坐标，模拟微波倒影
          vec2 ripple = vec2(
            sin(vUv.y * 60.0 + uTime * 1.4) * 0.004,
            cos(vUv.x * 48.0 + uTime * 1.1) * 0.004
          );
          vec4 refl = texture2DProj(tReflection, vec4(vMirrorCoord.xy + ripple * vMirrorCoord.w, vMirrorCoord.zw));
          float fade = smoothstep(1.0, 0.25, abs(vUv.y - 0.5) * 2.0);
          vec3 col = mix(uColor, refl.rgb, 0.62 * fade + 0.25);
          gl_FragColor = vec4(col, 0.82);
        }
      `
    })
    this.water = new THREE.Mesh(geo, mat)
    this.water.rotation.x = -Math.PI / 2
    this.water.position.set(0, this.waterY, -this.size * 0.35)
    this.group.add(this.water)
  }

  private buildStars(): void {
    const n = 400
    const pos = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * this.size * 1.6
      pos[i * 3 + 1] = 12 + Math.random() * 18
      pos[i * 3 + 2] = (Math.random() - 0.5) * this.size * 1.6
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xbfd4ff, size: 0.08, sizeAttenuation: true, transparent: true, opacity: 0.8 }))
    this.group.add(points)
  }

  // 渲染镜像：在主渲染前调用
  renderReflection(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera, scene: THREE.Scene): void {
    const y = this.waterY
    // 镜像变换：对 y=const 平面反射
    const mirror = new THREE.Matrix4().set(
      1, 0, 0, 0,
      0, -1, 0, 2 * y,
      0, 0, 1, 0,
      0, 0, 0, 1
    )
    this.mirrorCamera.matrixWorld.copy(camera.matrixWorld).premultiply(mirror)
    this.mirrorCamera.matrixWorldInverse.copy(this.mirrorCamera.matrixWorld).invert()
    this.mirrorCamera.projectionMatrix.copy(camera.projectionMatrix)
    this.mirrorCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse)

    // 隐藏水面自身再渲染反射
    const waterVisible = this.water.visible
    this.water.visible = false
    const oldTarget = renderer.getRenderTarget()
    renderer.setRenderTarget(this.reflection)
    renderer.clear()
    renderer.render(scene, this.mirrorCamera)
    renderer.setRenderTarget(oldTarget)
    this.water.visible = waterVisible

    this.textureMatrix.set(
      0.5, 0, 0, 0.5,
      0, 0.5, 0, 0.5,
      0, 0, 0.5, 0.5,
      0, 0, 0, 1
    ).multiply(this.mirrorCamera.projectionMatrix).multiply(this.mirrorCamera.matrixWorldInverse)
  }

  setTime(t: number): void {
    ;(this.water.material as THREE.ShaderMaterial).uniforms.uTime.value = t
  }

  resize(w: number, h: number): void {
    const scale = Math.min(1, 1024 / Math.max(w, h))
    this.reflection.setSize(Math.max(256, Math.floor(w * scale)), Math.max(256, Math.floor(h * scale)))
  }
}
