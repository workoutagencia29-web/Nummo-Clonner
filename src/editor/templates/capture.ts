/** Modelo: página de captura de leads (isca digital + formulário). */
import { avatarImage, placeholderImage } from "./assets";
import { pageDocument } from "./document";
import { buildCss, theme } from "./styles";
import { footer, leadForm, salesNotification } from "./widgets";

const t = theme({
  primary: "#4f46e5",
  primarySoft: "#e0e7ff",
  primaryShadow: "rgba(79,70,229,.55)",
  accent: "#facc15",
  accentInk: "#1a1400",
  accentSoft: "#fef08a",
  dark: "#1e1b4b",
  darkInk: "#e0e7ff",
  darkMuted: "#c7d2fe",
  heroGlow: "rgba(167,139,250,.45)",
});

const extra = `
.os-capture{padding:72px 0 88px;background:radial-gradient(700px 480px at 85% 10%,var(--os-hero-glow),transparent 70%),linear-gradient(160deg,#312e81,#1e1b4b 60%,#0f0c2e)}
.os-capture-grid{display:grid;gap:48px;align-items:center;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))}
.os-capture .os-h1{font-size:clamp(30px,4.6vw,50px)}
.os-capture .os-lead{margin-left:0;margin-right:0}
.os-capture .os-check{margin:28px 0 32px}
.os-capture .os-check li::before{background-color:#22c55e}
.os-pill{display:inline-block;margin:0 0 20px;padding:8px 16px;border-radius:999px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.18);font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#fff}
.os-form-card{background:#fff;color:var(--os-ink);border-radius:26px;padding:34px 30px 28px;box-shadow:0 50px 100px -40px rgba(0,0,0,.65)}
.os-form-card h2{font-size:26px;margin:0 0 6px;color:var(--os-heading)}
.os-form-card .os-cover{width:100%;margin:0 0 22px;border-radius:14px}
.os-form-card>p{margin:0 0 20px;font-size:16px;color:var(--os-muted)}
.os-social{display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin:0}
.os-avatars{display:flex;padding-left:10px}
.os-avatars img{width:40px;height:40px;margin-left:-10px;border-radius:50%;border:3px solid #1e1b4b}
.os-social p{margin:0;font-size:15px;color:var(--os-dark-muted)}
.os-stats{display:grid;gap:18px;margin-top:40px;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr))}
.os-stat{padding:26px 20px;border-radius:var(--os-radius);background:var(--os-card);border:1px solid var(--os-line);text-align:center}
.os-stat strong{display:block;font-size:40px;font-weight:900;line-height:1.1;letter-spacing:-.03em;color:var(--os-primary)}
.os-stat span{display:block;margin-top:6px;font-size:15px;color:var(--os-muted)}
@media (max-width:640px){.os-capture{padding:44px 0 56px}.os-form-card{padding:26px 20px 22px}}`;

function quote(text: string, avatar: number) {
  return `<article class="os-card os-quote"><p class="os-stars">★★★★★</p><blockquote>“${text}”</blockquote><div class="os-person"><img src="${avatarImage(avatar)}" alt="Foto de quem se inscreveu"><p><strong>Nome da pessoa</strong>Cidade/UF</p></div></article>`;
}

const body = `
<header class="os-capture os-dark">
<div class="os-container os-capture-grid">
<div>
<p class="os-pill">📘 Material gratuito</p>
<h1 class="os-h1">Baixe grátis o guia <span class="os-mark">[nome do material]</span> e descubra como [resultado desejado]</h1>
<p class="os-lead">Um material direto ao ponto, criado para quem quer [benefício principal] sem perder tempo com o que não funciona.</p>
<ul class="os-check">
<li>O erro nº 1 que impede a maioria das pessoas de [resultado]</li>
<li>Um plano simples de 3 passos para começar hoje</li>
<li>Os modelos prontos que usamos com nossos alunos</li>
</ul>
<div class="os-social">
<div class="os-avatars"><img src="${avatarImage(0)}" alt=""><img src="${avatarImage(1)}" alt=""><img src="${avatarImage(2)}" alt=""><img src="${avatarImage(3)}" alt=""></div>
<p>Mais de <strong>12.000 pessoas</strong> já receberam este material</p>
</div>
</div>
<div class="os-form-card">
<img class="os-cover" src="${placeholderImage("Capa do material", 800, 420, "cool")}" alt="Capa do material gratuito">
<h2>Receba o material agora</h2>
<p>Preencha os campos abaixo e receba o acesso em instantes.</p>
${leadForm({ id: "inscricao", button: "QUERO RECEBER GRÁTIS", whatsapp: true, success: "Pronto! Recebemos seus dados." })}
</div>
</div>
</header>

<section class="os-section os-soft">
<div class="os-container os-center">
<p class="os-eyebrow">Prova social</p>
<h2 class="os-h2">Quem já recebeu, recomenda</h2>
<div class="os-stats">
<div class="os-stat"><strong>+12 mil</strong><span>pessoas inscritas</span></div>
<div class="os-stat"><strong>4,9/5</strong><span>de avaliação média</span></div>
<div class="os-stat"><strong>100%</strong><span>gratuito e online</span></div>
</div>
<div class="os-grid">
${quote("Troque este texto por um comentário real de quem já recebeu o material e o que achou dele.", 0)}
${quote("Comentários curtos e específicos funcionam melhor: o que a pessoa aprendeu e o que aplicou.", 1)}
${quote("Você também pode usar prints de mensagens (com autorização de quem enviou).", 2)}
</div>
<div class="os-cta"><a href="#inscricao" class="os-btn">QUERO O MEU MATERIAL GRÁTIS</a></div>
</div>
</section>

${footer({ links: true })}

${salesNotification({ action: "acabou de se inscrever" })}
`;

export const captureHtml = pageDocument({
  title: "Captura",
  css: buildCss(t, ["button", "cards", "lists", "testimonials", "form", "footer", "notify"], extra),
  body,
});
