/** Modelo: página de obrigado (compra confirmada + próximos passos + WhatsApp). */
import { pageDocument } from "./document";
import { buildCss, theme } from "./styles";
import { buyButton, footer } from "./widgets";

const t = theme({ soft: "#f1f7f3" });

const extra = `
.os-thanks{padding:72px 0 8px;text-align:center;background:linear-gradient(180deg,var(--os-soft),var(--os-bg))}
.os-success{display:flex;align-items:center;justify-content:center;width:88px;height:88px;margin:0 auto 26px;border-radius:50%;background:var(--os-primary);color:#fff;font-size:46px;font-weight:900;line-height:1;box-shadow:0 0 0 12px var(--os-primary-soft)}
.os-next{padding-top:48px}
.os-steps{display:grid;gap:16px;max-width:760px;margin:0 auto;padding:0;list-style:none;counter-reset:os-step;text-align:left}
.os-step{position:relative;padding:24px 24px 24px 82px;background:var(--os-card);border:1px solid var(--os-line);border-radius:var(--os-radius)}
.os-step::before{counter-increment:os-step;content:counter(os-step);position:absolute;left:24px;top:22px;display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:50%;background:var(--os-primary);color:#fff;font-size:18px;font-weight:900}
.os-step h3{font-size:19px;margin:0 0 6px}
.os-step p{margin:0;font-size:16px;color:var(--os-muted)}
.os-group{max-width:760px;margin:28px auto 0;padding:32px 28px;border-radius:24px;background:#0b3d24;color:#dcfce7;text-align:center}
.os-group h2{color:#fff;font-size:clamp(22px,3.4vw,28px);margin:0 0 10px}
.os-group p{margin:0 0 22px;color:#bbf7d0}
.os-help{margin:36px 0 0;text-align:center;font-size:15px;color:var(--os-muted)}
@media (max-width:560px){.os-step{padding:72px 20px 20px}.os-step::before{left:20px;top:20px}}`;

const body = `
<header class="os-thanks">
<div class="os-container os-narrow">
<div class="os-success">✓</div>
<h1 class="os-h1">Parabéns! Sua compra foi confirmada 🎉</h1>
<p class="os-lead">Obrigado pela confiança. Enviamos os dados de acesso para o e-mail usado na compra. Siga os passos abaixo para começar agora mesmo.</p>
</div>
</header>

<section class="os-section os-next">
<div class="os-container">
<h2 class="os-h2 os-center">Próximos passos</h2>
<ol class="os-steps">
<li class="os-step"><h3>Confira seu e-mail</h3><p>Procure a mensagem com o assunto “[assunto do e-mail de acesso]”. Se não encontrar, olhe também nas pastas de spam e promoções.</p></li>
<li class="os-step"><h3>Entre no grupo exclusivo</h3><p>No grupo do WhatsApp você recebe avisos importantes, materiais extras e tira dúvidas com a equipe.</p></li>
<li class="os-step"><h3>Acesse a área de membros</h3><p>Use o login enviado por e-mail e comece pela primeira aula. Reserve alguns minutos por dia para avançar.</p></li>
</ol>
<div class="os-group">
<h2>Entre no grupo VIP do WhatsApp</h2>
<p>Clique no botão abaixo para entrar agora. As vagas do grupo são limitadas.</p>
${buyButton("ENTRAR NO GRUPO DO WHATSAPP", { size: "xl" }).replace('class="os-btn', 'class="os-btn os-btn--whatsapp')}
</div>
<p class="os-help">Precisa de ajuda? Fale com o nosso suporte: <span class="os-ph">{{EMAIL}}</span></p>
</div>
</section>

${footer({ links: true })}
`;

export const thankYouHtml = pageDocument({
  title: "Obrigado",
  css: buildCss(t, ["button", "footer"], extra),
  body,
});
