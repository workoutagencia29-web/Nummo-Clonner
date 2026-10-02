/**
 * LEIA-ME.txt do ZIP (pt-BR): o que tem dentro, como subir na hospedagem
 * (Hostinger, HostGator, cPanel, Netlify…), como funciona o teste A/B, o que o
 * eventos.php precisa e como testar.
 */

export interface ReadmeSplit {
  /** Nome da página ("Página principal"). */
  page: string;
  /** Pasta da página no ZIP ("" = raiz). */
  dir: string;
  /** Versões: pasta relativa à da página e percentual no divisor. */
  variants: { name: string; folder: string; percent: number }[];
  /** O index.html da página é o divisor (senão, é a versão de controle). */
  splitter: boolean;
}

export interface ReadmeInput {
  offerName: string;
  /** Data da última alteração da oferta (dd/mm/aaaa). */
  date: string;
  /** Páginas: nome e pasta ("" = raiz). */
  pages: { name: string; dir: string; mobile: boolean }[];
  splits: ReadmeSplit[];
  /** Plataformas do eventos.php (vazio = sem eventos.php). */
  serverEvents: string[];
  /** Páginas "Preservar JS". */
  preserveJs: string[];
  /** Páginas de obrigado/upsell que saíram fora do Google (noindex) por padrão. */
  hiddenFromSearch?: string[];
  warnings: string[];
}

const LINE = "=".repeat(64);

function where(dir: string) {
  return dir ? `${dir}` : "(raiz)";
}

/** "oferta-a/ e oferta-b/", "oferta-a/, oferta-b/ e oferta-c/". */
function folderList(folders: string[]) {
  if (folders.length <= 1) return folders.join("");
  return `${folders.slice(0, -1).join(", ")} e ${folders[folders.length - 1]}`;
}

export function leiaMe(input: ReadmeInput): string {
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);
  const splitAt = new Map(input.splits.map((s) => [s.dir, s]));

  push(
    LINE,
    `  ${input.offerName}`,
    `  Oferta exportada pelo Offer Studio (última alteração em ${input.date})`,
    LINE,
    "",
    "O QUE TEM NESTE ZIP",
    "-------------------",
    "",
  );
  for (const page of input.pages) {
    const index = page.dir ? `${page.dir}index.html` : "index.html";
    const mobile = page.mobile ? " (com versão celular)" : "";
    const split = splitAt.get(page.dir);
    if (split?.splitter) {
      push(
        `  ${index}  →  divisor A/B de ${page.name} (sorteia entre ${folderList(split.variants.map((v) => v.folder))})`,
      );
    } else if (split) {
      push(`  ${index}  →  ${page.name} — versão ${split.variants[0]?.name ?? "A"}, sem divisor${mobile}`);
    } else {
      push(`  ${index}  →  ${page.name}${mobile}`);
    }
    for (const v of split?.variants ?? []) {
      push(`  ${page.dir}${v.folder}  →  ${page.name} — versão ${v.name}`);
    }
  }
  push(
    "  assets/  →  imagens, estilos, fontes, vídeos e scripts das páginas",
    "  404.html  →  página “não encontrada” (endereço errado ou antigo)",
    ...(input.serverEvents.length
      ? [
          "  eventos.php  →  envio de eventos pelo servidor (API de Conversões / Events API)",
          "  eventos-dados/config.php  →  tokens usados pelo eventos.php (NÃO compartilhe)",
          "  eventos-dados/.htaccess  →  bloqueia a pasta dos tokens (arquivo oculto no Mac/Windows)",
        ]
      : []),
    "  LEIA-ME.txt  →  este arquivo (não precisa subir para a hospedagem)",
    "",
    "Os links entre as páginas são relativos: a oferta funciona na raiz do",
    "domínio (meusite.com/) ou numa subpasta (meusite.com/oferta/). Nos",
    "anúncios e links, use o endereço COM a barra no fim (meusite.com/oferta/):",
    "algumas hospedagens não completam a barra sozinhas e a página carrega mais",
    "devagar.",
    "",
    "",
    "COMO SUBIR NA HOSPEDAGEM",
    "------------------------",
    "",
    "Hostinger (hPanel), HostGator, Locaweb, KingHost (cPanel ou painel próprio):",
    "  1. Abra o Gerenciador de Arquivos da hospedagem.",
    "  2. Entre na pasta public_html (raiz do domínio) — ou crie uma subpasta",
    "     dentro dela, por exemplo public_html/oferta, para usar meusite.com/oferta/.",
    "  3. Se nessa pasta houver um arquivo padrão da hospedagem (default.php",
    "     ou index.php), apague: ele aparece no lugar da sua página.",
    '  4. Envie este ZIP para essa pasta ("Fazer upload" na Hostinger,',
    '     "Carregar" no cPanel) e depois clique nele com o botão direito e use',
    '     "Extrair". Na Hostinger, deixe o nome da pasta em branco (ou ".") e o',
    "     destino como a pasta atual; ao atualizar a oferta, marque",
    '     "Sobrescrever arquivos existentes".',
    "  5. Confira que o index.html ficou DIRETO nessa pasta (e não dentro de",
    "     outra pasta com o nome do ZIP). Depois apague de lá o ZIP e este",
    "     LEIA-ME.txt (ele lista as pastas da oferta e não precisa ficar no ar).",
    "",
    'Netlify (arraste a pasta em "Deploy manually") ou Cloudflare Pages',
    '("Upload assets"), só arquivos, sem PHP:',
    "  Descompacte o ZIP e envie a pasta (sem o LEIA-ME.txt, se quiser). Envie",
    "  junto o 404.html: sem ele, a Cloudflare Pages mostra a página inicial em",
    "  qualquer endereço errado.",
    ...(input.serverEvents.length ? ["  ATENÇÃO: nesses serviços o eventos.php NÃO funciona. Veja abaixo."] : []),
    "",
    "FTP (FileZilla): descompacte o ZIP no computador e envie todo o conteúdo",
    "para public_html (ou para a subpasta), mantendo as pastas.",
    "",
    "Baixou pelo Safari e apareceu uma pasta em vez do .zip? O Safari abre o",
    "ZIP sozinho e manda o .zip para a Lixeira: pegue o .zip lá (para não",
    'acontecer de novo: Safari > Ajustes > Geral > desmarque "Abrir arquivos',
    "'seguros' após o download\"). Não compacte a pasta de novo: o ZIP ficaria",
    "com uma pasta a mais e a página iria para meusite.com/nome-da-pasta/.",
    "",
  );

  if (input.splits.length) {
    push("", "TESTE A/B", "---------", "");
    for (const split of input.splits) {
      push(`${split.page} — pasta ${where(split.dir)}`);
      for (const v of split.variants) {
        push(`  ${split.dir}${v.folder}  →  versão ${v.name}${split.splitter ? ` (${v.percent}% das visitas)` : ""}`);
      }
      if (split.splitter) {
        push(
          `  ${split.dir || ""}index.html  →  divisor: sorteia a versão de cada visitante pelo percentual`,
          "  e manda para a pasta dela, mantendo as UTMs e os parâmetros do anúncio.",
          "  O visitante volta para a mesma versão por até 30 dias no mesmo navegador",
          "  (no iPhone/Safari, cerca de 7 dias; o navegador do Instagram/Facebook",
          "  guarda a escolha separado do Safari/Chrome).",
        );
      } else {
        push(`  ${split.dir || ""}index.html  →  versão ${split.variants[0]?.name ?? "A"} (sem divisor)`);
      }
      push("");
    }
    const withSplitter = input.splits.some((s) => s.splitter);
    if (withSplitter) {
      push(
        "Você também pode mandar o tráfego direto para uma versão: use o endereço",
        "da pasta dela nos anúncios (ex.: meusite.com/oferta-b/). Quem entra direto",
        "numa versão continua nela se voltar ao endereço principal.",
      );
    }
    if (input.splits.some((s) => !s.splitter)) {
      push(
        "Sem o divisor, o endereço da página mostra sempre a versão de controle; as",
        "outras versões só abrem pelo endereço da pasta delas (ex.:",
        "meusite.com/oferta-b/). Para testar, mande o tráfego de cada anúncio para",
        "a pasta de uma versão.",
      );
    }
    push(
      "As versões avisam o Google qual é a página principal (canonical), para",
      "não contar como conteúdo duplicado.",
      "",
      "COMO COMPARAR AS VERSÕES",
      "Cada versão diz qual ela é em todos os eventos dos pixels (parâmetro",
      "os_versao = A, B…, também pelo eventos.php) e marca o link do checkout.",
      "  • Meta: crie uma conversão personalizada de InitiateCheckout (ou Lead)",
      "    pelo parâmetro do evento os_versao igual a B (uma para cada versão),",
      '    ou com "URL contém /oferta-b/".',
      "  • GA4: em Administrador > Definições personalizadas, crie a dimensão",
      '    personalizada "os_versao" (escopo: evento) e use nos relatórios; a',
      '    dimensão "Caminho da página" também separa as versões.',
      "  • TikTok e Kwai: os eventos levam os_versao (o PageView deles não aceita",
      "    parâmetros).",
      '  • Vendas de cada versão: o checkout recebe "versao-a", "versao-b"…',
      "    - Hotmart, Kiwify e Eduzz: no parâmetro src (aparece como origem da",
      "      venda no relatório). O sck e o xcod (UTMify) nunca são tocados.",
      "    - Outras plataformas: no utm_content, só quando o visitante chegou",
      "      sem utm_content: o do anúncio (nome|ID) é o que a UTMify e a",
      "      plataforma usam para saber qual anúncio vendeu e nunca é trocado.",
      "    Se o link de checkout (ou o visitante) já trouxer src/utm_content, ele",
      "    fica como está e a versão não vai no checkout. Para separar as vendas",
      "    nesse caso, use um link de checkout diferente em cada versão (outro",
      "    código de oferta, ex.: off= na Hotmart, ou outro link na Kiwify).",
      "    O UTMify sozinho NÃO separa as versões (as UTMs são as mesmas nas duas).",
    );
    if (withSplitter) {
      push(
        "  • O divisor não apaga a origem da visita (Instagram, Google, outro",
        "    site): o GA4 e os pixels continuam vendo de onde o visitante veio,",
        "    mesmo sem UTMs. Ainda assim, use UTMs nos links dos anúncios.",
        "",
        "O divisor guarda a versão vista num cookie funcional (os_ab_…): ele só",
        "lembra a pasta da versão, não identifica o visitante.",
      );
    }
    push("");
  }

  if (input.pages.some((p) => p.mobile)) {
    push(
      "",
      "VERSÃO CELULAR",
      "--------------",
      "",
      "Páginas com versão celular separada: quem abre pelo celular vai sozinho",
      "para a pasta celular/ dela. Para ver a versão de computador no celular,",
      "acrescente ?versao=computador ao endereço.",
      "",
    );
  }

  if (input.serverEvents.length) {
    push(
      "",
      "EVENTOS PELO SERVIDOR (eventos.php)",
      "-----------------------------------",
      "",
      `Plataformas: ${input.serverEvents.join(", ")}.`,
      "",
      "O eventos.php manda os eventos também pelo servidor (API de Conversões da",
      "Meta / Events API do TikTok), junto com os pixels do navegador. As",
      "plataformas juntam os dois pelo event_id (sem contar duas vezes).",
      "",
      "A HOSPEDAGEM PRECISA TER PHP 7.4 OU MAIS NOVO (Hostinger, HostGator,",
      "Locaweb, KingHost e qualquer cPanel têm). Em hospedagem só de arquivos",
      "(Netlify, Vercel, GitHub Pages, Cloudflare Pages), NÃO suba o",
      "eventos.php nem a pasta eventos-dados: lá eles seriam mostrados como",
      "texto e qualquer pessoa veria os seus tokens.",
      "",
      "Site atrás de um CDN (proxy) que não seja a Cloudflare? Troque",
      "'trust_proxy' => false por 'trust_proxy' => true no eventos-dados/config.php",
      "para o IP certo do visitante chegar à Meta (a Cloudflare já é reconhecida).",
      "",
      "Como testar depois de subir:",
      "  1. Abra meusite.com/eventos.php — deve aparecer",
      '     "eventos.php do Offer Studio funcionando."',
      "     Se aparecer um código começando com <?php, a hospedagem NÃO roda PHP:",
      "     apague o eventos.php e a pasta eventos-dados de lá.",
      "  2. Abra meusite.com/eventos-dados/config.php — deve dar erro (página",
      "     não encontrada ou acesso negado). NUNCA pode mostrar os tokens.",
      '  3. No Gerenciador de Eventos da Meta (aba "Testar eventos") ou no',
      "     TikTok Events Manager, abra a sua página e aceite os cookies: o",
      '     evento aparece como "Navegador" e "Servidor".',
      "",
    );
  }

  if (input.preserveJs.length) {
    push(
      "",
      'PÁGINAS "PRESERVAR JS"',
      "----------------------",
      "",
      `Páginas: ${input.preserveJs.join(", ")}.`,
      "",
      "Essas páginas mantêm os scripts originais do site e buscam arquivos nos",
      "caminhos originais (ex.: /js/app.js). Por isso só funcionam com a oferta",
      "na RAIZ do domínio (public_html), não numa subpasta. Arquivos do site",
      "original que a hospedagem executaria (.php, .htaccess…) nunca vão no ZIP.",
      "",
    );
  }

  push(
    "",
    "COMO TESTAR",
    "-----------",
    "",
    "  • Depois de subir, abra o endereço da oferta no computador e no celular,",
    "    clique nos botões e siga o funil até o checkout.",
    "  • Teste com UTMs (ex.: meusite.com/?utm_source=teste) e confira se elas",
    "    chegam ao checkout.",
    "  • Para uma olhada rápida antes de subir, descompacte o ZIP e abra o",
    "    index.html. Aberto do computador, as fontes podem aparecer diferentes,",
    '    os pixels não funcionam e as páginas "Preservar JS" só funcionam depois',
    "    de subir na hospedagem.",
    "  • Mudou algo no Offer Studio? Gere um ZIP novo e envie de novo,",
    '    substituindo os arquivos (no FileZilla, escolha "Sobrescrever", e não',
    '    "Sobrescrever se a origem for mais nova").',
    "",
  );

  if (input.hiddenFromSearch?.length) {
    push(
      `As páginas ${input.hiddenFromSearch.map((n) => `“${n}”`).join(", ")} (obrigado/upsell) saem fora do Google`,
      '(noindex). Para mudar, use "SEO da página" no Offer Studio.',
      "",
    );
  }

  if (input.warnings.length) {
    push("", "AVISOS DESTA EXPORTAÇÃO", "-----------------------", "");
    for (const w of input.warnings) push(`  • ${w}`);
    push("");
  }

  // BOM + CRLF: acentos e quebras de linha certos no Bloco de Notas do Windows.
  return `﻿${out.join("\r\n")}\r\n`;
}
