/** Modelo: advertorial (matéria em formato jornalístico com chamadas para a oferta). */
import { avatarImage, placeholderImage } from "./assets";
import { pageDocument } from "./document";
import { buildCss, SANS, SERIF, theme } from "./styles";
import { buyButton, footer, TODAY_MARKER } from "./widgets";

const t = theme({
  primary: "#15803d",
  primarySoft: "#dcfce7",
  accent: "#c81e1e",
  accentInk: "#ffffff",
  accentSoft: "#fecaca",
  ink: "#1f2328",
  heading: "#111418",
  muted: "#5b6470",
  soft: "#f6f6f4",
  line: "#e4e4df",
  font: SERIF,
  headFont: SERIF,
  radius: "8px",
  btnRadius: "8px",
  footerBg: "#111418",
});

const extra = `
.os-adbar{margin:0;padding:6px 16px;background:#f1f1ee;color:#6b6b66;text-align:center;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
.os-masthead{border-bottom:1px solid var(--os-line);background:#fff}
.os-masthead .os-container{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:68px}
.os-logo{margin:0;font-family:${SERIF};font-size:26px;font-weight:900;letter-spacing:-.02em;color:var(--os-heading)}
.os-logo span{color:var(--os-accent)}
.os-nav{display:flex;gap:22px;margin:0;padding:0;list-style:none;font-family:${SANS};font-size:14px;font-weight:700;color:var(--os-muted)}
.os-article{max-width:760px;margin:0 auto;padding:40px 20px 64px}
.os-kicker{margin:0 0 12px;font-family:${SANS};font-size:13px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--os-accent)}
.os-article h1{font-size:clamp(30px,5vw,46px);line-height:1.12;letter-spacing:-.015em}
.os-deck{margin:0 0 22px;font-size:clamp(19px,2.4vw,22px);line-height:1.5;color:var(--os-muted)}
.os-byline{display:flex;align-items:center;gap:12px;margin:0 0 28px;padding:14px 0;border-top:1px solid var(--os-line);border-bottom:1px solid var(--os-line);font-family:${SANS};font-size:14px;color:var(--os-muted)}
.os-byline img{width:42px;height:42px;border-radius:50%}
.os-byline p{margin:0;line-height:1.4}
.os-byline strong{color:var(--os-heading)}
.os-article>p:not([class]){font-size:19px;line-height:1.75}
.os-article h2{margin:40px 0 14px;font-size:clamp(24px,3.4vw,30px)}
.os-article figure{margin:30px 0}
.os-article figure img{width:100%;border-radius:var(--os-radius)}
.os-article figcaption{margin-top:10px;font-family:${SANS};font-size:13px;color:var(--os-muted)}
.os-pullquote{margin:34px 0;padding:6px 0 6px 22px;border-left:4px solid var(--os-accent);font-size:24px;font-style:italic;line-height:1.45;color:var(--os-heading)}
.os-article>ul{margin:0 0 1.2em;padding-left:22px;font-size:19px;line-height:1.7}
.os-article li{margin-bottom:8px}
.os-callout{margin:36px 0;padding:30px 26px;border:2px solid var(--os-primary);border-radius:12px;background:#f3faf5;text-align:center}
.os-callout h3{margin:0 0 10px;font-size:24px}
.os-callout p{margin:0 0 20px;font-size:17px}
.os-callout .os-btn{font-family:${SANS}}
.os-comments{margin-top:52px;padding-top:28px;border-top:3px solid var(--os-heading);font-family:${SANS}}
.os-comments h2{margin:0 0 20px;font-family:${SANS};font-size:20px}
.os-comment{display:grid;grid-template-columns:44px 1fr;gap:12px;margin:0 0 18px}
.os-comment img{width:44px;height:44px;border-radius:50%}
.os-comment div{padding:12px 16px;border-radius:14px;background:#f2f3f5}
.os-comment strong{display:block;font-size:14px;color:var(--os-heading)}
.os-comment p{margin:4px 0 0;font-family:${SANS};font-size:15px;line-height:1.5}
.os-comment span{display:block;margin-top:6px;font-size:12px;color:var(--os-muted)}
.os-footer{font-family:${SANS}}
@media (max-width:760px){.os-nav{display:none}}`;

function comment(name: string, text: string, when: string, avatar: number) {
  return `<div class="os-comment"><img src="${avatarImage(avatar)}" alt=""><div><strong>${name}</strong><p>${text}</p><span>${when}</span></div></div>`;
}

const body = `
<p class="os-adbar">Publicidade</p>
<header class="os-masthead">
<div class="os-container">
<p class="os-logo">Nome do <span>Portal</span></p>
<ul class="os-nav"><li>Saúde</li><li>Bem-estar</li><li>Comportamento</li><li>Estilo de vida</li></ul>
</div>
</header>

<main class="os-article">
<p class="os-kicker">Bem-estar</p>
<h1>O hábito simples de 10 minutos que está mudando a rotina de quem quer [resultado desejado]</h1>
<p class="os-deck">Conheça a história de [nome do personagem], que tentou de tudo antes de descobrir um método prático para [resultado] — e o que você pode aprender com ela.</p>
<div class="os-byline"><img src="${avatarImage(4)}" alt=""><p><strong>Por Redação</strong><br>Atualizado em ${TODAY_MARKER} · 6 min de leitura</p></div>

<figure><img src="${placeholderImage("Foto principal da matéria", 1200, 700)}" alt="Foto principal da matéria"><figcaption>Legenda da foto: descreva a cena ou a pessoa retratada.</figcaption></figure>

<p>Comece a matéria contando uma história real e próxima do leitor. Apresente o personagem, a situação em que ele estava e o problema que enfrentava — o mesmo problema que o seu público vive hoje.</p>
<p>Use frases curtas e um tom de reportagem. O objetivo desta primeira parte é gerar identificação: o leitor precisa pensar “isso acontece comigo também”.</p>

<h2>O problema que ninguém explica</h2>
<p>Explique por que as soluções comuns não funcionam. Traga dados, comparações e exemplos do dia a dia que ajudem o leitor a entender a causa do problema.</p>
<p class="os-pullquote">“Coloque aqui uma frase marcante do personagem ou de um especialista, que resuma a virada da história.”</p>
<p>Mostre o momento da descoberta: como o personagem encontrou uma nova forma de resolver o problema e o que mudou nas primeiras semanas.</p>

<div class="os-callout">
<h3>Quer conhecer o método?</h3>
<p>Clique no botão abaixo para ver a apresentação completa de [nome do produto].</p>
${buyButton("QUERO CONHECER O MÉTODO")}
</div>

<h2>Como funciona, na prática</h2>
<p>Descreva o método de forma simples, em poucos passos, sem prometer resultados milagrosos:</p>
<ul>
<li><strong>Passo 1:</strong> o que a pessoa faz primeiro.</li>
<li><strong>Passo 2:</strong> como ela mantém a constância.</li>
<li><strong>Passo 3:</strong> o que ela acompanha para medir o progresso.</li>
</ul>
<figure><img src="${placeholderImage("Imagem de apoio", 1200, 700)}" alt="Imagem de apoio"><figcaption>Legenda da imagem de apoio.</figcaption></figure>
<p>Feche a matéria com o convite: onde o leitor pode conhecer o método e por que vale a pena fazer isso agora (condição especial, vagas limitadas, bônus).</p>

<div class="os-callout">
<h3>Condição especial para leitores</h3>
<p>A apresentação completa está disponível por tempo limitado.</p>
${buyButton("VER A APRESENTAÇÃO COMPLETA", { pulse: true })}
</div>

<section class="os-comments">
<h2>Comentários</h2>
${comment("Nome do leitor", "Troque por um comentário real de leitor ou cliente, com autorização.", "Curtir · Responder · há 2 h", 0)}
${comment("Nome do leitor", "Comentários com experiências concretas passam mais confiança.", "Curtir · Responder · há 5 h", 1)}
${comment("Nome do leitor", "Você pode apagar esta seção se não tiver comentários para mostrar.", "Curtir · Responder · há 1 dia", 2)}
</section>
</main>

${footer({ disclaimer: "Este conteúdo é publicitário (publieditorial). As informações não substituem a orientação de um profissional. Os resultados variam de pessoa para pessoa." })}
`;

export const advertorialHtml = pageDocument({
  title: "Advertorial",
  css: buildCss(t, ["button", "footer"], extra),
  body,
});
