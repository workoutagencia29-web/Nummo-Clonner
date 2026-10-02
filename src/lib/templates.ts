/**
 * Estilo base de páginas criadas do zero (vai para a folha base em camada, então
 * qualquer ajuste feito no editor vence).
 */
export const BASE_PAGE_CSS = `*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:18px;line-height:1.6;color:#1f2430;background:#ffffff}
img,video,iframe{max-width:100%}
img{height:auto;display:block}
h1,h2,h3,h4{line-height:1.2;margin:0 0 .5em}
p{margin:0 0 1em}
a{color:inherit}`;

/** HTML inicial de uma página criada do zero (o editor adiciona os blocos). */
export function blankPageHtml(title: string) {
  const safeTitle = title.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<style>${BASE_PAGE_CSS}</style>
</head>
<body>
</body>
</html>`;
}
