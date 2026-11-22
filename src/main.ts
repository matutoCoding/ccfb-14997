// 应用入口：顶栏导航 + hash 路由 + 页面生命周期
import './styles.css'
import './print.css'
import { currentRoute, go, onRoute, type Route } from './core/router'
import { store } from './core/store'
import { icon } from './ui/icons'
import { renderProjects } from './pages/projects'
import { renderSkeleton, disposeSkeleton } from './pages/skeleton'
import { renderFabric, disposeFabric } from './pages/fabric'
import { renderLights, disposeLights } from './pages/lights'
import { renderPreview, disposePreview } from './pages/preview'
import { renderBom } from './pages/bom'

const NAV: { route: Route; label: string; icon: string }[] = [
  { route: 'projects', label: '灯组列表', icon: 'project' },
  { route: 'skeleton', label: '骨架编辑', icon: 'skeleton' },
  { route: 'fabric', label: '蒙布', icon: 'fabric' },
  { route: 'lights', label: '灯光布置', icon: 'light' },
  { route: 'preview', label: '夜景预览', icon: 'preview' },
  { route: 'bom', label: '下料单', icon: 'bom' }
]

function renderShell(): void {
  const app = document.querySelector<HTMLElement>('#app')!
  const route = currentRoute()
  const docName = store.currentLantern?.name
  app.innerHTML = `
    <header class="app-header">
      <div class="brand">彩灯工坊 · 骨架与透光预览</div>
      <nav class="app-nav">
        ${NAV.map((n) => `<button data-route="${n.route}" class="${n.route === route ? 'active' : ''}">
          ${icon(n.icon as never, 16)} ${n.label}
        </button>`).join('')}
      </nav>
      <div class="header-context" style="margin-left:auto;font-size:14px;color:var(--slate-400);">
        ${docName ? `当前灯组：${docName}` : '数据存储于本机 IndexedDB'}
      </div>
    </header>
    <main class="page" id="page-root"></main>`
  app.querySelectorAll<HTMLElement>('[data-route]').forEach((el) =>
    el.addEventListener('click', () => go(el.dataset.route as Route))
  )
}

const disposers: Partial<Record<Route, () => void>> = {
  skeleton: disposeSkeleton,
  fabric: disposeFabric,
  lights: disposeLights,
  preview: disposePreview
}

async function renderRoute(): Promise<void> {
  const route = currentRoute()
  // 离开 3D 页先释放 WebGL 资源
  Object.values(disposers).forEach((fn) => fn?.())
  renderShell()
  const root = document.querySelector<HTMLElement>('#page-root')!
  switch (route) {
    case 'projects':
      renderProjects(root)
      break
    case 'skeleton':
      renderSkeleton(root)
      break
    case 'fabric':
      renderFabric(root)
      break
    case 'lights':
      renderLights(root)
      break
    case 'preview':
      renderPreview(root)
      break
    case 'bom':
      await renderBom(root)
      break
  }
}

// Esc 退出指针锁定（巡场）
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.pointerLockElement) document.exitPointerLock()
})

async function bootstrap(): Promise<void> {
  await store.loadAll()
  if (!location.hash) location.hash = '#/projects'
  onRoute(() => renderRoute())
  store.subscribe(() => {
    // 数据变化只刷新顶栏灯组名，页面内部自行管理刷新
    const nameEl = document.querySelector('.header-context')
    if (nameEl) nameEl.textContent = store.currentLantern?.name ? `当前灯组：${store.currentLantern.name}` : '数据存储于本机 IndexedDB'
  })
  renderRoute()
}

bootstrap()
