// 全局应用状态：当前项目/灯组缓存 + 订阅式更新
import { db } from './db'
import type { LanternDoc, Project } from './types'
import { nowMs } from './constants'

type Listener = () => void

class AppStore {
  projects: Project[] = []
  lanterns: LanternDoc[] = []
  currentProjectId: string | null = null
  currentLanternId: string | null = null
  private listeners = new Set<Listener>()

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    this.listeners.forEach((fn) => fn())
  }

  async loadAll(): Promise<void> {
    this.projects = await db.listProjects()
    this.lanterns = await db.listLanterns()
    this.projects.sort((a, b) => b.updatedAt - a.updatedAt)
    this.emit()
  }

  get currentLantern(): LanternDoc | null {
    return this.lanterns.find((l) => l.id === this.currentLanternId) ?? null
  }

  get currentProject(): Project | null {
    return this.projects.find((p) => p.id === this.currentProjectId) ?? null
  }

  selectLantern(id: string): void {
    this.currentLanternId = id
    const lan = this.lanterns.find((l) => l.id === id)
    if (lan) this.currentProjectId = lan.projectId
    this.emit()
  }

  async saveLantern(doc: LanternDoc): Promise<void> {
    doc.updatedAt = nowMs()
    await db.putLantern(doc)
    const idx = this.lanterns.findIndex((l) => l.id === doc.id)
    if (idx >= 0) this.lanterns[idx] = doc
    else this.lanterns.push(doc)
    this.emit()
  }

  async removeLantern(id: string): Promise<void> {
    await db.deleteLantern(id)
    this.lanterns = this.lanterns.filter((l) => l.id !== id)
    if (this.currentLanternId === id) this.currentLanternId = null
    this.emit()
  }

  async saveProject(p: Project): Promise<void> {
    p.updatedAt = nowMs()
    await db.putProject(p)
    const idx = this.projects.findIndex((x) => x.id === p.id)
    if (idx >= 0) this.projects[idx] = p
    else this.projects.push(p)
    this.emit()
  }

  async removeProject(id: string): Promise<void> {
    await db.deleteProject(id)
    this.projects = this.projects.filter((p) => p.id !== id)
    for (const lan of this.lanterns.filter((l) => l.projectId === id)) {
      await this.removeLantern(lan.id)
    }
    if (this.currentProjectId === id) this.currentProjectId = null
    this.emit()
  }
}

export const store = new AppStore()
