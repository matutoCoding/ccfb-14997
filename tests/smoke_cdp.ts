// CDP 端到端冒烟 v3：每请求独立监听器，逐步日志，全局超时
const base = 'http://127.0.0.1:5181/'
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const list = (await (await fetch('http://127.0.0.1:9222/json/list')).json()) as { type: string; webSocketDebuggerUrl: string }[]
const target = list.find((t) => t.type === 'page')!
const ws = new WebSocket(target.webSocketDebuggerUrl)
let msgId = 0
const consoleErrors: string[] = []
const pageErrors: string[] = []

function send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const myId = ++msgId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP 超时: ${method}`)), 15000)
    const handler = (ev: MessageEvent): void => {
      const m = JSON.parse(ev.data as string)
      if (m.id !== myId) {
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
          consoleErrors.push(m.params.args.map((a: { value?: string; description?: string }) => a.value ?? a.description ?? '?').join(' '))
        }
        if (m.method === 'Runtime.exceptionThrown') {
          pageErrors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
        }
        return
      }
      clearTimeout(timer)
      ws.removeEventListener('message', handler)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id: myId, method, params }))
  })
}

const overall = setTimeout(() => {
  console.error('全局超时，已收集 console 错误:', consoleErrors, '页面异常:', pageErrors)
  process.exit(2)
}, 70000)

await new Promise((r) => ws.addEventListener('open', r, { once: true }))
await send('Runtime.enable')
await send('Page.enable')

async function evalJs<T>(expression: string): Promise<T> {
  const res = (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })) as {
    result: { value?: T; exceptionDetails?: { text: string } }
  }
  if (res.result.exceptionDetails) throw new Error('页面异常: ' + res.result.exceptionDetails.text)
  return res.result.value as T
}

const log = (step: string, value: unknown): void => {
  console.log(`✓ ${step}:`, typeof value === 'object' ? JSON.stringify(value) : value)
}

// 清库刷新
await evalJs(`new Promise((res) => { const r = indexedDB.deleteDatabase('lantern_studio'); r.onsuccess = res; r.onerror = res; r.onblocked = res; })`)
await send('Page.navigate', { url: base })
await wait(2000)
log('首屏品牌', await evalJs(`document.querySelector('.brand')?.textContent`))

await evalJs(`document.querySelector('#btn-demo').click()`)
await wait(1500)
log('演示灯组数', await evalJs(`document.querySelectorAll('[data-open]').length`))
log('灯组名称', await evalJs(`[...document.querySelectorAll('[data-open] strong')].map(e=>e.textContent)`))

await evalJs(`document.querySelector('[data-open]').click()`)
await wait(2500)
log('骨架路由', await evalJs(`location.hash`))
log('分段数', await evalJs(`document.querySelectorAll('[data-seg]').length`))
log('canvas 数', await evalJs(`document.querySelectorAll('canvas').length`))
log('结构统计', await evalJs(`document.querySelector('.side-panel').innerText.includes('钢丝总长')`))
log('放样条目', await evalJs(`document.querySelectorAll('[data-edit-loft]').length`))

await evalJs(`location.hash='#/fabric'`)
await wait(2500)
log('蒙布-布面数', await evalJs(`document.querySelectorAll('[data-patch]').length`))
log('蒙布-材质数', await evalJs(`document.querySelectorAll('[data-mat]').length`))
log('蒙布 canvas', await evalJs(`document.querySelectorAll('#fabric-viewport canvas').length`))

await evalJs(`location.hash='#/lights'`)
await wait(2500)
log('灯具数', await evalJs(`document.querySelectorAll('[data-light]').length`))
log('功率统计', await evalJs(`document.querySelector('#light-side').innerText.match(/[\\d.]+ W/)?.[0]`))

await evalJs(`location.hash='#/preview'`)
await wait(5000)
log('评估完成', await evalJs(`document.querySelector('#preview-side').innerText.includes('平均出射照度')`))
log('评估数值', await evalJs(`document.querySelector('#preview-side .stat-grid').innerText.replace(/\\n/g,' ')`))
await evalJs(`document.querySelector('#btn-mode-heat').click()`)
await wait(600)
log('热力图切换', await evalJs(`document.querySelector('#btn-mode-heat').classList.contains('primary')`))
log('预览 canvas', await evalJs(`document.querySelectorAll('#preview-viewport canvas').length`))

await evalJs(`location.hash='#/bom'`)
await wait(1500)
log('BOM 行数', await evalJs(`document.querySelectorAll('#print-area tbody tr').length`))
log('BOM 四项', await evalJs(`[...document.querySelectorAll('.stat .value')].slice(0,4).map(e=>e.textContent).join(' | ')`))

log('IDB 持久化条数', await evalJs(
  `new Promise((res) => { const req = indexedDB.open('lantern_studio'); req.onsuccess = () => req.result.transaction('lanterns').objectStore('lanterns').count().onsuccess = (e)=>res(e.target.result) })`
))

clearTimeout(overall)
console.log(`\nconsole 错误 ${consoleErrors.length}:`, consoleErrors.slice(0, 5))
console.log(`页面异常 ${pageErrors.length}:`, pageErrors.slice(0, 5))
ws.close()
process.exit(consoleErrors.length + pageErrors.length ? 1 : 0)
