// hash 路由：#/projects | skeleton | fabric | lights | preview | bom
export type Route = 'projects' | 'skeleton' | 'fabric' | 'lights' | 'preview' | 'bom'

const ROUTES: Route[] = ['projects', 'skeleton', 'fabric', 'lights', 'preview', 'bom']

export function currentRoute(): Route {
  const raw = location.hash.replace(/^#\/?/, '') as Route
  return ROUTES.includes(raw) ? raw : 'projects'
}

export function go(route: Route): void {
  location.hash = `#/${route}`
}

export function onRoute(fn: (r: Route) => void): () => void {
  const handler = (): void => fn(currentRoute())
  window.addEventListener('hashchange', handler)
  return () => window.removeEventListener('hashchange', handler)
}
