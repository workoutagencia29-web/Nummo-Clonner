/**
 * Miniaturas dos modelos: um esboço em SVG (320 × 240) com as cores e a
 * estrutura de cada página. Leves e sem imagens externas.
 */

const W = 320;
const H = 240;

const rect = (x: number, y: number, w: number, h: number, fill: string, r = 0, extra = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"${extra}/>`;

/** Linhas de texto centralizadas (larguras em px). */
function lines(cx: number, y: number, widths: number[], fill: string, h = 7, gap = 12) {
  return widths.map((w, i) => rect(cx - w / 2, y + i * gap, w, h, fill, h / 2)).join("");
}

/** Linhas de texto alinhadas à esquerda. */
function linesLeft(x: number, y: number, widths: number[], fill: string, h = 6, gap = 11) {
  return widths.map((w, i) => rect(x, y + i * gap, w, h, fill, h / 2)).join("");
}

function play(cx: number, cy: number, r: number) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" fill-opacity=".18" stroke="#ffffff" stroke-opacity=".6"/><path d="M${cx - r * 0.3} ${cy - r * 0.45}L${cx + r * 0.5} ${cy}L${cx - r * 0.3} ${cy + r * 0.45}z" fill="#fff"/>`;
}

function imageIcon(cx: number, cy: number, color: string) {
  return `<g fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"><rect x="${cx - 12}" y="${cy - 9}" width="24" height="18" rx="3"/><path d="M${cx - 10} ${cy + 7}l7-7 5 4 4-3 6 6"/></g>`;
}

function svg(content: string, bg = "#ffffff") {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${rect(0, 0, W, H, bg)}${content}</svg>`;
}

/** Faixa de aviso, cabeçalho de loja amarelo e linha de categorias (modelos da loja). */
function storeHeader() {
  return (
    rect(0, 0, W, 7, "#08793c") +
    rect(0, 7, W, 28, "#ffe94d") +
    rect(10, 13, 40, 15, "#ffffff", 4, ' stroke="#9aa3b2" stroke-dasharray="3 2"') +
    rect(60, 13, 196, 15, "#ffffff", 3) +
    rect(64, 18.5, 70, 4, "#cbd5e1", 2) +
    `<g fill="none" stroke="#333" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M276 15.5h3l3 10h10l2-7h-13"/><circle cx="284" cy="28" r="1.2"/><circle cx="291" cy="28" r="1.2"/></g>` +
    rect(0, 35, W, 12, "#ffe94d") +
    [0, 1, 2, 3, 4].map((i) => rect(12 + i * 46, 39, 34, 4, "#7a6f1c", 2)).join("")
  );
}

/** Cartão de produto em miniatura (foto, nome, preço). */
function miniCard(x: number, y: number, w: number, h: number, fill = "#ffffff") {
  const photo = Math.min(w - 8, h * 0.5);
  return (
    rect(x, y, w, h, fill, 3) +
    rect(x + (w - photo) / 2, y + 4, photo, photo, "#e8ebf2", 2) +
    rect(x + 4, y + photo + 8, w - 10, 3, "#94a3b8", 1.5) +
    rect(x + 4, y + photo + 14, w * 0.5, 5, "#333333", 2) +
    rect(x + 4, y + photo + 22, w * 0.4, 3, "#00863f", 1.5)
  );
}

export const THUMBNAILS: Record<string, string> = {
  loja: svg(
    storeHeader() +
      rect(10, 53, 300, 40, "#dbe4ff", 5) +
      imageIcon(160, 73, "#4f46e5") +
      rect(10, 99, 86, 78, "#ffffff", 4) +
      rect(16, 105, 40, 5, "#1f2937", 2) +
      miniCard(16, 115, 74, 58, "#ffffff") +
      rect(102, 99, 208, 78, "#ffffff", 4) +
      rect(108, 105, 30, 5, "#1f2937", 2) +
      rect(142, 105.5, 50, 4, "#1f63d6", 2) +
      [0, 1, 2, 3].map((i) => miniCard(108 + i * 49, 115, 44, 58)).join("") +
      `<circle cx="304" cy="135" r="7" fill="#ffffff" stroke="#d1d5db"/><path d="M302.5 132l3 3-3 3" fill="none" stroke="#1f63d6" stroke-width="1.4"/>` +
      rect(0, 184, W, 50, "#1462d6") +
      rect(10, 189, 90, 5, "#ffffff", 2.5) +
      [0, 1, 2, 3, 4, 5].map((i) => miniCard(10 + i * 51, 198, 46, 34, "#ffffff")).join(""),
    "#ededed",
  ),
  produto: svg(
    storeHeader() +
      rect(8, 52, 304, 188, "#ffffff", 5) +
      rect(16, 58, 54, 4, "#1f63d6", 2) +
      [0, 1, 2].map((i) => rect(16, 68 + i * 20, 16, 16, "#ffffff", 2, ' stroke="#d1d5db"')).join("") +
      rect(38, 68, 116, 116, "#e8ebf2", 4) +
      imageIcon(96, 126, "#a3abbd") +
      rect(162, 68, 142, 128, "#ffffff", 4, ' stroke="#e5e7eb"') +
      linesLeft(170, 76, [120, 92], "#1f2937", 6, 10) +
      `<text x="170" y="104" font-family="Arial,sans-serif" font-size="9" fill="#f5a623">★★★★★</text>` +
      rect(170, 110, 44, 4, "#94a3b8", 2) +
      rect(170, 118, 62, 12, "#333333", 3) +
      rect(236, 120, 22, 6, "#00863f", 3) +
      rect(170, 136, 80, 4, "#00863f", 2) +
      rect(170, 146, 126, 16, "#1f63d6", 3) +
      linesLeft(176, 170, [90, 104, 80], "#94a3b8", 3, 8) +
      rect(16, 204, 60, 6, "#1f2937", 3) +
      linesLeft(16, 216, [288, 260, 200], "#cbd5e1", 4, 8),
    "#ededed",
  ),
  "vendas-longa": svg(
    rect(0, 0, W, 12, "#f59e0b") +
      rect(0, 12, W, 140, "#0b1220") +
      rect(128, 24, 64, 9, "#1f2937", 4.5) +
      lines(160, 42, [210, 170], "#ffffff", 10, 15) +
      rect(185, 57, 40, 10, "#f59e0b", 5) +
      lines(160, 78, [150], "#64748b", 5) +
      rect(88, 90, 144, 38, "#1e293b", 6) +
      imageIcon(160, 109, "#64748b") +
      rect(122, 134, 76, 12, "#16a34a", 4) +
      lines(160, 166, [150], "#0f172a", 8) +
      [0, 1, 2].map((i) => rect(28 + i * 92, 184, 80, 50, "#f4f6fb", 6, ' stroke="#e3e8f0"')).join("") +
      [0, 1, 2]
        .map(
          (i) => rect(38 + i * 92, 194, 16, 16, "#dcfce7", 4) + linesLeft(38 + i * 92, 216, [52, 40], "#cbd5e1", 4, 8),
        )
        .join(""),
  ),
  vsl: svg(
    rect(0, 0, W, H, "#05070d") +
      `<circle cx="126" cy="21" r="3.5" fill="#ef4444"/>` +
      rect(134, 18, 64, 6, "#fca5a5", 3) +
      lines(160, 34, [230, 180], "#ffffff", 9, 14) +
      rect(48, 66, 224, 118, "#111827", 8, ' stroke="#1f2937"') +
      play(160, 125, 20) +
      rect(64, 196, 192, 20, "#f97316", 5) +
      lines(160, 224, [120], "#475569", 5),
    "#05070d",
  ),
  quiz: svg(
    rect(0, 0, W, 22, "#ffffff") +
      rect(130, 8, 60, 6, "#1e1b4b", 3) +
      rect(0, 22, W, H - 22, "#f5f3ff") +
      lines(160, 36, [190, 140], "#1e1b4b", 9, 14) +
      rect(70, 70, 180, 160, "#ffffff", 12, ' stroke="#e9e5f5"') +
      rect(84, 84, 30, 6, "#cbd5e1", 3) +
      rect(122, 85, 114, 5, "#ede9fe", 2.5) +
      rect(122, 85, 46, 5, "#7c3aed", 2.5) +
      lines(160, 104, [120], "#1e293b", 8) +
      [0, 1, 2, 3]
        .map(
          (i) =>
            rect(
              86,
              122 + i * 26,
              148,
              20,
              i === 1 ? "#f5f3ff" : "#ffffff",
              6,
              ` stroke="${i === 1 ? "#7c3aed" : "#e5e7eb"}" stroke-width="1.5"`,
            ) +
            `<circle cx="98" cy="${132 + i * 26}" r="4" fill="${i === 1 ? "#7c3aed" : "#e5e7eb"}"/>` +
            rect(108, 129 + i * 26, 70 - (i % 2) * 14, 6, "#64748b", 3) +
            `<circle cx="222" cy="${132 + i * 26}" r="5" fill="${i === 1 ? "#7c3aed" : "#ffffff"}" stroke="${i === 1 ? "#7c3aed" : "#cbd5e1"}" stroke-width="1.5"/>`,
        )
        .join(""),
  ),
  roleta: svg(
    rect(0, 0, W, 22, "#ffffff") +
      rect(130, 8, 60, 6, "#1e1b4b", 3) +
      rect(0, 22, W, H - 22, "#f5f3ff") +
      rect(70, 32, 180, 200, "#ffffff", 12, ' stroke="#e9e5f5"') +
      lines(160, 44, [120], "#1e1b4b", 8) +
      `<circle cx="160" cy="122" r="58" fill="#1e1b4b"/>` +
      ["#7c3aed", "#f59e0b", "#ec4899", "#10b981", "#7c3aed", "#f59e0b", "#ec4899", "#10b981"]
        .map((c, i) => {
          const a0 = ((i * 45 - 90) * Math.PI) / 180;
          const a1 = (((i + 1) * 45 - 90) * Math.PI) / 180;
          const p = (a: number) => `${(160 + Math.cos(a) * 52).toFixed(1)} ${(122 + Math.sin(a) * 52).toFixed(1)}`;
          return `<path d="M160 122L${p(a0)}A52 52 0 0 1 ${p(a1)}Z" fill="${c}"/>`;
        })
        .join("") +
      `<circle cx="160" cy="122" r="10" fill="#ffffff" stroke="#1e1b4b" stroke-width="3"/>` +
      `<path d="M152 58h16l-8 14z" fill="#f43f5e"/>` +
      rect(96, 194, 128, 22, "#16a34a", 6) +
      lines(160, 202, [64], "#ffffff", 6),
  ),
  captura: svg(
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#312e81"/><stop offset="1" stop-color="#0f0c2e"/></linearGradient></defs>` +
      rect(0, 0, W, H, "url(#g)") +
      rect(22, 34, 60, 9, "#4338ca", 4.5) +
      linesLeft(22, 52, [132, 118, 90], "#ffffff", 9, 14) +
      linesLeft(22, 100, [120, 100], "#a5b4fc", 5, 10) +
      [0, 1, 2]
        .map(
          (i) =>
            `<circle cx="27" cy="${131 + i * 14}" r="4" fill="#22c55e"/>` +
            rect(36, 128 + i * 14, 96 - i * 12, 6, "#c7d2fe", 3),
        )
        .join("") +
      rect(22, 178, 60, 12, "#1e1b4b", 6) +
      rect(176, 26, 124, 188, "#ffffff", 10) +
      rect(188, 38, 100, 36, "#e0e7ff", 5) +
      linesLeft(188, 82, [88, 64], "#1e293b", 6, 10) +
      [0, 1, 2].map((i) => rect(188, 104 + i * 22, 100, 16, "#ffffff", 4, ' stroke="#cbd5e1"')).join("") +
      rect(188, 172, 100, 20, "#4f46e5", 5) +
      rect(204, 200, 68, 4, "#cbd5e1", 2),
  ),
  upsell: svg(
    rect(0, 0, W, 16, "#f59e0b") +
      rect(100, 28, 120, 6, "#e3e8f0", 3) +
      rect(100, 28, 80, 6, "#16a34a", 3) +
      lines(160, 46, [220, 170], "#0f172a", 9, 14) +
      [0, 1, 2].map((i) => rect(116 + i * 30, 80, 26, 26, "#0f172a", 5)).join("") +
      rect(84, 116, 152, 98, "#ffffff", 10, ' stroke="#16a34a" stroke-width="2.5"') +
      rect(126, 110, 68, 12, "#f59e0b", 6) +
      lines(160, 132, [90, 76], "#cbd5e1", 5, 10) +
      lines(160, 156, [70], "#16a34a", 14) +
      rect(100, 180, 120, 18, "#16a34a", 4) +
      lines(160, 224, [110], "#94a3b8", 4),
    "#ffffff",
  ),
  downsell: svg(
    rect(0, 0, W, 16, "#38bdf8") +
      rect(100, 28, 120, 6, "#e3e8f0", 3) +
      rect(100, 28, 80, 6, "#0d9488", 3) +
      lines(160, 46, [220, 180], "#0f172a", 9, 14) +
      rect(80, 82, 160, 40, "#f0fdfa", 6) +
      imageIcon(160, 102, "#5eead4") +
      rect(84, 132, 152, 84, "#ffffff", 10, ' stroke="#0d9488" stroke-width="2.5"') +
      lines(160, 146, [90], "#cbd5e1", 5) +
      lines(160, 162, [64], "#0d9488", 14) +
      rect(100, 186, 120, 18, "#0d9488", 4) +
      lines(160, 226, [110], "#94a3b8", 4),
  ),
  obrigado: svg(
    rect(0, 0, W, 104, "#f1f7f3") +
      `<circle cx="160" cy="36" r="18" fill="#16a34a" stroke="#dcfce7" stroke-width="6"/><path d="M151 36l6 6 12-12" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>` +
      lines(160, 64, [200], "#0f172a", 10) +
      lines(160, 84, [160], "#94a3b8", 5) +
      [0, 1, 2]
        .map(
          (i) =>
            rect(60, 114 + i * 26, 200, 20, "#ffffff", 5, ' stroke="#e3e8f0"') +
            `<circle cx="72" cy="${124 + i * 26}" r="6" fill="#16a34a"/>` +
            rect(84, 121 + i * 26, 120 - i * 16, 6, "#cbd5e1", 3),
        )
        .join("") +
      rect(60, 194, 200, 38, "#0b3d24", 8) +
      rect(100, 208, 120, 14, "#1fae54", 4),
  ),
  advertorial: svg(
    rect(0, 0, W, 10, "#f1f1ee") +
      lines(160, 3, [46], "#b8b8b0", 4) +
      `<text x="20" y="31" font-family="Georgia,serif" font-size="15" font-weight="700" fill="#111418">Portal</text>` +
      [0, 1, 2].map((i) => rect(212 + i * 30, 23, 24, 5, "#9ca3af", 2.5)).join("") +
      rect(0, 40, W, 1, "#e4e4df") +
      rect(56, 52, 40, 5, "#c81e1e", 2.5) +
      linesLeft(56, 64, [208, 180], "#111418", 9, 14) +
      linesLeft(56, 96, [200, 150], "#9ca3af", 5, 9) +
      rect(56, 118, 208, 60, "#eef2f7", 4) +
      imageIcon(160, 148, "#94a3b8") +
      linesLeft(56, 186, [208, 196, 204], "#cbd5e1", 4, 8) +
      rect(56, 212, 208, 24, "#f3faf5", 4, ' stroke="#15803d"') +
      rect(116, 218, 88, 12, "#15803d", 3),
  ),
  "politica-privacidade": svg(
    rect(0, 0, W, 74, "#f4f6fb") +
      `<path d="M40 22l16-6 16 6v13c0 10-7 17-16 21-9-4-16-11-16-21z" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><rect x="50" y="32" width="12" height="10" rx="2" fill="#2563eb"/><path d="M52 32v-3a4 4 0 018 0v3" fill="none" stroke="#2563eb" stroke-width="2"/>` +
      linesLeft(88, 28, [150], "#0f172a", 10) +
      linesLeft(88, 46, [90], "#94a3b8", 5) +
      rect(40, 90, 110, 7, "#0f172a", 3.5) +
      linesLeft(40, 104, [240, 228, 236, 160], "#cbd5e1", 4, 9) +
      rect(40, 150, 90, 7, "#0f172a", 3.5) +
      linesLeft(40, 164, [236, 220, 240, 120], "#cbd5e1", 4, 9) +
      rect(40, 208, 34, 7, "#fde047", 3) +
      linesLeft(80, 209, [160], "#cbd5e1", 4),
  ),
  "termos-de-uso": svg(
    rect(0, 0, W, 74, "#f4f6fb") +
      `<g fill="none" stroke="#2563eb" stroke-width="2" stroke-linejoin="round"><path d="M44 14h20l10 10v32H44z" fill="#dbeafe"/><path d="M64 14v10h10"/><path d="M50 32h18M50 39h18M50 46h12"/></g>` +
      linesLeft(88, 28, [120], "#0f172a", 10) +
      linesLeft(88, 46, [90], "#94a3b8", 5) +
      rect(40, 90, 80, 7, "#0f172a", 3.5) +
      linesLeft(40, 104, [240, 232, 180], "#cbd5e1", 4, 9) +
      rect(40, 140, 120, 7, "#0f172a", 3.5) +
      linesLeft(40, 154, [236, 240, 210, 120], "#cbd5e1", 4, 9) +
      rect(40, 200, 70, 7, "#0f172a", 3.5) +
      linesLeft(40, 214, [230, 140], "#cbd5e1", 4, 9),
  ),
};
