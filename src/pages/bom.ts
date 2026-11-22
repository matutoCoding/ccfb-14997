// 下料单页：钢丝/焊点/布料/灯带统计，浏览器打印
import { store } from '../core/store'
import { buildBom } from '../core/bom'
import { fmt, fmtInt, toast } from '../ui/feedback'
import { icon } from '../ui/icons'

export async function renderBom(root: HTMLElement): Promise<void> {
  const doc = store.currentLantern
  if (!doc) {
    root.innerHTML = `<div class="empty-state" style="margin-top:64px;"><div class="icon-line">${icon('bom', 24)}</div><h3 style="margin:0 0 8px;">未选择灯组</h3><p style="margin:0;">先到灯组列表打开灯组</p></div>`
    return
  }
  const bom = await buildBom(doc)
  root.innerHTML = `
    <div class="page-narrow">
      <div class="row" style="justify-content:space-between;margin-bottom:24px;" id="bom-toolbar">
        <div>
          <h2 style="margin:0;font-size:22px;">下料单：${doc.name}</h2>
          <p class="muted" style="margin:4px 0 0;">生成时间 ${bom.generatedAt} · 布料含 8% 搭接余量 · 数据来自当前保存的灯组文档</p>
        </div>
        <button class="primary" id="btn-print">${icon('print', 16)} 打印 / 导出 PDF</button>
      </div>

      <div class="stat-grid" style="margin-bottom:24px;">
        <div class="stat"><div class="label">钢丝总长</div><div class="value">${fmt(bom.total.wireLengthM)} m</div></div>
        <div class="stat"><div class="label">焊点总数</div><div class="value">${fmtInt(bom.total.welds)} 个</div></div>
        <div class="stat"><div class="label">绸布总面积</div><div class="value">${fmt(bom.total.fabricM2, 2)} m²</div></div>
        <div class="stat"><div class="label">灯带总长</div><div class="value">${fmt(bom.total.stripM, 2)} m</div></div>
        <div class="stat"><div class="label">点光源</div><div class="value">${fmtInt(bom.total.pointCount)} 颗</div></div>
        <div class="stat"><div class="label">电气总功率</div><div class="value">${fmt(bom.total.powerW)} W</div></div>
        <div class="stat"><div class="label">骨架自重</div><div class="value">${fmt(bom.total.weightKg)} kg</div></div>
      </div>

      <div class="card" id="print-area" style="padding:0;overflow:hidden;">
        <table class="table">
          <thead>
            <tr>
              <th>分段</th><th>钢丝 m</th><th>焊点 个</th><th>绸布 m²</th><th>灯带 m</th><th>点光源 颗</th><th>功率 W</th><th>自重 kg</th>
            </tr>
          </thead>
          <tbody>
            ${bom.rows
              .map(
                (r) => `
              <tr>
                <td><strong>${r.name}</strong></td>
                <td>${fmt(r.wireLengthM)}</td>
                <td>${fmtInt(r.welds)}</td>
                <td>${fmt(r.fabricM2, 2)}</td>
                <td>${fmt(r.stripM, 2)}</td>
                <td>${fmtInt(r.pointCount)}</td>
                <td>${fmt(r.powerW)}</td>
                <td>${fmt(r.weightKg)}</td>
              </tr>`
              )
              .join('')}
            <tr style="background:var(--slate-50);font-weight:600;">
              <td>合计</td>
              <td>${fmt(bom.total.wireLengthM)}</td>
              <td>${fmtInt(bom.total.welds)}</td>
              <td>${fmt(bom.total.fabricM2, 2)}</td>
              <td>${fmt(bom.total.stripM, 2)}</td>
              <td>${fmtInt(bom.total.pointCount)}</td>
              <td>${fmt(bom.total.powerW)}</td>
              <td>${fmt(bom.total.weightKg)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="card" style="margin-top:24px;">
        <h3 style="margin:0 0 12px;font-size:16px;">施工备注</h3>
        <ul style="margin:0;padding-left:20px;color:var(--slate-600);font-size:14px;line-height:1.9;">
          <li>钢丝按直径规格分别领料，长度已含放样全部环箍、纵筋与斜筋，未计切口损耗，建议再备 3% 损耗量。</li>
          <li>焊点按节点连接数统计，同一节点多杆交汇只计一个焊点。</li>
          <li>绸布面积为三维展开面积加 8% 搭接，实际排料还要考虑门幅拼缝。</li>
          <li>灯带按 W/m 统计长度，点光源按颗统计；总功率用于配电箱与线径选型。</li>
        </ul>
      </div>
    </div>`

  root.querySelector('#btn-print')!.addEventListener('click', () => {
    toast('正在调用打印窗口')
    setTimeout(() => window.print(), 200)
  })
}
