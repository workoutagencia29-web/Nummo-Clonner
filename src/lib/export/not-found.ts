/**
 * 404.html na raiz do ZIP: a página "não encontrada" de quem abre um endereço
 * que não existe (link antigo, digitado errado).
 *
 * Também muda como as hospedagens só de arquivos tratam esses endereços: sem
 * um 404.html na raiz, a Cloudflare Pages entende que o site é um aplicativo
 * de uma página só e entrega o index.html para QUALQUER caminho — com o divisor
 * A/B na raiz, "/promo/" iria para "/promo/oferta-b/", que também não existe,
 * e assim por diante. Com ele, a Cloudflare Pages, a Netlify, a Vercel e o
 * GitHub Pages respondem "não encontrada" (código 404). No Apache/cPanel ele só
 * aparece se a hospedagem estiver configurada para usar o 404.html.
 *
 * Arquivo sem nada de fora (nem CSS, nem scripts): ele pode ser entregue em
 * qualquer pasta, então os endereços relativos não valem aqui — o link vai
 * para a raiz do site ("/").
 */

export const NOT_FOUND_FILE = "404.html";

const TEXTS = {
  pt: {
    lang: "pt-BR",
    title: "Página não encontrada",
    text: "O endereço que você abriu não existe ou mudou.",
    link: "Ir para a página inicial",
  },
  en: {
    lang: "en",
    title: "Page not found",
    text: "The address you opened does not exist or has changed.",
    link: "Go to the home page",
  },
  es: {
    lang: "es",
    title: "Página no encontrada",
    text: "La dirección que abriste no existe o cambió.",
    link: "Ir a la página de inicio",
  },
} as const;

/** Textos no idioma das páginas da oferta ("en", "es"; o resto, português). */
function textsFor(language: string | null | undefined) {
  const base = (language ?? "").toLowerCase().split("-")[0];
  return base === "en" ? TEXTS.en : base === "es" ? TEXTS.es : TEXTS.pt;
}

/** Conteúdo do 404.html (noindex, sem arquivos externos). */
export function notFoundHtml(language?: string | null): string {
  const t = textsFor(language);
  return [
    "<!doctype html>",
    `<html lang="${t.lang}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${t.title}</title>`,
    "<style>html,body{margin:0;background:#fff;color:#18181b;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}main{max-width:32rem;margin:0 auto;padding:22vh 24px 48px;text-align:center}h1{font-size:1.5rem;margin:0 0 .75rem}p{margin:0 0 1.5rem;color:#52525b;line-height:1.5}a{display:inline-block;padding:.7rem 1.2rem;border-radius:.5rem;background:#18181b;color:#fff;text-decoration:none}</style>",
    "</head>",
    `<body><main><h1>${t.title}</h1><p>${t.text}</p><a href="/">${t.link}</a></main></body>`,
    "</html>",
    "",
  ].join("\n");
}
