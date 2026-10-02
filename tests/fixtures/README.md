# Sites de teste do clonador (offline)

Páginas de oferta brasileiras pequenas, com todos os arquivos locais, para os testes de integração do clonador (Fase 2). Nada aqui depende de internet.

## Servidor

```ts
import { startFixtureServer, fixtureChromiumArgs, fixtureLookup } from "../fixtures/server";

const srv = await startFixtureServer(); // porta aleatória em 127.0.0.1
srv.url("vendas", "/upsell"); // http://vendas.fixture.test:<porta>/upsell
srv.requests; // [{ host, path, ua }] de cada requisição (zere com srv.requests.length = 0)
await srv.close();
```

- O Host `<nome>.fixture.test` aponta para `sites/<nome>/`. Pasta sem barra (`/upsell`) serve `upsell/index.html` direto, sem redirecionar. A query string é ignorada (`style.css?ver=1.0.3`).
- Chromium: `chromium.launch({ args: fixtureChromiumArgs() })` (usa `--host-resolver-rules=MAP *.fixture.test 127.0.0.1`). Node/undici: `new Agent({ connect: { lookup: fixtureLookup } })`.
- Nos arquivos de texto, `__ORIGIN__` vira a origem real (`http://vendas.fixture.test:<porta>`). Serve para simular URLs absolutas do próprio site (og:image, CSS do Elementor).
- Arquivos e pastas que começam com `_` ou `.` nunca são servidos (`_site.json`, `_expected.json`). Só GET e HEAD, e não há suporte a Range.
- `_site.json`: `charset` (Content-Type dos textos; o arquivo vai como está), `uaSplit` (User-Agent com iPhone, Android ou Mobile recebe `index.mobile.html`), `challenge` (sempre 403 com `cf-mitigated: challenge` e a página "Just a moment..."), `delayMs` (atraso em todas as respostas).
- Uso manual: `npx tsx tests/fixtures/server.ts [porta]`.
- `sites/<nome>/_expected.json` traz o que cada site deveria produzir (checkouts, rastreadores, vídeos, atraso…), para os testes usarem como gabarito.

## Sites

| Site | O que testa |
|---|---|
| `vendas` | Página Elementor/WordPress: cadeia `@import` a→b→c, `@font-face` com woff2 em outra pasta, fundos no CSS e em `style=""`, imagens preguiçosas (`data-src`, `data-srcset`, `data-bg`, `.lazyload`), `<picture>` com webp/jpg e `srcset`, fundo preguiçoso do Elementor (`e-lazyloaded`), og:image absoluta, favicon, contador em JS próprio, FAQ `<details>`, depoimentos, Hotmart 3× o mesmo link (com `&amp;` e `&`) + 1 oferta diferente, WhatsApp, links `/upsell`, `/obrigado` e privacidade (as três páginas existem). |
| `vsl` | VSL VTurb: `<vturb-smartplayer id="vid-abc123">` + player.js externo (ausente offline), 2 seções `.esconder` (uma com checkout Kiwify), script de atraso `SECONDS_TO_DISPLAY = 332` / `displayHiddenElements`, iframe do YouTube, `<video autoplay muted playsinline>` com mp4 local. |
| `rastreadores` | Códigos base de Meta Pixel (+ noscript), TikTok, Kwai, GTM (head + noscript no body), GA4, Google Ads, UTMify (pixel + `latest.js` com `data-utmify-prevent-subids`), Hotjar, Clarity, Pinterest, Taboola, JivoChat, Tawk.to, meta `facebook-domain-verification` e preconnect. Devem sobreviver: `main.js` local, JSON-LD, player VTurb, script inline do ano e o noscript de aviso. |
| `checkouts` | 20 botões de compra de tipos diferentes: href de várias plataformas, `onclick`, `window.open`, `data-href`, `form action`, JSON do `data-settings` do Elementor, URL montada em script, `//` sem protocolo e checkout desconhecido. Negativos: wa.me, âncoras "Comprar", `/upsell`, mailto e Instagram. |
| `legado` | HTML, CSS e JS em ISO-8859-1 (bytes Latin-1 reais, também no `content:` do CSS), `<base href="/sub/">`, CSS com `integrity` sha384 correto + `crossorigin`, truque `media="print" onload`. |
| `quiz` | Quiz em JS puro: 5 perguntas + resultado com checkout (URL só no `QUIZ_CONFIG`). Sem JS (retrato estático) só a etapa 1 existe. |
| `celular` | `uaSplit`: "Versão desktop" e "Versão celular" com CSS e imagens diferentes. |
| `protegido` | `challenge`: 403 com `cf-mitigated: challenge` em qualquer caminho. |
| `grande` | 230 cartões (~3000 elementos), CSS com ~2000 regras, 10 imagens repetidas e um checkout 230×. |
| `shadow` | `<oferta-card>` com shadow root aberto (texto, imagens e checkout só lá dentro) e CSS-in-JS via `insertRule` (o `<style>` fica vazio e a página só aparece se o CSSOM for serializado). |
| `lento` | `delayMs: 400` em todas as respostas (página e CSS). |
| `presto` | WordPress/Elementor com Presto Player: `<presto-player>` (web component com o CSS em `adoptedStyleSheets` do shadow root e ícones SVG sem tamanho) com vídeo do YouTube (`//www.youtube.com/embed/…`, canto de 18px em `--presto-player-border-radius`) e com mp4 relativo + capa; títulos `.elementor-invisible` que só aparecem com o script; `<selo-garantia>` com CSS só em `adoptedStyleSheets`; checkout Cakto. |

## ZIPs (`zips/`)

- `good.zip`: página salva pelo navegador, com `Página.html` e a pasta `Página_files/`. Tem acentos nos nomes (flag UTF-8), comentário `saved from url`, uma referência codificada (`P%C3%A1gina_files/`), `fbevents.js` salvo localmente e um segundo HTML (`saved_resource.html`).
- `slip.zip`: `index.html` + `../evil.txt` + `Página_files/../../evil2.txt` (zip slip).

## Regerar

```sh
npx tsx tests/fixtures/generate-assets.ts   # imagens, fonte, mp4, site legado (Latin-1) e site grande
npx tsx tests/fixtures/make-zips.ts         # good.zip e slip.zip (bytes determinísticos)
```

O teste de fumaça fica em `tests/unit/fixtures-server.test.ts`. Ele também confere que todo arquivo local referenciado pelos sites existe.

`sites/biome.json` desliga o Biome dentro de `sites/`. Os arquivos imitam páginas reais (CSS minificado, snippets de terceiros, Latin-1) e não devem ser formatados.
