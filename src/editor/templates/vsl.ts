/** Modelo: página de VSL (vídeo no topo + botão que aparece depois de um tempo). */
import { avatarImage } from "./assets";
import { pageDocument } from "./document";
import { buildCss, theme } from "./styles";
import { buyButton, footer, RESULTS_DISCLAIMER, safeList, videoSlot } from "./widgets";

const t = theme({
  primary: "#f97316",
  primarySoft: "#ffedd5",
  primaryShadow: "rgba(249,115,22,.6)",
  accent: "#facc15",
  accentInk: "#1a1400",
  accentSoft: "#fef08a",
  dark: "#05070d",
  heroGlow: "rgba(249,115,22,.16)",
});

const extra = `
.os-vsl{padding:40px 0 64px;text-align:center;background:radial-gradient(900px 420px at 50% 0,var(--os-hero-glow),transparent 70%),var(--os-dark)}
.os-vsl .os-h1{font-size:clamp(26px,4.2vw,44px);max-width:920px;margin:0 auto 28px}
.os-live{display:inline-flex;align-items:center;gap:10px;margin:0 0 18px;font-size:13px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:#fca5a5}
.os-live::before{content:"";width:10px;height:10px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 0 rgba(239,68,68,.7);animation:os-live 1.6s infinite}
@keyframes os-live{0%{box-shadow:0 0 0 0 rgba(239,68,68,.7)}70%{box-shadow:0 0 0 10px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}
.os-delayed{max-width:640px;margin:36px auto 0}
.os-delayed .os-cta{margin-top:0}`;

function quote(text: string, avatar: number) {
  return `<article class="os-card os-quote"><p class="os-stars">★★★★★</p><blockquote>“${text}”</blockquote><div class="os-person"><img src="${avatarImage(avatar)}" alt="Foto do cliente"><p><strong>Nome do cliente</strong>Cidade/UF</p></div></article>`;
}

const body = `
<header class="os-vsl os-dark">
<div class="os-container">
<p class="os-live">Assista ao vídeo até o final</p>
<h1 class="os-h1">[Headline forte que promete o resultado e prende a atenção do público nos primeiros segundos]</h1>
${videoSlot("Vídeo de vendas (VSL)")}
<p class="os-sound">🔊 Verifique se o som do seu aparelho está ligado</p>
<div class="os-delayed" data-os-delay="0">
<div class="os-cta">${buyButton("QUERO GARANTIR MINHA VAGA", { size: "xl", block: true, pulse: true })}${safeList(["Compra 100% segura", "Acesso imediato", "7 dias de garantia"])}</div>
</div>
</div>
</header>

<section class="os-section os-soft">
<div class="os-container os-center">
<p class="os-eyebrow">Depoimentos</p>
<h2 class="os-h2">Veja o que dizem as pessoas que já começaram</h2>
<div class="os-grid">
${quote("Troque este texto por um depoimento real: o problema que a pessoa tinha, o que ela fez e o resultado que conquistou.", 0)}
${quote("Depoimentos com detalhes concretos (números, prazos, antes e depois) são os que mais convencem.", 1)}
${quote("Se preferir, substitua este cartão por um print de conversa ou por um vídeo curto do cliente.", 2)}
</div>
</div>
</section>

<section class="os-section">
<div class="os-container">
<div class="os-guarantee">
<div class="os-seal"><strong>7</strong><span>dias de garantia</span></div>
<div>
<h2 class="os-h2">Sua satisfação garantida</h2>
<p>Experimente por 7 dias. Se não gostar por qualquer motivo, é só pedir o reembolso dentro do prazo e você recebe 100% do valor de volta. Simples assim.</p>
</div>
</div>
</div>
</section>

${footer({ disclaimer: RESULTS_DISCLAIMER })}
`;

export const vslHtml = pageDocument({
  title: "VSL",
  css: buildCss(t, ["button", "video", "cards", "testimonials", "guarantee", "footer", "delay"], extra),
  body,
});
