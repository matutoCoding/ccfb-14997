// 轻量交互反馈：toast / confirm modal / 数字格式化
export function toast(message: string, ms = 2400): void {
  const el = document.createElement('div')
  el.className = 'toast'
  el.textContent = message
  document.body.appendChild(el)
  setTimeout(() => {
    el.remove()
  }, ms)
}

export function confirmDialog(title: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    const mask = document.createElement('div')
    mask.className = 'modal-mask'
    mask.innerHTML = `
      <div class="modal">
        <h3 style="margin:0 0 12px;font-size:18px;">${title}</h3>
        <p class="muted" style="font-size:15px;color:var(--slate-700);">${content}</p>
        <div class="row" style="justify-content:flex-end;margin-top:24px;">
          <button data-act="cancel">取消</button>
          <button class="primary" data-act="ok">确认</button>
        </div>
      </div>`
    const close = (ok: boolean): void => {
      mask.remove()
      resolve(ok)
    }
    mask.addEventListener('click', (e) => {
      const target = e.target as HTMLElement
      if (target === mask) close(false)
      const act = target.closest('[data-act]')?.getAttribute('data-act')
      if (act === 'ok') close(true)
      if (act === 'cancel') close(false)
    })
    document.body.appendChild(mask)
  })
}

export function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '0'
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('zh-CN')
}

// 深拷贝结构化数据（文档全是纯 JSON）
export function cloneDoc<T>(v: T): T {
  return structuredClone(v)
}
