// 灯组列表 / 灯会项目管理页
import { store } from '../core/store'
import { go } from '../core/router'
import { uid } from '../core/constants'
import { makeDragon, makeFigure, makeLotus, demoProject } from '../core/demo_data'
import type { LanternDoc, Project } from '../core/types'
import { confirmDialog, fmt, toast } from '../ui/feedback'
import { icon } from '../ui/icons'

export function renderProjects(root: HTMLElement): void {
  root.innerHTML = `
    <div class="page-narrow">
      <div class="row" style="justify-content:space-between;margin-bottom:24px;">
        <div>
          <h2 style="margin:0;font-size:22px;">灯会项目与灯组</h2>
          <p class="muted" style="margin:4px 0 0;">按灯会项目管理灯组，数据保存在本机 IndexedDB</p>
        </div>
        <div class="row">
          <button id="btn-demo" class="ghost">${icon('refresh')} 载入三个测试灯组</button>
          <button id="btn-project" class="primary">${icon('plus')} 新建灯会项目</button>
        </div>
      </div>
      <div id="project-list"></div>
    </div>`

  root.querySelector('#btn-project')!.addEventListener('click', () => createProject())
  root.querySelector('#btn-demo')!.addEventListener('click', () => loadDemo())
  renderList()
  if (!subscribed) {
    subscribed = true
    // store 数据变化（新建/删除/保存）后自动刷新列表，renderList 内部自带页面守卫
    store.subscribe(renderList)
  }
}

let subscribed = false

function renderList(): void {
  const host = document.querySelector<HTMLElement>('#project-list')
  if (!host) return // 已切换到其他页面
  if (!store.projects.length) {
    host.innerHTML = `
      <div class="empty-state">
        <div class="icon-line">${icon('project', 24)}</div>
        <h3 style="margin:0 0 8px;">还没有灯会项目</h3>
        <p style="margin:0 0 16px;">新建项目，或一键载入龙 / 荷花 / 人物三个测试灯组</p>
      </div>`
    return
  }
  host.innerHTML = store.projects
    .map(
      (p) => `
    <div class="card" style="margin-bottom:16px;">
      <div class="row" style="justify-content:space-between;">
        <div>
          <h3 style="margin:0;font-size:18px;">${p.name}</h3>
          <p class="muted" style="margin:4px 0 0;">${p.venue} · ${p.startDate} 至 ${p.endDate}</p>
        </div>
        <div class="row">
          <button class="small" data-edit-proj="${p.id}">编辑</button>
          <button class="small danger" data-del-proj="${p.id}">${icon('trash', 14)}</button>
        </div>
      </div>
      <div id="lanterns-${p.id}" style="margin-top:16px;"></div>
      <div class="row" style="margin-top:12px;">
        <button class="small" data-add-lan="${p.id}">${icon('plus', 14)} 新建灯组</button>
      </div>
    </div>`
    )
    .join('')

  store.projects.forEach((p) => {
    const box = host.querySelector<HTMLElement>(`#lanterns-${p.id}`)!
    const lans = store.lanterns.filter((l) => l.projectId === p.id)
    if (!lans.length) {
      box.innerHTML = `<p class="muted" style="margin:0;">暂无灯组</p>`
    } else {
      box.innerHTML = lans
        .map((l) => {
          const segInfo = l.segments
            .map((s) => `${s.name}(${fmt(s.transportLimit[0], 1)}m限)` )
            .join('、')
          return `
          <div class="list-item row" style="justify-content:space-between;" data-open="${l.id}">
            <div>
              <div class="row" style="gap:8px;">
                <strong style="font-size:16px;">${l.name}</strong>
                <span class="badge info">${l.segments.length} 段</span>
                <span class="badge">${l.patches.length} 块布</span>
                <span class="badge">${l.lights.length} 组灯</span>
              </div>
              <p class="muted" style="margin:6px 0 0;">分段：${segInfo}</p>
            </div>
            <div class="row">
              <button class="small danger" data-del-lan="${l.id}">${icon('trash', 14)}</button>
            </div>
          </div>`
        })
        .join('')
    }
  })

  host.querySelectorAll<HTMLElement>('[data-open]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-del-lan]')) return
      store.selectLantern(el.dataset.open!)
      go('skeleton')
    })
  })
  host.querySelectorAll<HTMLElement>('[data-del-lan]').forEach((el) =>
    el.addEventListener('click', async (e) => {
      e.stopPropagation()
      const ok = await confirmDialog('删除灯组', '灯组及其骨架、蒙布与灯光数据将一并删除，无法恢复。')
      if (ok) {
        await store.removeLantern(el.dataset.delLan!)
        toast('灯组已删除')
      }
    })
  )
  host.querySelectorAll<HTMLElement>('[data-add-lan]').forEach((el) =>
    el.addEventListener('click', () => createLantern(el.dataset.addLan!))
  )
  host.querySelectorAll<HTMLElement>('[data-del-proj]').forEach((el) =>
    el.addEventListener('click', async () => {
      const ok = await confirmDialog('删除项目', '项目下所有灯组将一并删除。')
      if (ok) {
        await store.removeProject(el.dataset.delProj!)
        toast('项目已删除')
      }
    })
  )
  host.querySelectorAll<HTMLElement>('[data-edit-proj]').forEach((el) =>
    el.addEventListener('click', () => createProject(store.projects.find((p) => p.id === el.dataset.editProj)))
  )
}

async function createProject(existing?: Project): Promise<void> {
  const p: Project = existing
    ? structuredClone(existing)
    : { id: uid('proj'), name: '', venue: '', startDate: '', endDate: '', createdAt: Date.now(), updatedAt: Date.now() }
  const mask = document.createElement('div')
  mask.className = 'modal-mask'
  mask.innerHTML = `
    <div class="modal">
      <h3 style="margin:0 0 16px;">${existing ? '编辑项目' : '新建灯会项目'}</h3>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <label class="field">项目名称<input id="f-name" value="${p.name}" placeholder="如：第30届自贡灯会"></label>
        <label class="field">展出场地<input id="f-venue" value="${p.venue}"></label>
        <div class="row">
          <label class="field">开展日期<input type="date" id="f-start" value="${p.startDate}"></label>
          <label class="field">结束日期<input type="date" id="f-end" value="${p.endDate}"></label>
        </div>
      </div>
      <div class="row" style="justify-content:flex-end;margin-top:24px;">
        <button data-cancel>取消</button>
        <button class="primary" data-ok>保存</button>
      </div>
    </div>`
  document.body.appendChild(mask)
  mask.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement
    if (target === mask || target.closest('[data-cancel]')) {
      mask.remove()
      return
    }
    if (target.closest('[data-ok]')) {
      p.name = mask.querySelector<HTMLInputElement>('#f-name')!.value.trim() || '未命名项目'
      p.venue = mask.querySelector<HTMLInputElement>('#f-venue')!.value.trim()
      p.startDate = mask.querySelector<HTMLInputElement>('#f-start')!.value
      p.endDate = mask.querySelector<HTMLInputElement>('#f-end')!.value
      await store.saveProject(p)
      mask.remove()
      toast('项目已保存')
    }
  })
}

async function createLantern(projectId: string): Promise<void> {
  const name = window.prompt('灯组名称', '新灯组')
  if (!name) return
  const doc: LanternDoc = {
    id: uid('lan'),
    projectId,
    name,
    segments: [
      {
        id: uid('seg'),
        name: '主段',
        nodes: [],
        rods: [],
        lofts: [],
        transportLimit: [9.6, 2.5, 3.0]
      }
    ],
    materials: [],
    patches: [],
    lights: [],
    ambientLux: 2,
    darkThreshold: 2,
    hotThreshold: 300,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  await store.saveLantern(doc)
  store.selectLantern(doc.id)
  go('skeleton')
}

async function loadDemo(): Promise<void> {
  let project = store.projects[0]
  if (!project) {
    project = demoProject()
    await store.saveProject(project)
  }
  const docs = [makeDragon(project.id), makeLotus(project.id), makeFigure(project.id)]
  for (const d of docs) await store.saveLantern(d)
  renderList()
  toast('三个测试灯组已生成：祥龙 / 荷花 / 仕女')
}
