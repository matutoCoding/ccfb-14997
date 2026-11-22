// 灯组三维场景：骨架杆件/可拖拽节点/灯珠/绸布/地面网格
import * as THREE from 'three'
import type { LanternDoc, LightItem, Vec3 } from '../core/types'
import { createClothMaterial, uploadBeads, type ClothViewMode } from './cloth_shader'
import { expandBeads } from '../core/optics'
import { buildPatchMesh } from '../core/cloth_mesh'

interface ClothEntry {
  patchId: string
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
}

export interface SceneOptions {
  showSkeleton: boolean
  showNodes: boolean
  showLights: boolean
  mode: ClothViewMode
  exposure: number
}

export class LanternScene {
  readonly group = new THREE.Group()
  private skeletonObj: THREE.LineSegments | null = null
  private nodeObj: THREE.Points | null = null
  private lightGroup = new THREE.Group()
  private clothEntries: ClothEntry[] = []
  private doc: LanternDoc | null = null
  private nodeIdList: string[] = []
  opts: SceneOptions = { showSkeleton: true, showNodes: true, showLights: true, mode: 'night', exposure: 1 }

  rebuild(doc: LanternDoc): void {
    this.doc = doc
    this.clearGroup()
    this.buildSkeleton(doc)
    this.buildLights(doc)
    this.buildCloth(doc)
    this.applyVisibility()
  }

  private clearGroup(): void {
    this.group.children.slice().forEach((c) => {
      this.group.remove(c)
      if (c instanceof THREE.Mesh) {
        c.geometry.dispose()
        const m = c.material
        if (Array.isArray(m)) m.forEach((x) => x.dispose())
        else m.dispose()
      }
    })
    this.clothEntries = []
  }

  private buildSkeleton(doc: LanternDoc): void {
    const positions: number[] = []
    const nodePositions: number[] = []
    const nodeIds: string[] = []
    for (const seg of doc.segments) {
      const pos = new Map(seg.nodes.map((n) => [n.id, n.pos]))
      const seen = new Set<string>()
      for (const rod of seg.rods) {
        const a = pos.get(rod.a)
        const b = pos.get(rod.b)
        if (!a || !b) continue
        const key = [rod.a, rod.b].sort().join('|')
        if (seen.has(key)) continue
        seen.add(key)
        positions.push(...a, ...b)
      }
      seg.nodes.forEach((n) => {
        nodePositions.push(...n.pos)
        nodeIds.push(n.id)
      })
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    this.skeletonObj = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.85 })
    )
    this.group.add(this.skeletonObj)

    const nGeo = new THREE.BufferGeometry()
    nGeo.setAttribute('position', new THREE.Float32BufferAttribute(nodePositions, 3))
    this.nodeObj = new THREE.Points(
      nGeo,
      new THREE.PointsMaterial({ color: 0xffb020, size: 0.09, sizeAttenuation: true })
    )
    this.nodeObj.name = 'nodes'
    this.nodeIdList = nodeIds
    this.group.add(this.nodeObj)
  }

  private buildLights(doc: LanternDoc): void {
    this.lightGroup.clear()
    for (const light of doc.lights) {
      if (light.kind === 'point') {
        const obj = this.makeBead(light.position, light)
        this.lightGroup.add(obj)
      } else if (light.end) {
        const len = Math.hypot(...light.end.map((v, k) => v - light.position[k]))
        const n = Math.max(1, Math.round(len / Math.max(0.05, light.step)))
        const geo = new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: n }, (_, i) => {
            const t = (i + 0.5) / n
            return new THREE.Vector3(
              light.position[0] + (light.end![0] - light.position[0]) * t,
              light.position[1] + (light.end![1] - light.position[1]) * t,
              light.position[2] + (light.end![2] - light.position[2]) * t
            )
          })
        )
        const points = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xfff2cc, size: 0.07, sizeAttenuation: true }))
        this.lightGroup.add(points)
        const lineGeo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(...light.position),
          new THREE.Vector3(...light.end)
        ])
        this.lightGroup.add(new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.5 })))
      }
    }
    this.group.add(this.lightGroup)
  }

  private makeBead(pos: Vec3, light: LightItem): THREE.Mesh {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 10, 10),
      new THREE.MeshBasicMaterial({ color: light.on ? 0xfff3c4 : 0x666666 })
    )
    mesh.position.set(...pos)
    mesh.userData.lightId = light.id
    return mesh
  }

  private buildCloth(doc: LanternDoc): void {
    const beads = expandBeads(doc.lights)
    for (const patch of doc.patches) {
      const data = buildPatchMesh(doc, patch)
      const material = doc.materials.find((m) => m.id === patch.materialId)
      if (!material) continue
      const mat = createClothMaterial({
        baseColor: new THREE.Color(material.color),
        transmittance: material.transmittance,
        scatter: material.scatter,
        ambientLux: doc.ambientLux,
        darkThreshold: doc.darkThreshold,
        hotThreshold: doc.hotThreshold,
        exposure: this.opts.exposure,
        mode: this.opts.mode
      })
      uploadBeads(mat, beads)
      mat.uniforms.uPaintOpacity.value = patch.paintOpacity
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
      geo.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3))
      geo.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2))
      geo.setIndex(new THREE.BufferAttribute(data.indices, 1))
      const mesh = new THREE.Mesh(geo, mat)
      mesh.userData.patchId = patch.id
      this.group.add(mesh)
      this.clothEntries.push({ patchId: patch.id, mesh, material: mat })
    }
  }

  // 手绘颜料纹理注入（dataURL 由 IndexedDB blobs store 读取）
  setPaintDataUrl(patchId: string, dataUrl: string): void {
    const entry = this.clothEntries.find((e) => e.patchId === patchId)
    if (!entry) return
    new THREE.TextureLoader().load(dataUrl, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      const old = entry.material.uniforms.uPaint.value as THREE.Texture
      if (old && old.image) old.dispose()
      entry.material.uniforms.uPaint.value = tex
      entry.material.uniformsNeedUpdate = true
    })
  }

  setPaintOpacity(patchId: string, opacity: number): void {
    const entry = this.clothEntries.find((e) => e.patchId === patchId)
    if (entry) entry.material.uniforms.uPaintOpacity.value = opacity
  }

  setMode(mode: ClothViewMode): void {
    this.opts.mode = mode
    this.clothEntries.forEach((e) => {
      const m = e.material
      m.uniforms.uMode.value = mode === 'night' ? 0 : mode === 'heat' ? 1 : 2
    })
  }

  setExposure(v: number): void {
    this.opts.exposure = v
    this.clothEntries.forEach((e) => (e.material.uniforms.uExposure.value = v))
  }

  setVisibility(partial: Partial<SceneOptions>): void {
    Object.assign(this.opts, partial)
    this.applyVisibility()
  }

  private applyVisibility(): void {
    if (this.skeletonObj) this.skeletonObj.visible = this.opts.showSkeleton
    if (this.nodeObj) this.nodeObj.visible = this.opts.showNodes
    this.lightGroup.visible = this.opts.showLights
  }

  // 节点拾取：返回节点 id 与世界坐标
  pickNode(pointer: { x: number; y: number }, camera: THREE.Camera): { id: string; index: number } | null {
    if (!this.nodeObj || !this.opts.showNodes) return null
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), camera)
    ray.params.Points = { threshold: 0.22 }
    const hits = ray.intersectObject(this.nodeObj)
    if (!hits.length) return null
    const index = hits[0].index ?? 0
    return { id: this.nodeIdList[index], index }
  }

  pickCloth(pointer: { x: number; y: number }, camera: THREE.Camera): THREE.Intersection | null {
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), camera)
    const meshes = this.clothEntries.map((e) => e.mesh)
    const hits = ray.intersectObjects(meshes, false)
    return hits[0] ?? null
  }

  // 拖拽节点到与射线相交的拖拽平面
  dragNode(index: number, plane: THREE.Plane, pointer: { x: number; y: number }, camera: THREE.Camera): Vec3 | null {
    if (!this.nodeObj) return null
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), camera)
    const hit = new THREE.Vector3()
    if (!ray.ray.intersectPlane(plane, hit)) return null
    const attr = this.nodeObj.geometry.getAttribute('position') as THREE.BufferAttribute
    attr.setXYZ(index, hit.x, hit.y, hit.z)
    attr.needsUpdate = true
    return [hit.x, hit.y, hit.z]
  }

  getNodeWorldPosition(index: number): THREE.Vector3 | null {
    if (!this.nodeObj) return null
    const attr = this.nodeObj.geometry.getAttribute('position') as THREE.BufferAttribute
    return new THREE.Vector3(attr.getX(index), attr.getY(index), attr.getZ(index))
  }

  getNodeId(index: number): string | null {
    return this.nodeIdList[index] ?? null
  }

  // 读取当前节点对象的全部世界坐标（拖拽结束后回写文档用）
  snapshotNodePositions(): { id: string; pos: Vec3 }[] {
    if (!this.nodeObj) return []
    const attr = this.nodeObj.geometry.getAttribute('position') as THREE.BufferAttribute
    return this.nodeIdList.map((id, i) => ({ id, pos: [attr.getX(i), attr.getY(i), attr.getZ(i)] as Vec3 }))
  }

  refreshLights(doc: LanternDoc): void {
    if (!this.doc) return
    this.buildLights(doc)
    const beads = expandBeads(doc.lights)
    this.clothEntries.forEach((e) => uploadBeads(e.material, beads))
    this.applyVisibility()
  }

  get worldBox(): THREE.Box3 {
    return new THREE.Box3().setFromObject(this.group)
  }
}
