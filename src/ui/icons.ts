// 统一线性图标：1.7 线宽、圆角端点、currentColor 继承
const PATH: Record<string, string> = {
  lantern: 'M12 2c2 2.5 3.5 4 3.5 7v1c2.2 1.2 3.5 3.4 3.5 6a7 7 0 1 1-14 0c0-2.6 1.3-4.8 3.5-6V9c0-3 1.5-4.5 3.5-7z M9.5 20h5',
  project: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  skeleton: 'M4 20 L10 6 L16 14 L20 8 M10 6a1.5 1.5 0 1 0 0-0.1 M16 14a1.5 1.5 0 1 0 0-0.1',
  fabric: 'M4 5c4-2 12-2 16 0v14c-4-2-12-2-16 0V5z M4 5v14 M20 5v14 M12 3v18',
  light: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z',
  preview: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  bom: 'M6 2h9l5 5v15H6V2z M14 2v6h6 M9 13h6 M9 17h6',
  plus: 'M12 5v14 M5 12h14',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14',
  save: 'M5 3h11l3 3v15H5V3z M8 3v6h7V3 M8 21v-8h8v8',
  print: 'M7 8V3h10v5 M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M7 14h10v7H7v-7z',
  warn: 'M12 3 2 20h20L12 3z M12 10v4 M12 17.5v.1',
  target: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  refresh: 'M20 11a8 8 0 1 0-2.3 6.3 M20 5v6h-6'
}

export function icon(name: keyof typeof PATH, size = 18): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATH[name]}"/></svg>`
}
