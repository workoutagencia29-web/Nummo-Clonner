/** Modelos: upsell (oferta única depois da compra) e downsell (alternativa mais barata). */
import { placeholderImage } from "./assets";
import { pageDocument } from "./document";
import { buildCss, type TemplateTheme, theme } from "./styles";
import { buyButton, countdown, footer } from "./widgets";

const extra = `
.os-alert{margin:0;padding:12px 16px;background:var(--os-accent);color:var(--os-accent-ink);text-align:center;font-size:15px;font-weight:800;line-height:1.4}
.os-progress{max-width:560px;margin:0 auto 40px}
.os-progress__bar{height:10px;border-radius:999px;background:var(--os-line);overflow:hidden}
.os-progress__fill{width:66%;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--os-primary),var(--os-accent))}
.os-progress__steps{display:flex;justify-content:space-between;gap:8px;margin:10px 0 0;padding:0;list-style:none;font-size:13px;font-weight:700;color:var(--os-muted)}
.os-progress__steps li:first-child{color:var(--os-primary)}
.os-upsell{padding:48px 0 72px}
.os-upsell .os-h1{font-size:clamp(28px,4.6vw,48px);max-width:900px;margin-left:auto;margin-right:auto}
.os-upsell .os-media{max-width:760px;margin-top:36px}
.os-timer-box{display:flex;flex-direction:column;align-items:center;margin:40px auto 0}
.os-decline{display:inline-block;margin-top:22px;color:var(--os-muted);font-size:15px;text-decoration:underline;text-underline-offset:3px}
.os-decline:hover{color:var(--os-heading)}
@media (max-width:480px){.os-progress__steps{font-size:11.5px}}`;

interface OfferPageOptions {
  theme: TemplateTheme;
  title: string;
  alert: string;
  steps: [string, string, string];
  eyebrow: string;
  headline: string;
  lead: string;
  image: string;
  timer?: { label: string; minutes: number };
  offerBadge: string;
  offerTitle: string;
  items: string[];
  priceFrom: string;
  installments: string;
  price: string;
  cash: string;
  yes: string;
  yesNote: string;
  no: string;
  reassurance: string;
}

function offerPage(o: OfferPageOptions) {
  const timer = o.timer
    ? `<div class="os-timer-box"><p class="os-timer">${o.timer.label}</p>${countdown(o.timer.minutes)}</div>`
    : "";
  const body = `
<p class="os-alert">${o.alert}</p>

<section class="os-upsell">
<div class="os-container os-center">
<div class="os-progress">
<div class="os-progress__bar"><div class="os-progress__fill"></div></div>
<ul class="os-progress__steps"><li>✓ ${o.steps[0]}</li><li>${o.steps[1]}</li><li>${o.steps[2]}</li></ul>
</div>
<p class="os-eyebrow">${o.eyebrow}</p>
<h1 class="os-h1">${o.headline}</h1>
<p class="os-lead">${o.lead}</p>
<div class="os-media"><img src="${placeholderImage(o.image, 1200, 675, "warm")}" alt="Imagem da oferta"></div>
${timer}
<div class="os-offer">
<p class="os-badge">${o.offerBadge}</p>
<h3>${o.offerTitle}</h3>
<ul class="os-check">
${o.items.map((i) => `<li>${i}</li>`).join("\n")}
</ul>
<p class="os-price-from">${o.priceFrom}</p>
<p class="os-price-label">${o.installments}</p>
<p class="os-price">${o.price}</p>
<p class="os-price-cash">${o.cash}</p>
${buyButton(o.yes, { block: true, pulse: true })}
<p class="os-pay">${o.yesNote}</p>
</div>
<a href="#" class="os-decline">${o.no}</a>
</div>
</section>

<section class="os-section os-soft">
<div class="os-container os-narrow os-center">
<h2 class="os-h2">Por que esta oferta só aparece agora?</h2>
<p class="os-lead">${o.reassurance}</p>
</div>
</section>

${footer({ links: true })}
`;
  return pageDocument({
    title: o.title,
    css: buildCss(o.theme, ["button", "media", "lists", "offer", "countdown", "footer"], extra),
    body,
  });
}

export const upsellHtml = offerPage({
  theme: theme({
    primary: "#16a34a",
    accent: "#f59e0b",
    accentInk: "#1f1300",
  }),
  title: "Upsell",
  alert: "⚠️ Não feche esta página! Seu pedido ainda não está completo.",
  steps: ["Compra aprovada", "Oferta especial", "Acesso"],
  eyebrow: "Oferta única — só aparece agora",
  headline: "Parabéns pela sua compra! Antes de acessar, veja esta oferta exclusiva",
  lead: "Quem acabou de garantir o [produto principal] pode adicionar o [produto complementar] com um desconto que não será oferecido de novo.",
  image: "Imagem do produto complementar",
  timer: { label: "Esta oferta expira em:", minutes: 10 },
  offerBadge: "SÓ NESTA PÁGINA",
  offerTitle: "[Nome do produto complementar]",
  items: [
    "Benefício principal do produto complementar",
    "Como ele acelera o resultado da sua compra",
    "O que está incluído (aulas, materiais, bônus)",
    "Garantia de 7 dias também nesta oferta",
  ],
  priceFrom: "De <s>R$ 297,00</s> por apenas",
  installments: "12x de",
  price: "R$ 9,70",
  cash: "ou R$ 97,00 à vista",
  yes: "SIM, QUERO ADICIONAR AO MEU PEDIDO",
  yesNote: "🔒 Pagamento 100% seguro",
  no: "Não, obrigado. Quero abrir mão desta oferta.",
  reassurance:
    "Esta condição é um agradecimento para quem acabou de se tornar cliente. Se você sair desta página, ela não estará mais disponível com este valor.",
});

export const downsellHtml = offerPage({
  theme: theme({
    primary: "#0d9488",
    primarySoft: "#ccfbf1",
    primaryShadow: "rgba(13,148,136,.55)",
    accent: "#38bdf8",
    accentInk: "#062033",
    accentSoft: "#bae6fd",
  }),
  title: "Downsell",
  alert: "Espere! Temos uma última opção para você.",
  steps: ["Compra aprovada", "Última oferta", "Acesso"],
  eyebrow: "Uma alternativa mais acessível",
  headline: "Entendemos. Que tal começar com a versão essencial por um valor menor?",
  lead: "Você leva o principal do [produto complementar] — o suficiente para dar o próximo passo — por uma fração do valor.",
  image: "Imagem da versão essencial",
  offerBadge: "VERSÃO ESSENCIAL",
  offerTitle: "[Nome da versão essencial]",
  items: ["O conteúdo principal, direto ao ponto", "Acesso imediato depois da confirmação", "Garantia de 7 dias"],
  priceFrom: "De <s>R$ 97,00</s> por apenas",
  installments: "6x de",
  price: "R$ 8,17",
  cash: "ou R$ 47,00 à vista",
  yes: "SIM, QUERO A VERSÃO ESSENCIAL",
  yesNote: "🔒 Pagamento 100% seguro",
  no: "Não, obrigado. Vou continuar sem esta oferta.",
  reassurance:
    "Preparamos esta versão para quem quer os resultados mais importantes investindo menos. Ela só é oferecida uma vez, aqui.",
});
