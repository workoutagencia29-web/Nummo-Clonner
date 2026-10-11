/**
 * Modelo: Loja (vitrine) — página inicial de uma loja no estilo marketplace:
 * cabeçalho de loja (logo, pesquisa, carrinho, categorias), banner largo, a
 * "Oferta do dia + ofertas", "Mais vendidos" (grade), a "Faixa de ofertas", a
 * "Lista de ofertas do dia", uma faixa de vantagens e o rodapé com os links
 * legais. As vitrines e o cabeçalho são os mesmos dos blocos da categoria
 * "Loja" (src/editor/blocks/store.ts), com as partes geradas já desenhadas.
 * Os produtos de exemplo nascem sem a página deles: o canvas, o ZIP e o
 * "Próximos passos" avisam.
 *
 * As cores próprias de uma vitrine (faixa azul, painéis brancos) vão no
 * style="" dela, como num bloco solto: o CSS do tipo da vitrine fica fora de
 * camada no editor e venceria uma regra do modelo (que vai para a folha base).
 *
 * Os preços saem na moeda da oferta (storeHtmlFor; o servidor escolhe em
 * pageStart). `storeHtml` é o modelo em real (galeria, miniaturas, testes).
 */
import { dayDealRow, SHOWCASES } from "@/editor/blocks/store";
import { PRODUCTS_CSS, productsDef } from "@/editor/widgets/products-content";
import { defToHtml } from "@/editor/widgets/quiz-content";
import { STORE_HEADER_CSS, storeHeaderDef } from "@/editor/widgets/store-header-content";
import { DEFAULT_CURRENCY, type StoreCurrency } from "@/lib/store";
import { placeholderImage } from "./assets";
import { pageDocument } from "./document";
import { buildCss, theme } from "./styles";
import { footer } from "./widgets";

const t = theme({
  bg: "#ededed",
  ink: "#333333",
  heading: "#1f2937",
  footerBg: "#ffffff",
  footerInk: "#4b5563",
});

/**
 * Título da página (h1): na página, só para o Google e os leitores de tela (as
 * lojas de marketplace não mostram um título no topo); no editor, aparece com
 * um rótulo para dar para trocar o texto.
 */
const H1_HIDDEN =
  "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0";

const extra = `
body{font-size:16px;line-height:1.45}
.os-lj-h1{${H1_HIDDEN};font-size:28px}
[data-gjs-type].os-lj-h1{position:static;width:auto;height:auto;max-width:1200px;margin:12px auto 0;padding:6px 12px;overflow:visible;clip:auto;white-space:normal;border:1px dashed #a78bfa;border-radius:6px;font-size:18px;font-weight:700;letter-spacing:normal}
[data-gjs-type].os-lj-h1::before{content:"Título da página (só aparece para o Google e leitores de tela): ";font:600 12px/1.3 system-ui,-apple-system,sans-serif;color:#5b21b6}
.os-lj-banner{padding:16px 16px 0}
.os-lj-banner-img{display:block;width:100%;max-width:1200px;height:auto;margin:0 auto;border-radius:8px}
.os-lj-day{padding:24px 16px 8px}
.os-lj-perks{margin:24px 0 0;padding:28px 16px;background:#ffffff}
.os-lj-perks-in{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;max-width:1200px;margin:0 auto}
.os-lj-perk{display:flex;align-items:flex-start}
.os-lj-perk-ico{flex:0 0 auto;margin:0 12px 0 0;font-size:30px;line-height:1}
.os-lj-perk h3{margin:0 0 4px;color:#1f2937;font-size:17px;font-weight:700;letter-spacing:normal}
.os-lj-perk p{margin:0;color:#4b5563;font-size:14px;line-height:1.45}
.os-footer{border-top:1px solid #e5e7eb}
@media (max-width:768px){.os-lj-banner{padding:8px 0 0}.os-lj-banner-img{border-radius:0}.os-lj-day{padding:12px 0 0}.os-lj-perks-in{grid-template-columns:minmax(0,1fr);gap:16px}}
${STORE_HEADER_CSS}
${PRODUCTS_CSS}`;

const perk = (icon: string, title: string, text: string) =>
  `<div class="os-lj-perk"><span class="os-lj-perk-ico" aria-hidden="true">${icon}</span><div><h3>${title}</h3><p>${text}</p></div></div>`;

const body = (currency: StoreCurrency) => `
${defToHtml(storeHeaderDef({}, { html: true }))}
<h1 class="os-lj-h1"><span class="os-ph">{{EMPRESA}}</span>: ofertas do dia e mais vendidos</h1>
<section class="os-lj-banner"><img class="os-lj-banner-img" src="${placeholderImage("Banner da loja", 1200, 300, "cool")}" alt="Banner da loja"></section>
<section class="os-lj-day">${defToHtml(dayDealRow({ html: true, currency }))}</section>
${defToHtml(productsDef({ ...SHOWCASES.grid, currency }, { html: true }))}
${defToHtml(productsDef({ ...SHOWCASES.band, currency }, { html: true }))}
${defToHtml(productsDef({ ...SHOWCASES.dayList, currency }, { html: true }))}
<section class="os-lj-perks"><div class="os-lj-perks-in">
${perk("🚚", "Frete grátis", "Em todo o site, para todo o Brasil.")}
${perk("🔒", "Compra segura", "Pagamento protegido do começo ao fim.")}
${perk("↩️", "Devolução grátis", "Em até 7 dias depois de receber o produto.")}
</div></section>

${footer({ links: true })}
`;

const built = new Map<StoreCurrency, string>();

/** O modelo com os preços das vitrines na moeda `currency` (a da oferta). */
export function storeHtmlFor(currency: StoreCurrency): string {
  let html = built.get(currency);
  if (!html) {
    html = pageDocument({ title: "Loja", css: buildCss(t, ["footer"], extra), body: body(currency) });
    built.set(currency, html);
  }
  return html;
}

export const storeHtml = storeHtmlFor(DEFAULT_CURRENCY);
