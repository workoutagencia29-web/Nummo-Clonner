/**
 * Modelos: Política de privacidade e Termos de uso.
 *
 * Textos genéricos de referência, pensados para a LGPD (Lei 13.709/2018) e o
 * Código de Defesa do Consumidor. NÃO são aconselhamento jurídico: o painel
 * avisa isso ao escolher o modelo. Os dados da empresa ficam como
 * {{EMPRESA}}, {{CNPJ}}, {{EMAIL}}, {{TELEFONE}} e {{ENDERECO}} (destacados só
 * no editor): a prévia e o ZIP trocam pelos dados da aba "Empresa e SEO"
 * (fillCompanyPlaceholders), inclusive "CNPJ/CPF" por CPF ou CNPJ conforme o
 * número. Telefone e endereço são opcionais: os trechos com eles ficam em
 * <span data-os-company="phone|address">, que somem quando o dado está vazio.
 * Também dá para trocar de uma vez com "Localizar e substituir".
 *
 * A política cita os itens funcionais que o Offer Studio grava no navegador
 * sem pedir permissão: a escolha no aviso de cookies (localStorage
 * "os_consent", src/runtime/tracking/consent.ts) e a versão do teste A/B
 * (cookie/localStorage "os_ab_…", src/lib/export/splitter.ts) — e que os
 * eventos levam a versão vista (os_versao). Mudou um deles, mude o texto.
 */
import { pageDocument } from "./document";
import { buildCss, theme } from "./styles";
import { footer, TODAY_MARKER } from "./widgets";

const t = theme({ primary: "#2563eb", primarySoft: "#dbeafe", primaryShadow: "rgba(37,99,235,.45)" });

const extra = `
.os-legal-head{padding:64px 0 40px;background:var(--os-soft);border-bottom:1px solid var(--os-line)}
.os-legal-head .os-h1{font-size:clamp(30px,4.6vw,44px);margin-bottom:10px}
.os-updated{margin:0;font-size:15px;color:var(--os-muted)}
.os-legal{max-width:800px;margin:0 auto;padding:48px 20px 80px;font-size:17px;line-height:1.75}
.os-legal h2{margin:44px 0 12px;font-size:clamp(21px,2.6vw,24px)}
.os-legal h2:first-child{margin-top:0}
.os-legal ul{margin:0 0 1.1em;padding-left:22px}
.os-legal li{margin-bottom:8px}
.os-legal .os-intro{font-size:19px;color:var(--os-heading)}`;

/** Marca um dado que o usuário precisa trocar (destacado só no editor). */
const ph = (name: string) => `<span class="os-ph">{{${name}}}</span>`;
const EMPRESA = ph("EMPRESA");
const CNPJ = ph("CNPJ");
const EMAIL = ph("EMAIL");
const TELEFONE = ph("TELEFONE");
const ENDERECO = ph("ENDERECO");
/** Trecho com um dado opcional da empresa: sai da página quando o dado está vazio. */
const optional = (field: "phone" | "address", html: string) => `<span data-os-company="${field}">${html}</span>`;

function legalPage(title: string, sections: string) {
  const body = `
<header class="os-legal-head">
<div class="os-container os-narrow">
<h1 class="os-h1">${title}</h1>
<p class="os-updated">Última atualização: ${TODAY_MARKER}</p>
</div>
</header>

<main class="os-legal">
${sections.trim()}
</main>

${footer({ links: true })}
`;
  return pageDocument({ title, css: buildCss(t, ["footer"], extra), body });
}

export const privacyHtml = legalPage(
  "Política de Privacidade",
  `
<p class="os-intro">Esta Política de Privacidade explica como ${EMPRESA} coleta, usa, compartilha e protege os dados pessoais de quem visita este site, se cadastra nos nossos formulários ou compra os nossos produtos, em conformidade com a Lei Geral de Proteção de Dados Pessoais (LGPD — Lei nº 13.709/2018).</p>

<h2>1. Quem é o responsável pelos seus dados</h2>
<p>O controlador dos dados pessoais é ${EMPRESA}, CNPJ/CPF nº ${CNPJ}. Para qualquer assunto relacionado a privacidade, inclusive para falar com o nosso encarregado pelo tratamento de dados (DPO), escreva para ${EMAIL}.</p>

<h2>2. Quais dados coletamos</h2>
<ul>
<li><strong>Dados que você nos informa:</strong> nome, e-mail, telefone/WhatsApp e outras informações preenchidas em formulários de cadastro, de contato ou de compra.</li>
<li><strong>Dados de compra:</strong> produto adquirido, valor, forma de pagamento e situação do pedido. Os dados de cartão são processados diretamente pela plataforma de pagamento e não ficam armazenados conosco.</li>
<li><strong>Dados de navegação:</strong> endereço IP, tipo de navegador e de aparelho, páginas visitadas, origem do acesso (como parâmetros UTM) e informações coletadas por cookies e tecnologias semelhantes.</li>
</ul>

<h2>3. Para que usamos os seus dados</h2>
<ul>
<li>Entregar os materiais, produtos e serviços solicitados e dar acesso à área de membros;</li>
<li>Processar pagamentos, emitir comprovantes e cumprir obrigações legais e fiscais;</li>
<li>Prestar suporte e responder às suas solicitações;</li>
<li>Enviar comunicações sobre conteúdos, produtos e ofertas, quando você autorizar — você pode cancelar a qualquer momento;</li>
<li>Medir o desempenho das nossas páginas e anúncios e melhorar a sua experiência;</li>
<li>Prevenir fraudes e garantir a segurança do site.</li>
</ul>

<h2>4. Bases legais</h2>
<p>Tratamos dados pessoais com base nas hipóteses previstas no art. 7º da LGPD, principalmente: o seu consentimento; a execução de contrato ou de procedimentos preliminares a pedido seu; o cumprimento de obrigação legal ou regulatória; o exercício regular de direitos; e o nosso legítimo interesse, sempre respeitando os seus direitos e liberdades fundamentais.</p>

<h2>5. Cookies, pixels e ferramentas de análise</h2>
<p>Usamos cookies e tecnologias semelhantes (como pixels de plataformas de anúncios e ferramentas de análise de tráfego) para lembrar suas preferências, entender como o site é usado e mostrar anúncios mais relevantes. Os cookies não essenciais só são ativados com a sua autorização, quando aplicável. Você pode recusar ou apagar cookies nas configurações do seu navegador; algumas funções do site podem deixar de funcionar corretamente.</p>
<p>Alguns itens guardados no seu navegador são necessários para o funcionamento do site, não identificam você e não são usados para anúncios; por isso, não dependem da sua autorização:</p>
<ul>
<li><strong>os_consent</strong> (armazenamento local do navegador, por até 180 dias): guarda a sua escolha no aviso de cookies (aceitar ou recusar), para não perguntar de novo a cada página;</li>
<li><strong>os_ab_…</strong> (cookie e armazenamento local do navegador, por até 30 dias): quando testamos versões diferentes de uma página (teste A/B), guarda qual versão foi mostrada a você, para que você veja sempre a mesma.</li>
</ul>
<p>Quando autorizado, também guardamos por alguns dias a origem da sua visita (parâmetros UTM e identificadores de clique de anúncios), para saber qual anúncio trouxe você até aqui. Os eventos enviados às plataformas de anúncios e de análise informam qual versão da página você viu, para compararmos o resultado de cada versão.</p>

<h2>6. Com quem compartilhamos</h2>
<p>Não vendemos os seus dados pessoais. Podemos compartilhá-los apenas quando necessário, com:</p>
<ul>
<li>plataformas de pagamento e de entrega de produtos digitais;</li>
<li>ferramentas de e-mail marketing, atendimento e automação;</li>
<li>serviços de hospedagem, armazenamento e segurança;</li>
<li>plataformas de anúncios e de análise, de forma limitada às finalidades descritas acima;</li>
<li>autoridades públicas, quando houver obrigação legal ou ordem judicial.</li>
</ul>

<h2>7. Transferência internacional</h2>
<p>Alguns fornecedores podem armazenar dados em servidores fora do Brasil. Nesses casos, adotamos as garantias exigidas pela LGPD para que os seus dados continuem protegidos.</p>

<h2>8. Por quanto tempo guardamos</h2>
<p>Mantemos os dados pelo tempo necessário para cumprir as finalidades desta Política, ou pelo prazo exigido por lei (por exemplo, obrigações fiscais). Depois disso, os dados são excluídos ou anonimizados.</p>

<h2>9. Como protegemos</h2>
<p>Adotamos medidas técnicas e administrativas razoáveis para proteger os dados pessoais contra acessos não autorizados, perda, alteração ou divulgação indevida. Nenhum sistema é totalmente seguro, mas trabalhamos continuamente para reduzir riscos.</p>

<h2>10. Os seus direitos</h2>
<p>Nos termos do art. 18 da LGPD, você pode, a qualquer momento e gratuitamente:</p>
<ul>
<li>confirmar se tratamos os seus dados e acessá-los;</li>
<li>corrigir dados incompletos, inexatos ou desatualizados;</li>
<li>pedir a anonimização, o bloqueio ou a eliminação de dados desnecessários ou tratados em desconformidade com a lei;</li>
<li>pedir a portabilidade dos dados a outro fornecedor;</li>
<li>pedir a eliminação dos dados tratados com base no seu consentimento;</li>
<li>saber com quem compartilhamos os seus dados;</li>
<li>revogar o consentimento e se opor a tratamentos feitos sem ele, quando cabível.</li>
</ul>
<p>Para exercer esses direitos, envie um e-mail para ${EMAIL}. Você também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).</p>

<h2>11. Crianças e adolescentes</h2>
<p>Nossos produtos e serviços não são direcionados a menores de 18 anos. Não coletamos intencionalmente dados de crianças e adolescentes sem o consentimento dos responsáveis legais.</p>

<h2>12. Alterações desta Política</h2>
<p>Esta Política pode ser atualizada a qualquer momento. A versão vigente estará sempre publicada nesta página, com a data da última atualização.</p>

<h2>13. Contato</h2>
<p>${EMPRESA} — CNPJ/CPF ${CNPJ}<br>E-mail: ${EMAIL}${optional("phone", `<br>Telefone: ${TELEFONE}`)}${optional("address", `<br>Endereço: ${ENDERECO}`)}</p>
`,
);

export const termsHtml = legalPage(
  "Termos de Uso",
  `
<p class="os-intro">Estes Termos de Uso regulam o acesso a este site e a compra e o uso dos produtos oferecidos por ${EMPRESA}. Ao navegar pelo site ou fazer uma compra, você declara que leu e concorda com estes Termos.</p>

<h2>1. Quem somos</h2>
<p>Este site é mantido por ${EMPRESA}, CNPJ/CPF nº ${CNPJ}${optional("address", `, com endereço em ${ENDERECO}`)}. Contato: ${EMAIL}${optional("phone", ` · ${TELEFONE}`)}.</p>

<h2>2. Produtos e acesso</h2>
<p>Os produtos oferecidos são digitais (como cursos, e-books, aulas e comunidades). Depois da confirmação do pagamento, o acesso é enviado para o e-mail informado na compra ou liberado na plataforma de entrega. O acesso é pessoal e intransferível, pelo prazo informado na página do produto.</p>

<h2>3. Pagamentos</h2>
<p>Os pagamentos são processados por plataformas de pagamento parceiras, que seguem os próprios termos e padrões de segurança. Os preços, as condições de parcelamento e as formas de pagamento são os informados na página da oferta no momento da compra.</p>

<h2>4. Direito de arrependimento e garantia</h2>
<p>Conforme o art. 49 do Código de Defesa do Consumidor, você pode desistir da compra em até 7 (sete) dias corridos a partir da data da compra ou do recebimento do acesso, com devolução integral do valor pago. Se a oferta informar um prazo de garantia maior, vale o prazo maior. Para pedir o reembolso, entre em contato pelo e-mail ${EMAIL} ou pela plataforma onde a compra foi feita.</p>

<h2>5. Propriedade intelectual</h2>
<p>Todo o conteúdo do site e dos produtos — textos, vídeos, imagens, marcas, materiais e métodos — pertence a ${EMPRESA} ou a seus licenciadores e é protegido pela legislação de direitos autorais (Lei nº 9.610/1998). É proibido copiar, reproduzir, distribuir, revender ou compartilhar esse conteúdo sem autorização por escrito.</p>

<h2>6. Uso adequado</h2>
<p>Ao usar o site e os produtos, você se compromete a não:</p>
<ul>
<li>compartilhar o seu login ou o acesso com outras pessoas;</li>
<li>gravar, baixar ou divulgar o conteúdo fora dos meios autorizados;</li>
<li>usar o site para fins ilegais ou que prejudiquem terceiros;</li>
<li>tentar acessar áreas restritas ou interferir no funcionamento do site.</li>
</ul>
<p>O descumprimento destas regras pode levar ao bloqueio do acesso, sem prejuízo das medidas legais cabíveis.</p>

<h2>7. Resultados</h2>
<p>Os resultados apresentados em páginas, depoimentos e materiais são exemplos e variam de pessoa para pessoa. Não garantimos a obtenção de resultados específicos: eles dependem da dedicação, do contexto e da aplicação de cada um.</p>

<h2>8. Limitação de responsabilidade</h2>
<p>Empenhamo-nos para manter o site e os produtos disponíveis e atualizados, mas podem ocorrer interrupções temporárias por manutenção ou por falhas de terceiros. Não nos responsabilizamos por danos decorrentes do uso inadequado dos conteúdos ou de fatores fora do nosso controle, nos limites permitidos pela lei.</p>

<h2>9. Privacidade</h2>
<p>O tratamento dos seus dados pessoais segue a nossa <a href="#">Política de Privacidade</a>, que faz parte destes Termos.</p>

<h2>10. Alterações</h2>
<p>Estes Termos podem ser atualizados a qualquer momento. A versão vigente estará sempre publicada nesta página. As compras já realizadas seguem as condições válidas na data da compra.</p>

<h2>11. Lei aplicável e foro</h2>
<p>Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro do domicílio do consumidor para resolver qualquer questão relacionada a eles.</p>

<h2>12. Contato</h2>
<p>Dúvidas, sugestões ou solicitações: ${EMAIL}${optional("phone", ` · ${TELEFONE}`)}.</p>
<p>${EMPRESA} — CNPJ/CPF ${CNPJ}${optional("address", ` — ${ENDERECO}`)}</p>
`,
);
