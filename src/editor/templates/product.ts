/**
 * Modelo: Página do produto — uma página por produto da loja: cabeçalho de
 * loja, "‹ Voltar para a loja", galeria de fotos (4 fotos provisórias) e caixa
 * de compra lado a lado (também no tablet em pé; empilham no celular, com a
 * barra de compra fixa embaixo), "Descrição", "Características principais" (tabela) e "Opiniões
 * do produto" — com opiniões PROVISÓRIAS que pedem para ser trocadas pelas de
 * clientes reais (nada de depoimento inventado que pareça real; a nota média
 * é a avaliação do produto, a mesma da caixa de compra) — e o rodapé.
 * A galeria e a caixa de compra são as mesmas dos blocos da categoria "Loja"
 * (src/editor/widgets/product-page-content.ts), já desenhadas.
 *
 * Ganchos para a criação automática das páginas a partir dos cartões da
 * vitrine: PRODUCT_PAGE_HOOKS (cabeçalho, logo, carrinho, "Voltar", galeria,
 * caixa de compra, h1 e "Comprar agora").
 *
 * O preço sai na moeda da oferta (productHtmlFor; o servidor escolhe em
 * pageStart). `productHtml` é o modelo em real (galeria, miniaturas, testes).
 */
import {
  BACK_ATTR,
  BUY_CSS,
  EXAMPLE_BUY,
  GALLERY_CSS,
  galleryDef,
  galleryPlaceholders,
  productBuyDef,
  scoreStars,
} from "@/editor/widgets/product-page-content";
import { defToHtml } from "@/editor/widgets/quiz-content";
import { STORE_HEADER_CSS, storeHeaderDef } from "@/editor/widgets/store-header-content";
import { DEFAULT_CURRENCY, ratingText, type StoreCurrency } from "@/lib/store";
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

const extra = `
body{font-size:16px;line-height:1.5}
.os-pp{padding:16px}
.os-pp-in{max-width:1200px;margin:0 auto;padding:16px 24px 28px;border-radius:8px;background:#ffffff}
.os-pd-back{display:inline-block;margin:0 0 14px;color:#1f63d6;font-size:14px;font-weight:600;text-decoration:none}
.os-pd-back:hover{text-decoration:underline}
.os-pp-top{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:32px;align-items:start}
.os-pp-sec{margin:36px 0 0;padding:28px 0 0;border-top:1px solid #e5e7eb}
.os-pp-h2{margin:0 0 14px;color:#1f2937;font-size:22px;font-weight:600;letter-spacing:normal}
.os-pp-sec p{margin:0 0 12px;font-size:16px;color:#4b5563}
.os-pp-specs{width:100%;max-width:720px;border-collapse:collapse;font-size:15px}
.os-pp-specs th,.os-pp-specs td{padding:10px 14px;text-align:left;vertical-align:top}
.os-pp-specs th{width:40%;background:#f3f4f6;color:#1f2937;font-weight:600}
.os-pp-specs td{color:#4b5563}
.os-pp-specs tr:nth-child(even) th{background:#e9ebef}
.os-pp-specs tr:nth-child(even) td{background:#f9fafb}
.os-pp-reviews{display:flex;align-items:flex-start}
.os-pp-score{flex:0 0 200px;margin:0 28px 0 0;text-align:left}
.os-pp-list{flex:1 1 auto;min-width:0}
.os-pp-sec .os-pp-avg{margin:0;color:#1f2937;font-size:46px;font-weight:600;line-height:1}
.os-pp-sec .os-pp-stars{margin:6px 0 4px;color:#f5a623;font-size:18px;letter-spacing:2px;line-height:1}
.os-pp-sec .os-pp-note{font-size:13px;color:#6b7280}
.os-pp-review{margin:0 0 16px;padding:0 0 16px;border-bottom:1px solid #f0f0f0}
.os-pp-sec .os-pp-who{margin:0;font-size:13px;color:#6b7280}
[data-gjs-type].os-pp-todo{background-color:#fef9c3;box-shadow:0 0 0 1px #eab308;border-radius:3px}
.os-pp-specs [data-gjs-type].os-pp-todo{background-color:#fef9c3}
.os-footer{border-top:1px solid #e5e7eb}
@media (max-width:768px){.os-pp{padding:0}.os-pp-in{padding:12px 12px 24px;border-radius:0}.os-pp-top{gap:16px}.os-pp-reviews{flex-direction:column;align-items:stretch}.os-pp-score{flex:0 0 auto;margin:0 0 16px}.os-pp-specs th{width:45%}}
@media (max-width:600px){.os-pp-top{grid-template-columns:minmax(0,1fr)}}
${STORE_HEADER_CSS}
${GALLERY_CSS}
${BUY_CSS}`;

/** A nota média de "Opiniões do produto" é a do produto (a mesma da caixa de compra). */
const EXAMPLE_RATING = EXAMPLE_BUY.data.rating ?? 0;

const SPECS: [string, string][] = [
  ["Marca", "Sua marca"],
  ["Modelo", "Nome do modelo"],
  ["Cor", "Preto"],
  ["Material", "Escreva o material"],
  ["Conteúdo da embalagem", "1 produto, manual e cabo de carregamento"],
  ["Garantia", "90 dias"],
];

/** Opinião provisória: o texto pede para trocar por uma opinião de cliente real. */
const review = () =>
  `<article class="os-pp-review"><p class="os-pp-stars" aria-hidden="true">★★★★★</p>` +
  `<p class="os-pp-todo">Escreva aqui a opinião de um cliente real.</p>` +
  `<p class="os-pp-who os-pp-todo">Nome do cliente</p></article>`;

const body = (currency: StoreCurrency) => `
${defToHtml(storeHeaderDef({}, { html: true }))}
<main class="os-pp">
<div class="os-pp-in">
<a href="#" class="os-pd-back" ${BACK_ATTR}="">‹ Voltar para a loja</a>
<div class="os-pp-top">
<div class="os-pp-gal">${defToHtml(galleryDef(galleryPlaceholders(4), { html: true }))}</div>
<div class="os-pp-buy">${defToHtml(productBuyDef({ ...EXAMPLE_BUY, currency }, { html: true }))}</div>
</div>
<section class="os-pp-sec">
<h2 class="os-pp-h2">Descrição</h2>
<p class="os-pp-todo">Escreva aqui a descrição do produto: para que serve, para quem é, o que vem na caixa e por que vale a pena. Textos curtos e diretos ajudam quem está decidindo a compra.</p>
<p class="os-pp-todo">Use um parágrafo para cada assunto (uso no dia a dia, diferenciais, cuidados) e deixe as medidas e os dados técnicos na tabela abaixo.</p>
</section>
<section class="os-pp-sec">
<h2 class="os-pp-h2">Características principais</h2>
<table class="os-pp-specs"><tbody>
${SPECS.map(([k, v]) => `<tr><th scope="row">${k}</th><td class="os-pp-todo">${v}</td></tr>`).join("\n")}
</tbody></table>
</section>
<section class="os-pp-sec">
<h2 class="os-pp-h2">Opiniões do produto</h2>
<div class="os-pp-reviews">
<div class="os-pp-score"><p class="os-pp-avg os-pp-todo">${ratingText(EXAMPLE_RATING, currency)}</p><p class="os-pp-stars" aria-hidden="true">${scoreStars(EXAMPLE_RATING)}</p><p class="os-pp-note">Nota média das opiniões de clientes</p></div>
<div class="os-pp-list">
${review()}
${review()}
${review()}
</div>
</div>
</section>
</div>
</main>

${footer({ links: true })}
`;

const built = new Map<StoreCurrency, string>();

/** O modelo com o preço da caixa de compra na moeda `currency` (a da oferta). */
export function productHtmlFor(currency: StoreCurrency): string {
  let html = built.get(currency);
  if (!html) {
    html = pageDocument({ title: "Página do produto", css: buildCss(t, ["footer"], extra), body: body(currency) });
    built.set(currency, html);
  }
  return html;
}

export const productHtml = productHtmlFor(DEFAULT_CURRENCY);
