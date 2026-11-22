// 渲染性能测试：复用当前已打开的预览页，钩子就绪后采样；基线 / 80k / 160k 三档
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const list = (await (await fetch('http://127.0.0.1:9222/json/list')).json()) as { type: string; webSocketDebuggerUrl: string }[]
const ws = new WebSocket(list.find((t) => t.type === 'page')!.webSocketDebuggerUrl)
let msgId = 0
function send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const myId = ++msgId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP 超时: ${method}`)), 15000)
    ws.addEventListener('message', function handler(ev) {
      const m = JSON.parse(ev.data as string)
      if (m.id !== myId) return
      clearTimeout(timer)
      ws.removeEventListener('message', handler)
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)
    })
    ws.send(JSON.stringify({ id: myId, method, params }))
  })
}
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
await send('Runtime.enable')
async function evalJs<T>(expression: string): Promise<T> {
  const res = (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })) as {
    result: { value?: T; exceptionDetails?: { text: string } }
  }
  if (res.result.exceptionDetails) throw new Error(res.result.exceptionDetails.text)
  return res.result.value as T
}

// hash 路由切换不刷新文档，安全进入预览页
await evalJs(`location.hash = '#/preview'`)
// 等待预览页与调试钩子就绪
for (let i = 0; i < 25; i++) {
  const ready = await evalJs<boolean>(`!!(window.__LANTERN_DEBUG__ && document.querySelector('#preview-viewport canvas'))`).catch(() => false)
  if (ready) break
  await wait(800)
}
const hookOk = await evalJs<boolean>(`!!window.__LANTERN_DEBUG__`)
if (!hookOk) {
  console.error('调试钩子未就绪：请先在灯组列表载入演示灯组')
  process.exit(1)
}
// 等夜景评估与场景稳定
await wait(3000)

async function sample(label: string): Promise<void> {
  const info = await evalJs<{ fps: number; triangles: number; calls: number; meshes: number }>(`new Promise((resolve) => {
    const D = window.__LANTERN_DEBUG__;
    const start = performance.now();
    let frames = 0;
    let last = D.viewport.lastRenderInfo;
    function tick() {
      frames++;
      last = D.viewport.lastRenderInfo;
      if (performance.now() - start < 2000) requestAnimationFrame(tick);
      else {
        resolve({
          fps: Math.round(frames * 1000 / (performance.now() - start)),
          triangles: last.triangles, calls: last.calls,
          meshes: D.viewport.scene.children.filter((o) => o.isMesh).length
        });
      }
    }
    requestAnimationFrame(tick);
  })`)
  console.log(`[${label}] FPS=${info.fps} 三角面=${info.triangles} drawCall=${info.calls} Mesh数=${info.meshes}`)
}

await sample('基线（演示灯组）')

// 注入 8 万三角面（200x200 平面，80000 三角形）模拟加密龙身
await evalJs(`(function(){
  const D = window.__LANTERN_DEBUG__;
  const seg = 200;
  const vertCount = (seg + 1) * (seg + 1);
  const pos = new Float32Array(vertCount * 3);
  let p = 0;
  for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) {
    pos[p++] = (i / seg - 0.5) * 8; pos[p++] = (j / seg - 0.5) * 8; pos[p++] = 0;
  }
  const idx = [];
  for (let j = 0; j < seg; j++) for (let i = 0; i < seg; i++) {
    const a = j * (seg + 1) + i, b = a + 1, d = a + seg + 1, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const heavy = D.makeMesh(pos, idx);
  heavy.position.set(0, 2, -2);
  heavy.name = 'perf-heavy';
  D.viewport.scene.add(heavy);
})()`)
await wait(500)
await sample('高面数（注入 80k 三角面）')

await evalJs(`(function(){
  const D = window.__LANTERN_DEBUG__;
  const twin = D.viewport.scene.getObjectByName('perf-heavy').clone();
  twin.name = 'perf-heavy-2';
  twin.position.z = 2;
  D.viewport.scene.add(twin);
})()`)
await wait(500)
await sample('极高面数（叠加 160k 三角面）')

ws.close()
console.log('注：headless 为 SwiftShader 软件渲染，真机 GPU FPS 通常高一个数量级以上')
