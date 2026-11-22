// IndexedDB 轻量封装：projects / lanterns / blobs 三个 store
import type { LanternDoc, Project } from './types'

const DB_NAME = 'lantern_studio'
const DB_VERSION = 1
const STORE = {
  projects: 'projects',
  lanterns: 'lanterns',
  blobs: 'blobs' // 手绘颜料画布 ImageBitmap 无法结构化克隆，存 dataURL 字符串
} as const

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE.projects)) db.createObjectStore(STORE.projects, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE.lanterns)) db.createObjectStore(STORE.lanterns, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE.blobs)) db.createObjectStore(STORE.blobs, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode)
        const req = fn(t.objectStore(store))
        req.onsuccess = () => resolve(req.result as T)
        req.onerror = () => reject(req.error)
      })
  )
}

export async function dbPut<T>(store: keyof typeof STORE, value: T): Promise<void> {
  await tx(STORE[store], 'readwrite', (s) => s.put(value))
}

export async function dbGet<T>(store: keyof typeof STORE, key: string): Promise<T | undefined> {
  return tx<T | undefined>(STORE[store], 'readonly', (s) => s.get(key))
}

export async function dbDelete(store: keyof typeof STORE, key: string): Promise<void> {
  await tx(STORE[store], 'readwrite', (s) => s.delete(key))
}

export async function dbGetAll<T>(store: keyof typeof STORE): Promise<T[]> {
  return tx<T[]>(STORE[store], 'readonly', (s) => s.getAll())
}

export const db = {
  listProjects: () => dbGetAll<Project>('projects'),
  putProject: (p: Project) => dbPut('projects', p),
  getProject: (id: string) => dbGet<Project>('projects', id),
  deleteProject: (id: string) => dbDelete('projects', id),

  listLanterns: (projectId?: string) =>
    dbGetAll<LanternDoc>('lanterns').then((list) =>
      projectId ? list.filter((l) => l.projectId === projectId) : list
    ),
  putLantern: (l: LanternDoc) => dbPut('lanterns', l),
  getLantern: (id: string) => dbGet<LanternDoc>('lanterns', id),
  deleteLantern: (id: string) => dbDelete('lanterns', id),

  putBlob: (id: string, dataUrl: string) => dbPut('blobs', { id, dataUrl }),
  getBlob: (id: string) => dbGet<{ id: string; dataUrl: string }>('blobs', id),
  deleteBlob: (id: string) => dbDelete('blobs', id)
}
