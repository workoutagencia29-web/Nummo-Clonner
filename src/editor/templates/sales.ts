/** Modelo: página de vendas longa (carta de vendas completa). */
import { avatarImage, placeholderImage } from "./assets";
import { pageDocument } from "./document";
import { buildCss, theme } from "./styles";
import { buyButton, countdown, exitPopup, footer, RESULTS_DISCLAIMER, safeList } from "./widgets";

const t = theme();

const benefits: [string, string, string][] = [
  [
    "🎯",
    "Resultado mais rápido",
    "Um passo a passo direto ao ponto, sem enrolação, para você ver os primeiros resultados já na primeira semana.",
  ],
  [
    "🧭",
    "Caminho claro",
    "Você sabe exatamente o que fazer em cada etapa, na ordem certa, sem ficar perdido no meio do caminho.",
  ],
  [
    "⏱️",
    "Poucos minutos por dia",
    "Feito para a rotina corrida: aulas curtas que cabem no seu dia, no celular ou no computador.",
  ],
  [
    "💬",
    "Suporte de verdade",
    "Tire suas dúvidas diretamente com a equipe e nunca fique travado sem saber o próximo passo.",
  ],
  ["📱", "Acesso de qualquer lugar", "Assista quando e onde quiser, quantas vezes precisar, no seu ritmo."],
  ["🏆", "Método testado", "Um processo aplicado e refinado com centenas de alunos antes de chegar até você."],
];

const modules: [string, string][] = [
  [
    "Fundamentos",
    "O ponto de partida: o que você precisa entender antes de tudo para não cometer os erros mais comuns.",
  ],
  ["Primeiros passos", "Coloque a mão na massa com um plano simples para os seus primeiros 7 dias."],
  ["O método na prática", "O coração do programa: o passo a passo completo, com exemplos reais e modelos prontos."],
  ["Acelerando os resultados", "Estratégias avançadas para ir mais longe em menos tempo."],
  ["Erros que travam o progresso", "Como identificar e corrigir o que está impedindo você de avançar."],
  ["Plano de continuidade", "Como manter os resultados no longo prazo, mesmo depois de terminar o programa."],
];

const bonuses: [string, string, string][] = [
  ["Guia de início rápido", "Um resumo prático em PDF para você aplicar o essencial ainda hoje.", "R$ 47"],
  ["Planilha de acompanhamento", "Acompanhe sua evolução semana a semana e mantenha a constância.", "R$ 67"],
  ["Comunidade exclusiva", "Acesso ao grupo de alunos para trocar experiências e tirar dúvidas.", "R$ 97"],
];

const faq: [string, string][] = [
  [
    "Como vou receber o acesso?",
    "Logo após a confirmação do pagamento, você recebe no seu e-mail os dados de acesso à área de membros. No Pix e no cartão, a liberação é imediata.",
  ],
  [
    "Por quanto tempo terei acesso?",
    "Você terá acesso por [prazo de acesso — ex.: 1 ano], incluindo as atualizações feitas nesse período.",
  ],
  [
    "E se eu não gostar?",
    "Você tem 7 dias de garantia. Se não ficar satisfeito por qualquer motivo, basta pedir o reembolso dentro do prazo e devolvemos 100% do valor.",
  ],
  [
    "Preciso de algum conhecimento prévio?",
    "Não. O conteúdo começa do zero e foi pensado para quem nunca teve contato com o assunto.",
  ],
  [
    "Quais são as formas de pagamento?",
    "Pix, boleto e cartão de crédito em até 12x. O pagamento é processado em ambiente seguro.",
  ],
  ["Consigo assistir pelo celular?", "Sim. A área de membros funciona no celular, no tablet e no computador."],
];

function quote(text: string, name: string, place: string, avatar: number) {
  return `<article class="os-card os-quote"><p class="os-stars">★★★★★</p><blockquote>“${text}”</blockquote><div class="os-person"><img src="${avatarImage(avatar)}" alt="Foto do cliente"><p><strong>${name}</strong>${place}</p></div></article>`;
}

const body = `
<p class="os-topbar">⚡ Condição especial por tempo limitado — válida somente nesta página</p>

<header class="os-hero os-dark">
<div class="os-container">
<p class="os-pill">🔥 Método [Nome do produto]</p>
<h1 class="os-h1">Como [conquistar o resultado desejado] em [prazo], <span class="os-mark">mesmo que você [maior objeção do público]</span></h1>
<p class="os-lead">O passo a passo simples e comprovado para quem quer [benefício principal] sem [aquilo que o seu público mais odeia fazer].</p>
<div class="os-media"><img src="${placeholderImage("Imagem ou mockup do produto", 1200, 675, "dark")}" alt="Imagem do produto"></div>
<div class="os-cta">${buyButton("QUERO COMEÇAR AGORA", { size: "xl", pulse: true })}${safeList()}</div>
</div>
</header>

<section class="os-section">
<div class="os-container os-narrow os-center">
<p class="os-eyebrow">Isso parece com você?</p>
<h2 class="os-h2">Se você se identifica com pelo menos uma destas situações, continue lendo</h2>
<div class="os-panel">
<ul class="os-check os-check--no">
<li>Você já tentou de tudo, mas nada parece funcionar por muito tempo.</li>
<li>Sente que perde tempo com informações soltas e contraditórias na internet.</li>
<li>Começa cheio de motivação, mas desanima quando os resultados não aparecem.</li>
<li>Sabe que precisa mudar, mas não sabe por onde começar.</li>
</ul>
</div>
</div>
</section>

<section class="os-section os-soft">
<div class="os-container os-split">
<div class="os-figure"><img src="${placeholderImage("Foto que mostra a transformação", 900, 700)}" alt="Imagem da solução"></div>
<div>
<p class="os-eyebrow">Apresentando</p>
<h2 class="os-h2">[Nome do produto]: o caminho mais curto até [resultado desejado]</h2>
<p>Depois de [anos de experiência / centenas de alunos], reunimos tudo o que realmente funciona em um método simples, organizado e fácil de seguir — para você parar de tentar sozinho e começar a ver resultado.</p>
<ul class="os-check">
<li>Passo a passo do zero ao avançado</li>
<li>Aulas curtas e práticas, direto ao ponto</li>
<li>Materiais de apoio e modelos prontos para usar</li>
<li>Suporte para tirar suas dúvidas</li>
</ul>
</div>
</div>
</section>

<section class="os-section">
<div class="os-container os-center">
<p class="os-eyebrow">Benefícios</p>
<h2 class="os-h2">O que muda quando você aplica o método</h2>
<div class="os-grid">
${benefits.map(([icon, title, text]) => `<div class="os-card"><div class="os-icon">${icon}</div><h3>${title}</h3><p>${text}</p></div>`).join("\n")}
</div>
</div>
</section>

<section class="os-section os-soft">
<div class="os-container os-center">
<p class="os-eyebrow">Conteúdo</p>
<h2 class="os-h2">Tudo o que você vai aprender</h2>
<p class="os-lead">Um programa completo, dividido em módulos para você avançar com segurança.</p>
<div class="os-modules">
${modules.map(([title, text]) => `<div class="os-module"><h3>${title}</h3><p>${text}</p></div>`).join("\n")}
</div>
</div>
</section>

<section class="os-section">
<div class="os-container os-center">
<p class="os-eyebrow">Presentes para você</p>
<h2 class="os-h2">E ainda leva bônus exclusivos</h2>
<div class="os-bonuses">
${bonuses
  .map(
    ([title, text, value], i) =>
      `<div class="os-bonus"><img src="${placeholderImage(`Capa do bônus ${i + 1}`, 400, 400, "warm")}" alt="Capa do bônus ${i + 1}"><div><p class="os-tag">Bônus ${i + 1}</p><h3>${title}</h3><p>${text}</p><p class="os-value">De <s>${value}</s> por R$ 0 — grátis para você</p></div></div>`,
  )
  .join("\n")}
</div>
</div>
</section>

<section class="os-section os-soft">
<div class="os-container os-center">
<p class="os-eyebrow">Depoimentos</p>
<h2 class="os-h2">Quem já aplicou, aprova</h2>
<div class="os-grid">
${quote("Troque este texto por um depoimento real de cliente, contando o resultado que ele alcançou e em quanto tempo.", "Nome do cliente", "Cidade/UF", 0)}
${quote("Depoimentos específicos convencem mais: números, prazos e a situação da pessoa antes de começar.", "Nome do cliente", "Cidade/UF", 1)}
${quote("Você também pode trocar este cartão por um print de conversa ou por um vídeo de depoimento.", "Nome do cliente", "Cidade/UF", 2)}
</div>
</div>
</section>

<section class="os-section os-dark" id="oferta">
<div class="os-container os-center">
<p class="os-eyebrow">Oferta especial</p>
<h2 class="os-h2">Garanta seu acesso com condição especial</h2>
<p class="os-timer">Esta condição termina em:</p>
${countdown(15)}
<div class="os-offer">
<p class="os-badge">OFERTA POR TEMPO LIMITADO</p>
<h3>[Nome do produto] completo</h3>
<ul class="os-check">
<li>Acesso a todos os módulos do programa</li>
<li>3 bônus exclusivos</li>
<li>Suporte para tirar dúvidas</li>
<li>Garantia incondicional de 7 dias</li>
</ul>
<p class="os-price-from">De <s>R$ 497,00</s> por apenas</p>
<p class="os-price-label">12x de</p>
<p class="os-price">R$ 19,70</p>
<p class="os-price-cash">ou R$ 197,00 à vista</p>
${buyButton("SIM, QUERO MEU ACESSO", { block: true, pulse: true })}
<p class="os-pay">🔒 Pagamento seguro · Pix, cartão de crédito ou boleto</p>
</div>
</div>
</section>

<section class="os-section">
<div class="os-container">
<div class="os-guarantee">
<div class="os-seal"><strong>7</strong><span>dias de garantia</span></div>
<div>
<h2 class="os-h2">Risco zero para você</h2>
<p>Você tem 7 dias para conhecer todo o conteúdo. Se por qualquer motivo achar que não é para você, basta enviar um e-mail e devolvemos 100% do seu dinheiro. Sem perguntas e sem burocracia.</p>
</div>
</div>
</div>
</section>

<section class="os-section os-soft">
<div class="os-container os-split">
<div>
<p class="os-eyebrow">Quem vai te ensinar</p>
<h2 class="os-h2">Prazer, eu sou [Seu nome]</h2>
<p>Conte aqui a sua história: de onde você veio, qual foi a sua virada e por que você é a pessoa certa para ensinar esse método.</p>
<p>Inclua números e conquistas que geram confiança: anos de experiência, alunos atendidos, resultados obtidos e onde você já apareceu.</p>
</div>
<div class="os-figure"><img src="${placeholderImage("Sua foto", 800, 800)}" alt="Foto do especialista"></div>
</div>
</section>

<section class="os-section">
<div class="os-container os-center">
<p class="os-eyebrow">Dúvidas frequentes</p>
<h2 class="os-h2">Perguntas frequentes</h2>
<div class="os-faq">
${faq.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join("\n")}
</div>
</div>
</section>

<section class="os-hero os-dark">
<div class="os-container os-narrow">
<h2 class="os-h2">A decisão é sua: continuar do mesmo jeito ou começar hoje</h2>
<p class="os-lead">Daqui a alguns meses você vai desejar ter começado hoje. Garanta seu acesso enquanto a condição especial está disponível.</p>
<div class="os-cta">${buyButton("QUERO GARANTIR MINHA VAGA", { size: "xl", pulse: true })}${safeList()}</div>
</div>
</section>

${footer({ disclaimer: RESULTS_DISCLAIMER })}

${exitPopup({
  title: "Espere! Antes de sair…",
  text: "Liberamos uma condição especial só para quem chegou até aqui. Aproveite antes que ela desapareça.",
  button: "QUERO APROVEITAR",
  decline: "Não, obrigado",
})}
`;

export const salesHtml = pageDocument({
  title: "Página de vendas",
  css: buildCss(t, [
    "button",
    "hero",
    "media",
    "cards",
    "lists",
    "modules",
    "bonus",
    "testimonials",
    "offer",
    "guarantee",
    "faq",
    "footer",
    "countdown",
    "popup",
  ]),
  body,
});
