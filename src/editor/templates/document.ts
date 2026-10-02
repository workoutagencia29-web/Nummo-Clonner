/** Monta o documento HTML completo de um modelo. */

export function escapeHtml(text: string) {
  return text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function pageDocument(opts: { title: string; css: string; body: string }) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<style>${opts.css}</style>
</head>
<body>
${opts.body.trim()}
</body>
</html>
`;
}
