# Offer Studio

Plataforma local para **clonar páginas de oferta, editar visualmente (estilo Elementor), configurar pixels e baixar tudo em ZIP** pronto para subir em qualquer hospedagem.

O Offer Studio roda **no seu Mac**: abre no navegador, e todos os dados (banco, arquivos) ficam na pasta `data/` deste projeto. Os backups vão para a pasta que você escolher (Documentos, iCloud Drive ou outra).

> Status: **as 6 fases estão concluídas** — base (login, dashboard, pastas, tags, lixeira), **clonador**, **editor visual**, **pixels/rastreamento**, **Baixar ZIP** (com teste A/B medido por versão) e **backup automático** com restauração. Veja [docs/PLANO.md](docs/PLANO.md).

---

## Instalação (primeira vez)

Pré-requisito: **Node.js 24** ([nodejs.org](https://nodejs.org)). Não é preciso instalar banco de dados, Docker nem nada além disso — o PostgreSQL vem embutido no projeto.

O jeito mais simples: **dê dois cliques em `Abrir Offer Studio.command`**. Na primeira vez ele instala as dependências e prepara o banco sozinho (alguns minutos). Pelo Terminal, o mesmo é:

```bash
npm install
npm run setup
npx playwright install chromium
```

O `setup` cria o arquivo `.env` com senhas aleatórias, o banco de dados em `data/postgres` e aplica a estrutura das tabelas. Pode rodar de novo quando quiser: ele só faz o que falta. O último comando baixa o Chromium que o clonador usa para abrir as páginas.

> **Guarde o arquivo `.env`** (fica oculto no Finder; Cmd+Shift+. mostra). Ele tem a senha do banco e a chave que protege os tokens dos pixels. O backup do Offer Studio já leva essa chave, mas uma cópia do `.env` em lugar seguro não faz mal.

No primeiro acesso, o app pede para você **criar o login** (nome, e-mail e senha). Só existe uma conta. Numa instalação nova, a mesma tela oferece **Restaurar de um backup** (para trazer tudo de outro Mac).

---

## Uso diário

**Dê dois cliques em `Abrir Offer Studio.command`.**

- Uma janela do Terminal abre e liga tudo: banco de dados, painel e robô de tarefas.
- O navegador abre sozinho em **http://localhost:3000**.
- **Deixe a janela aberta** enquanto usa. Para desligar, feche a janela (ou aperte Ctrl+C nela).

> Se o macOS disser que não pôde verificar o "Abrir Offer Studio.command": abra **Ajustes do Sistema →
> Privacidade e Segurança**, role até a mensagem sobre o arquivo e clique em **Abrir Mesmo Assim**.
> (No macOS 14 ou anterior: botão direito no arquivo → Abrir.) Só precisa fazer isso uma vez. O mesmo vale para o "Redefinir senha.command".

**O painel.** O menu lateral tem **Clonar oferta**, **Nova oferta**, **Todas as ofertas**, **Lixeira**, **Configurações** e as suas **pastas**. Na lista de ofertas dá para buscar, filtrar por pasta, tag e status (Rascunho, No ar, Arquivada) e, no menu **⋯** de cada card: abrir, renomear, duplicar, mover para pasta, tags, status, **Baixar ZIP** e mover para a lixeira (com **Desfazer** no aviso). Na lixeira, as ofertas podem voltar ou ser apagadas de vez.

---

## Clonar uma oferta

1. Clique em **Clonar oferta** (menu lateral) e cole o link da página. Em **Capturar**, deixe **Computador** e **Celular** marcados. Também dá para enviar um **ZIP** (página salva pelo navegador) ou **colar o HTML**.
2. Acompanhe o progresso e o registro ao vivo. O robô abre a página no computador e no celular, rola até o fim para carregar tudo, baixa imagens, fontes, CSS e vídeos e **bloqueia pixels e chats do dono original**.
3. Na **revisão**:
   - veja a cópia (Computador/Celular) ao lado do print do original;
   - escolha o modo: **Editável** (página estática, 100% editável — recomendado para a maioria) ou **Com scripts** (o antigo "Preservar JS": mantém os scripts do site; para quizzes e páginas-aplicativo). Se a página tem um contador regressivo, a revisão avisa que no modo Editável ele fica parado (troque pelo bloco **Contador regressivo** no editor ou use "Com scripts");
   - confira os rastreadores removidos (marque só o que quiser manter), os links de checkout encontrados e os vídeos de terceiros;
   - em **Páginas do funil**, marque as sugestões (upsell, downsell, obrigado) ou cole o link e clique em **Clonar páginas selecionadas**.
4. **Salvar oferta**: cria a oferta com todas as páginas, já ligadas entre si. Os checkouts encontrados viram **links da oferta** (aba "Links e checkouts").

A cópia não depende do site original: todos os arquivos ficam em `data/storage`. Páginas com proteção anti-robô (Cloudflare etc.) são detectadas e explicadas — nesse caso salve a página no navegador (Chrome, Edge ou Firefox: Arquivo → Salvar como → Página completa), compacte em .zip e importe pela aba **Arquivo ZIP**. O `.webarchive` do Safari não serve.

> Clonar textos, imagens, marcas e vídeos de terceiros pode violar direitos autorais. A responsabilidade pelo uso é sua.

---

## A tela da oferta

No topo ficam o nome, o status, o **Baixar ZIP** e o menu **Ações**. Logo abaixo, o cartão **Próximos passos** mostra o que falta para a oferta sair pronta, cada item com um atalho:

- botões de compra sem link, ou links que ainda levam ao **checkout da página clonada** (troque pelo seu);
- marcadores `{{EMPRESA}}`, `{{CNPJ}}`, `{{EMAIL}}` sem os dados da empresa;
- pixel (opcional), ZIP gerado e **Onde está no ar** (o endereço do site depois de subir).

O cartão pode ser recolhido e some quando o obrigatório está feito. As abas (a escolhida fica no endereço da página, então recarregar volta nela):

- **Páginas do funil** — a lista das páginas (arraste para reordenar). Em cada uma: **Editar** e o menu **⋯** (**Ver página**, Editar o layout do celular, Nome, endereço e tipo…, **SEO da página…**, **Teste A/B…**, Tornar página inicial, Duplicar página, Excluir página). **Adicionar página** usa a mesma galeria de modelos da "Nova oferta".
- **Links e checkouts** — os links nomeados da oferta (checkout principal, upsell, WhatsApp…). Os botões das páginas guardam só o nome do link: trocar o endereço aqui troca em **todos os botões de todas as páginas**. O endereço é conferido na hora (um `pay.kiwify` sem o final, por exemplo, é recusado com a explicação).
- **Pixels e rastreamento** — ver [Pixels e rastreamento](#pixels-e-rastreamento).
- **Empresa e SEO** — dados da empresa e SEO (ver [Empresa e SEO](#empresa-e-seo)).
- **Detalhes** — **Onde está no ar** (o endereço do site depois de subir o ZIP), a página original (de onde foi clonada) e notas. Nome, pasta, tags e status ficam no menu **Ações** do topo.

Os formulários das abas mostram **Alterações não salvas · Descartar · Salvar**; a aba com algo não salvo ganha um ponto, e sair da tela pergunta antes ("Sair sem salvar?"). Marcar a oferta como **No ar** pede o endereço onde ela está (pode deixar em branco).

---

## Editar uma página (editor visual)

Na oferta, clique em **Editar** ao lado da página. O editor abre em tela cheia (em telas com menos de 900 px de largura ele avisa e oferece **Ver página**):

- **Esquerda — Blocos / Camadas / Páginas.** Clique num bloco para colocá-lo logo abaixo do item selecionado (ou arraste para a página). São mais de 40 blocos prontos: títulos, textos, botões, **botão do checkout**, contador regressivo, barra de escassez, notificação de compra, tabela de preços, garantia, WhatsApp, popup de saída, vídeos (YouTube, Vimeo, VTurb, Panda ou arquivo), depoimentos, FAQ, formulário de captura (webhook e/ou redirecionamento) e rodapé com termos e política.
- **Centro — a página.** Um clique seleciona (num botão, seleciona o botão inteiro, com o link; outro clique entra no texto dele); **dois cliques num texto editam o texto**; dois cliques numa imagem trocam a imagem (ou **Configurações → Trocar imagem**). Use os botões Computador / Tablet / Celular no topo para ajustar cada tamanho de tela separadamente. O zoom aparece no topo ("50%"): **Tamanho real (100%)** mostra a página sem reduzir (role para os lados) e **[** / **]** escondem os painéis da esquerda e da direita para a página ficar maior.
- **Direita — Estilo e Configurações.** Cor, fonte, tamanho, espaçamento, fundo, borda (classes e estados como "ao passar o mouse" ficam em **Avançado**, no fim do Estilo) e, em Configurações, o **Link da oferta** do botão (checkout, upsell, WhatsApp…), a página do funil, o **Evento ao clicar**, o "Aparece depois de (segundos)" da VSL e as opções de cada bloco. Em "Link da oferta", **＋ Criar link da oferta…** cria o link e já liga o botão.
- **Topo:** desfazer/refazer (⌘Z / ⇧⌘Z), **Localizar e substituir** (nesta página ou em todas), **Links e checkouts** (todos os destinos da página, com troca em massa), **Código** (HTML do elemento, CSS da página e códigos livres do head/body), **Histórico** (salve um ponto de restauração com nome e volte a qualquer ponto), **Modo prévia** (a página rodando de verdade ali no editor, com os scripts) e **Ver página** (abre numa aba nova, como o visitante vê). "Versão" no editor é só a do teste A/B; páginas clonadas com celular separado têm o **layout do computador** e o **layout do celular**.

Tudo é salvo sozinho a cada alteração ("Salvo às …"); ⌘S salva na hora. Se a mesma página for alterada em outra aba, o editor pergunta o que fica.

**Montar do zero:** em **Nova oferta** (ou **Adicionar página**), escolha um modelo pronto na galeria: página de vendas longa, VSL, captura, upsell, downsell, obrigado, advertorial, política de privacidade, termos de uso ou em branco.

---

## Teste A/B (versões da página)

Na lista de páginas da oferta, abra o menu **⋯ → Teste A/B** da página (ou clique no selo **"N versões A/B"**):

- **Criar versão B (cópia da A)** é um clique (depois C, D e E — até 5 versões). Em **Modelo ou outra versão…** dá para começar de outra versão, de um modelo ou em branco, com um nome ("Headline nova"). O tráfego é dividido por igual entre as versões ativas (50/50, 34/33/33…); uma versão pausada (0%) continua pausada.
- **Divisão do tráfego**: digite o percentual de uma versão e as outras se ajustam para somar 100%. **Dividir por igual** e **Desfazer** ajudam. Uma versão com 0% fica pausada.
- Em cada versão: **Editar**, **Ver página** e, no **⋯**, **Dar um nome**, **Tornar controle** (a versão principal, que o Google vê) e **Excluir versão** (o percentual dela vai para as outras).
- No **editor**, o seletor **Versão A / B / …** no topo troca de versão (salva antes e mantém Computador/Celular).

No ZIP, cada versão vai para uma pasta própria (`oferta-a/`, `oferta-b/`…) e o `index.html` da página vira o **divisor**, que sorteia a versão de cada visitante pelo percentual, mantém as UTMs e o `fbclid` e lembra a escolha por 30 dias.

**Como comparar as versões:**

- Todo evento leva a versão vista em **`os_versao`** (A, B…): Meta (parâmetro do evento), GA4 (parâmetro + propriedade de usuário), TikTok/Kwai (menos o PageView deles, que não aceita parâmetros) e `eventos.php`.
- O link do checkout ganha a marca **`versao-a`/`versao-b`**: no parâmetro `src` na Hotmart, Kiwify e Eduzz (o `sck`/`xcod` nunca muda) e no `utm_content` nas outras plataformas. A marca só entra quando o parâmetro ainda não existe: um `utm_content` que veio do anúncio (o "nome|ID" que a UTMify lê) **nunca é alterado**. Nessas plataformas, para separar as vendas do tráfego pago por versão, use um link de checkout diferente em cada versão.
- Na **Prévia** e no **Testar pixels**, a versão aberta também vai nos eventos.

---

## Baixar ZIP e subir na hospedagem

Na oferta, clique em **Baixar ZIP** (no topo; também está no menu **⋯** do card da oferta). A janela mostra **o que vai no ZIP** (pastas e arquivos), os **avisos** do que falta (cada um com o conserto ali mesmo: dados da empresa, endereço do site, botão sem link com "Abrir no editor") e três opções:

- **Divisor A/B** (ligado): só aparece quando alguma página tem versões. Desligado, o `index.html` da página é a versão de controle e as outras ficam só nas pastas delas.
- **API de Conversões (Meta) / Events API (TikTok)** (desligado): inclui o `eventos.php`, que manda os eventos também pelo servidor. Só aparece quando um pixel tem o envio pelo servidor ligado e o token salvo. **Só ligue se a hospedagem tiver PHP** (Hostinger, HostGator, Locaweb, KingHost, qualquer cPanel).
- **HTML otimizado** (ligado): tira comentários e espaços sobrando. Scripts e visual não mudam.

Clique em **Gerar ZIP**: o download começa sozinho quando fica pronto (alguns segundos). Os 5 últimos ZIPs de cada oferta ficam em **ZIPs anteriores**, para baixar de novo.

> **Safari:** ele pode abrir o ZIP sozinho. Se em **Downloads** aparecer uma pasta em vez do arquivo `.zip`, pegue o `.zip` na **Lixeira** (para não acontecer de novo: Safari → **Ajustes** → **Geral** → desmarque "Abrir arquivos 'seguros' após o download"). **Não compacte a pasta de novo**: o ZIP ficaria com uma pasta a mais e a página iria para `seudominio.com.br/nome-da-pasta/`.

**O que vem no ZIP**

```
index.html                página inicial (ou o divisor A/B dela)
oferta-a/, oferta-b/…     versões A/B da página inicial
upsell/, obrigado/…       outras páginas do funil (uma pasta por página)
…/celular/                versão celular separada (clones de sites não responsivos)
assets/                   imagens, estilos, fontes, vídeos e os scripts das páginas
eventos.php               opcional (API de Conversões / Events API)
eventos-dados/config.php  os tokens do eventos.php — NÃO compartilhe
eventos-dados/.htaccess   bloqueia a pasta dos tokens (arquivo oculto no Mac)
404.html                  página "não encontrada" (endereço errado ou antigo)
LEIA-ME.txt               este passo a passo, com os detalhes da sua oferta
```

Os endereços entre as páginas são **relativos**: a oferta funciona na raiz do domínio (`seudominio.com.br/`) ou numa subpasta (`seudominio.com.br/oferta/`). A exceção são as páginas clonadas no modo **Com scripts**, que só funcionam na raiz (a janela avisa).

### Hostinger (hPanel)

1. No hPanel, abra **Sites → Gerenciar → Arquivos → Gerenciador de arquivos**.
2. Entre na pasta **public_html**. Se houver o arquivo padrão **default.php** (ou um **index.php** que não é seu), apague: ele aparece no lugar da sua página.
3. Clique no ícone **Fazer upload de arquivos** e escolha o ZIP baixado.
4. Clique com o botão direito no ZIP → **Extrair**. Deixe o nome da pasta em branco (ou `.`) e o destino como `public_html` (ou a subpasta): se escrever um nome, a página vai para `seudominio.com.br/esse-nome/`. Ao atualizar a oferta com um ZIP novo, marque **Sobrescrever arquivos existentes**.
5. Confira que o `index.html` ficou **direto** em `public_html` (e não dentro de uma pasta com o nome do ZIP). Apague o ZIP e o `LEIA-ME.txt`.

### HostGator (cPanel)

1. No Portal do Cliente, entre no **cPanel** e abra **Gerenciador de Arquivos**.
2. Entre em **public_html** (ou crie uma pasta dentro dela, por exemplo `oferta`, para usar `seudominio.com.br/oferta/`). Apague o `index.php`/`default.php` padrão, se existir.
3. Clique em **Carregar** (Upload), envie o ZIP e volte para a pasta.
4. Selecione o ZIP → **Extrair** → confirme o caminho (`public_html` ou a subpasta) → **Extrair arquivo(s)** (*Extract File(s)* no painel em inglês). Ao atualizar a oferta, os arquivos novos substituem os antigos.
5. Confira que o `index.html` ficou direto na pasta e apague o ZIP e o `LEIA-ME.txt`.

> O `.htaccess` começa com ponto e fica oculto. No Gerenciador de Arquivos, **Configurações → Mostrar arquivos ocultos** faz ele aparecer. Ele fica dentro da pasta `eventos-dados/`, junto com o `config.php` dos tokens (o ZIP nunca traz um `.htaccess` na raiz: o da hospedagem continua valendo).

**Netlify, Cloudflare Pages e outras sem PHP:** descompacte o ZIP no computador e arraste a pasta para o painel (deploy manual). Gere o ZIP **sem** o `eventos.php`: sem PHP, o arquivo com o seu token ficaria visível.

**FTP (FileZilla):** descompacte o ZIP no computador e envie todo o conteúdo para `public_html` (ou para a subpasta), mantendo as pastas.

### Depois de subir, teste

- Abra a página com `?utm_source=teste` no fim do endereço e clique no botão de compra: o checkout deve receber `utm_source=teste`.
- Aceite os cookies e confira o pixel com a extensão **Meta Pixel Helper** (ou o **Testar eventos** do Gerenciador de Eventos).
- Com o `eventos.php`: abra `seudominio.com.br/eventos.php` — deve aparecer **"eventos.php do Offer Studio funcionando."**. Se aparecer código começando com `<?php` (ou o navegador baixar o arquivo), a hospedagem não tem PHP: **apague na hora** o `eventos.php` e a pasta `eventos-dados`. Abrir `seudominio.com.br/eventos-dados/config.php` tem que dar erro (nunca mostrar os tokens).
- Na oferta, preencha **Onde está no ar** (aba Detalhes) com o endereço do site e gere o ZIP de novo: a imagem de compartilhamento passa a aparecer no WhatsApp e no Facebook.
- Mudou algo no Offer Studio? Gere um ZIP novo e extraia por cima, substituindo os arquivos (na Hostinger, marque **Sobrescrever arquivos existentes**).

---

## Pixels e rastreamento

Cada oferta tem **os próprios pixels, eventos e checkouts**. Na oferta, abra a aba **Pixels e rastreamento**. Ela tem cinco partes:

- **Pixels** — Meta (Facebook e Instagram), TikTok, Kwai, Google Analytics 4, Google Ads e UTMify. Escolha a plataforma e cole o ID; se colar o **código inteiro** do pixel, o Offer Studio acha o ID sozinho. Pode haver vários pixels, até da mesma plataforma, e cada um pode ser pausado sem apagar.
  - **Google Ads**: cadastre o **rótulo de conversão** de cada evento (aceita o `AW-…/rótulo` inteiro). Evento sem rótulo não vira conversão.
  - **UTMify**: o pixel dela dispara PageView, ViewContent, InitiateCheckout e Lead sozinho. O **script de UTMs** da UTMify vem ligado. Não cadastre aqui o mesmo pixel da Meta que está na UTMify, ou os eventos contam duas vezes.
  - **API de Conversões (Meta) e Events API (TikTok)**: opcional, para hospedagens com PHP. O token fica **criptografado** no banco (chave `APP_ENCRYPTION_KEY` do `.env`), nunca aparece de novo na tela e **nunca vai para o HTML** da página: só para o `eventos-dados/config.php` do ZIP (veja [Baixar ZIP](#baixar-zip-e-subir-na-hospedagem)).
- **Eventos** — o **PageView é automático** em todas as páginas. **Usar recomendados** cria três regras: ViewContent depois de 15 s na página, InitiateCheckout no clique em qualquer checkout e Lead no envio de formulário. Em **Nova regra** você escolhe o evento (Lead, Contato, AddToCart, Compra…) e quando ele dispara:
  - ao abrir a página;
  - depois de X segundos (só conta com a aba visível);
  - ao rolar X%;
  - ao clicar num checkout;
  - ao clicar num **link da oferta** ou num elemento (seletor CSS);
  - ao enviar um formulário.

  Cada regra vale para a oferta inteira ou só para uma página. No **editor**, qualquer botão ou link tem **Configurações → Evento ao clicar**. Também dá para informar o valor e a moeda (vão com InitiateCheckout, AddToCart e Purchase) e trocar o nome de um evento numa plataforma.
- **Privacidade (LGPD)** — aviso de cookies com três modos:
  - **Pedir permissão** (padrão): os pixels só carregam depois do **Aceitar**, e o Google recebe o sinal pelo Consent Mode v2. O aviso aparece quando a oferta tem pixels ou código de marketing e, mesmo sem pixels, para quem chega de um anúncio com IDs de clique ou UTMs (eles esperam o "Aceitar");
  - **Só avisar**: botão "Entendi", e os pixels carregam direto (quem recusou quando a oferta pedia permissão continua sem pixels e ganha o botão "Cookies" para mudar de ideia);
  - **Sem banner**.

  Você define o texto, os botões, a posição, o tema claro ou escuro e a página da **política de privacidade**. O bloco **Rodapé com políticas** do editor, os rodapés dos modelos e o bloco **Preferências de cookies** têm o link que reabre o aviso. No modo "Sem banner", esse link some.
- **UTMs e checkout** — repassa `utm_*`, `fbclid`, `gclid`, `ttclid`, `kwai_click_id`, `src`, `sck` e `xcod` para os links de checkout e para as outras páginas do funil. Guarda os parâmetros por N dias (padrão 30), para a venda não perder a origem quando a pessoa volta depois. A lista de parâmetros é editável. Com **Pedir permissão**, os IDs de clique (`fbclid`, `gclid`…) só vão para o checkout depois do **Aceitar** e só quem aceitou fica com os parâmetros guardados; até a escolha, os IDs seguem entre as páginas do funil, e quem recusa fica só com as UTMs da visita atual.
- **Código livre** — scripts de outras ferramentas no `<head>` ou no `<body>` de todas as páginas da oferta, com a categoria de consentimento:
  - **Essencial** carrega sempre;
  - **Estatística** e **Marketing** esperam o "Aceitar".

  O código de cada página, colocado no editor em **Código → Códigos da página**, também tem categoria (lá mesmo ou aqui). O padrão é **Automático**: com pixel ou ferramenta de análise conhecida (Meta, Google, TikTok, Hotjar, RD Station, HubSpot…), espera o "Aceitar"; sem, carrega sempre. Pixel no HTML da página (mantido na clonagem ou colado no HTML de um elemento) carregaria antes do "Aceitar": os pixels mantidos na revisão da clonagem já vão para os códigos da página, e o painel avisa se ainda sobrar algum no HTML.

**Na prévia os pixels não carregam**, para não sujar seus dados. O aviso de cookies e o repasse de UTMs funcionam, e o console do navegador lista os pixels desligados.

### Testar pixels

Na aba **Pixels e rastreamento**, clique em **Testar pixels**:

1. Escolha a página (e a versão, se houver teste A/B) e clique em **Iniciar teste**.
2. Clique em **Abrir página de teste**. A página abre numa aba nova, com os **pixels de verdade**. O link também pode ser copiado para abrir em outro navegador ou no celular.
3. Aceite os cookies, clique nos botões e envie os formulários. O painel mostra ao vivo, para cada plataforma:
   - se o pixel carregou;
   - cada evento disparado (com a versão A/B, quando houver);
   - o que foi **bloqueado** (bloqueador de anúncios, cookies recusados).

   Uma lista de conferência mostra o que ainda falta testar.

O teste dura 2 horas e segue pelas páginas do funil. **Encerrar teste** desliga o link na hora. Para conferir na plataforma, use também o **Meta Pixel Helper** ou o **Testar eventos** do Gerenciador de Eventos.

### Empresa e SEO

Na aba **Empresa e SEO**, os dados da empresa (nome, CNPJ ou CPF, e-mail, telefone, endereço) substituem os marcadores `{{EMPRESA}}`, `{{CNPJ}}` e outros das páginas de política, termos e rodapés, na prévia e no ZIP. Ali também ficam o SEO padrão da oferta (título, descrição, favicon, imagem de compartilhamento, aparecer ou não no Google) e o idioma (o padrão, "Igual à página", mantém o idioma que cada página já declara). Cada página pode ter o próprio SEO, por essa aba ou pelo menu **⋯ → SEO da página** na lista de páginas.

---

## Backup e restauração

Em **Configurações → Backup**:

- **Pasta dos backups**: **Documentos › Offer Studio Backups** (padrão), **iCloud Drive › Offer Studio Backups** (recomendado: fica fora do Mac — se ele quebrar ou for roubado, o backup continua na sua iCloud) ou **Outra pasta** (um disco externo, por exemplo; no Finder, botão direito na pasta segurando Option → "Copiar … como Caminho"). Trocar de pasta não move os backups antigos. Na primeira vez, o macOS pode perguntar se o Terminal pode acessar a pasta: clique em **Permitir**.
- **Backup automático todo dia** (ligado, às 03:00): roda com o Offer Studio aberto. Se o Mac estava desligado no horário, o backup sai assim que o Offer Studio abrir (quando o último automático tem mais de 24 h). **Quantos backups automáticos guardar** (padrão 10): os mais antigos são apagados; os manuais ficam até você excluir.
- **Fazer backup agora**: um backup manual na hora (alguns segundos).
- **O que vai no backup**: tudo do Offer Studio — ofertas, páginas e versões A/B, histórico, imagens e arquivos, links, pixels, regras de evento, configurações e a sua conta (e-mail e senha). Os ZIPs do "Baixar ZIP" ficam de fora (dá para gerar de novo). O arquivo leva os **tokens dos pixels** e a chave que os protege: **não envie o backup para ninguém**.
- O cartão **Sistema** mostra a saúde do backup ("Backup em dia" ou o que está errado).

**Restaurar:** na lista **Backups encontrados**, clique em **Restaurar** no backup desejado (ou **Restaurar de outro arquivo…** para um `.zip` de outra pasta). O Offer Studio confere o arquivo inteiro antes, mostra de quando ele é e de qual conta, pede para digitar **RESTAURAR** e faz um **backup de segurança** do estado atual ("Antes de restaurar") antes de trocar qualquer coisa. Durante a restauração a tela fica bloqueada com o andamento. No fim, todos os logins são encerrados: entre de novo com o **e-mail e a senha da conta do backup**. As configurações de backup deste Mac (pasta, horário) continuam as mesmas. Se algo der errado no meio, nada é alterado e os seus dados atuais continuam como estavam.

**Levar para outro Mac:** instale o Offer Studio no Mac novo, abra pelo atalho e, na primeira tela, clique em **Restaurar de um backup** (ele procura nas pastas Documentos e iCloud Drive). Backups de uma versão **mais nova** do Offer Studio não abrem numa mais antiga: atualize primeiro.

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm start` | Uso diário: liga tudo em modo produção (compila automaticamente depois de atualizações). É o que o atalho faz. |
| `npm run dev` | Desenvolvimento: recarrega ao editar o código. |
| `npm run setup` | Prepara `.env`, banco e tabelas. |
| `npm run redefinir-senha` | Cria uma senha nova para a conta (o mesmo que o atalho "Redefinir senha"). |
| `npm run verify` | Roda lint, checagem de tipos, testes unitários e testes de ponta a ponta. |
| `npm test` | Só os testes unitários/integração (Vitest). |
| `npm run e2e` | Só os testes de ponta a ponta (Playwright, abre o app num navegador de teste na porta 3200). |
| `npm run db:migrate -- --name x` | Cria uma migration nova (desenvolvimento). |
| `npm run db:studio` | Abre o Prisma Studio para ver o banco. |

Os testes usam bancos e pastas separados (`offerstudio_test_<n>`, `offerstudio_e2e_auto`, `data/test`, `data/e2e`): **seus dados reais nunca são tocados**.

---

## Onde ficam os dados

```
data/
├─ postgres/   banco de dados (PostgreSQL 18 embutido)
├─ storage/    imagens, fontes, vídeos e arquivos das ofertas (e os ZIPs gerados, em exports/)
└─ tmp/        arquivos temporários
~/Documents/Offer Studio Backups/   backups (ou a pasta escolhida em Configurações → Backup)
```

Para levar o Offer Studio para outro Mac, o caminho recomendado é o backup (veja acima). Também dá para copiar a pasta inteira do projeto com o app fechado (com `data/` e `.env`), rodar `npm install` e `npx playwright install chromium` e abrir pelo atalho.

---

## Arquitetura

```
Navegador (você) ──► Painel Next.js 16 (localhost:3000)          Prévia isolada (<token>.localhost:3001)
                       │  telas, editor, ações                        cópias rodando com os scripts delas,
                       ▼                                              sem acesso ao painel
                     PostgreSQL 18 embutido (127.0.0.1:5433)  ◄── Robô de tarefas (worker)
                       dados + filas (pg-boss)                      Chromium: clonar; ZIP; backup/restauração
                       │
                     data/storage (arquivos, por hash)
```

- **Painel** (`src/app`): Next.js App Router + Tailwind 4 + componentes no padrão shadcn/ui (Radix).
- **Login**: Better Auth (e-mail e senha, uma conta só, sessão de 30 dias, limite de 5 tentativas por minuto). Sem e-mail de recuperação: a senha é trocada pelo atalho "Redefinir senha".
- **Banco**: Prisma 7.10 + PostgreSQL 18 embutido (`embedded-postgres`), collation pt-BR. O servidor é compartilhado (app, testes, scripts): cada um entra numa lista ao ligar e o último a sair desliga.
- **Robô de tarefas** (`src/worker`): processo separado para o trabalho pesado, religado sozinho se cair.
  - **Clonagem**: Playwright (Chromium) captura computador e celular, bloqueia rastreadores na rede, serializa o DOM (inclusive shadow DOM e CSS gerado por JavaScript), baixa e reescreve todos os arquivos para `/os-assets/<hash>`, detecta checkouts brasileiros, VSL/delay, páginas do funil e proteção anti-robô.
  - **ZIP** (`src/server/services/export`, formato em `src/lib/export/options.ts`): fila na tabela `Export`; cada página passa pelo mesmo `renderPageHtml` da prévia no modo `live`, com links relativos entre as pastas, `/os-assets/` → `assets/`, divisor A/B, `eventos.php` opcional e `LEIA-ME.txt`; os 5 últimos ZIPs de cada oferta ficam em `data/storage/exports`.
  - **Backup** (`src/server/services/backup`): ZIP com manifesto (versão, migrations, contagem e SHA-256 de cada tabela e arquivo), tabelas em JSONL, arquivos usados e a chave de criptografia; gravado em temporário e renomeado. A restauração confere tudo antes, troca os dados numa transação só (com limites de tempo) e pausa as outras filas enquanto roda.
- **Prévia** (`src/preview`): servidor à parte (porta do painel + 1). Cada prévia tem origem própria (`<token>.localhost`), então o JavaScript de uma página clonada nunca enxerga o painel. Use Chrome, Edge ou Firefox (resolvem `*.localhost` sozinhos). Com `?os_teste=<token>` (tela "Testar pixels"), a página roda com os pixels de verdade e manda cada passo para `POST /__os/pixel-test`.
- **Rastreamento** (`src/lib/tracking`, `src/runtime/tracking`): o servidor monta uma configuração **pública** por página (pixels, regras, aviso de cookies, repasse de UTMs, versão A/B; nunca tokens) e a coloca no começo do `<head>`, junto com um script leve (~26 KB, ~11 KB com gzip). Esse script cuida do consentimento (LGPD + Google Consent Mode v2), dos pixels (mesmo `eventID` em todas as plataformas), das regras de evento, do repasse de UTMs e dos códigos livres que esperam o "Aceitar". Modos: `preview` (sem pixels), `test` (pixels de verdade + relatório ao painel) e `live` (ZIP).
- **Segurança**: o painel só escuta em `127.0.0.1` (não fica exposto na rede); CSP com nonce, para que scripts de páginas clonadas nunca rodem no painel.

### Estrutura de pastas

```
prisma/            schema.prisma e migrations
scripts/           setup, run (liga tudo), with-db, e2e-server, reset-password
src/app/           telas do painel (rotas)
src/components/    ui/ (base shadcn) · app/ (layout) · offers/ (ofertas e páginas)
src/editor/        editor visual (GrapesJS com interface própria, blocos, widgets, modelos)
src/server/        ações do painel, regras de negócio (services), consultas, sessão
src/lib/           banco, env, storage, erros em PT-BR, textos/slugs, tema, rastreamento, ZIP
src/worker/        robô de tarefas (fila) · clone/ = clonador (captura, montagem, detecções)
src/detection/     listas de rastreadores, checkouts BR e players de vídeo
src/preview/       servidor de prévia
src/runtime/       scripts leves injetados nas páginas: os-runtime (widgets, checkouts por JS, delay de VSL)
                   e tracking/ (aviso de cookies, pixels, eventos, repasse de UTMs)
tests/             unit/ (Vitest) · e2e/ (Playwright) · fixtures/ (sites de teste offline)
data/              seus dados (fora do git)
```

---

## Problemas comuns

| Sintoma | Solução |
|---|---|
| "Node.js não encontrado" | Instale o Node 24 em nodejs.org. |
| A porta 3000 já está em uso | O Offer Studio provavelmente já está aberto em outra janela do Terminal: use essa janela ou feche-a e abra de novo. Se for outro programa usando a porta, feche esse programa. (Duas janelas nos mesmos dados não trabalham ao mesmo tempo: a segunda espera a primeira ser fechada.) |
| "Robô de tarefas parado" em Configurações | Feche a janela do atalho e abra de novo. |
| Esqueci a senha | Na pasta do Offer Studio, dê dois cliques em **Redefinir senha** e digite a senha nova duas vezes (ou rode `npm run redefinir-senha`). Funciona com o app aberto ou fechado; suas ofertas não mudam. A tela Entrar explica o mesmo em "Esqueci a senha". |
| Erro ao iniciar o banco | Veja se há outro Offer Studio aberto. Se o Mac desligou de repente, basta abrir de novo. |
| "Não foi possível clonar" / proteção contra robôs | Salve a página no navegador (Chrome, Edge ou Firefox: Arquivo → Salvar como → Página completa), compacte em .zip e importe pela aba "Arquivo ZIP". |
| A clonagem ou o ZIP fica "Na fila" | O robô de tarefas está parado: veja Configurações → Sistema, feche e abra o Offer Studio. |
| A prévia não abre | Use Chrome, Edge ou Firefox. O Safari pode não abrir endereços `*.localhost` (o atalho já abre o Offer Studio no Chrome, Edge, Brave, Firefox ou Arc quando um deles está instalado). |
| "Testar pixels" mostra o pixel como **Bloqueado** | Um bloqueador de anúncios (uBlock, AdBlock, Brave…) impediu o pixel. Desligue-o para a página de teste ou abra o link em outro navegador. |
| "Testar pixels" não mostra nada | Clique em **Abrir página de teste** (ou abra o link copiado) e, no aviso de cookies, clique em **Aceitar**. |
| Depois de subir o ZIP, aparece a página padrão da hospedagem | Apague o `default.php`/`index.php` da hospedagem em `public_html` e confira que o `index.html` ficou direto na pasta (não dentro de uma pasta com o nome do ZIP). |
| `seudominio.com.br/eventos.php` mostra código ou baixa o arquivo | A hospedagem não tem PHP: apague o `eventos.php` e a pasta `eventos-dados` de lá e gere o ZIP sem a opção de eventos pelo servidor. |
| Baixei o ZIP e apareceu uma pasta em vez do `.zip` | Foi o Safari, que abre o ZIP sozinho: pegue o `.zip` na Lixeira (ou desmarque Safari → Ajustes → Geral → "Abrir arquivos 'seguros' após o download" e baixe de novo). Não compacte a pasta: o ZIP ficaria com uma pasta a mais. |
| A imagem de compartilhamento não aparece no WhatsApp | Preencha **Onde está no ar** (aba Detalhes da oferta) e gere o ZIP de novo. |
| "Cole o token de novo" num pixel | A chave `APP_ENCRYPTION_KEY` do `.env` mudou (por exemplo, `.env` recriado sem restaurar um backup). Edite o pixel e cole o token outra vez. |
| "O Offer Studio não tem permissão para gravar nessa pasta" | O macOS bloqueou o acesso: em Ajustes do Sistema → Privacidade e Segurança → **Arquivos e Pastas** (ou **Acesso Total ao Disco**), permita o **Terminal**. Ou escolha outra pasta. |
| Backup na iCloud aparece como "Na iCloud" e não restaura | O arquivo ainda não foi baixado para o Mac: no Finder, abra a pasta na iCloud Drive e clique em baixar (ícone de nuvem); depois restaure. |
| "Backup atrasado" no cartão Sistema | O Offer Studio ficou fechado no horário do backup automático. Ele faz o backup ao abrir; ou clique em **Fazer backup agora**. |
| "O Offer Studio estava ocupado e não deu para restaurar agora" | Feche as outras abas do Offer Studio no navegador, espere clonagens e ZIPs em andamento terminarem e tente de novo. Nada foi alterado. |

---

## Rede

Nesta máquina, GitHub, Vercel e o registro do shadcn/ui estavam bloqueados, então:
- o PostgreSQL vem pelo npm (`embedded-postgres`) em vez do Homebrew;
- os componentes de interface foram escritos no próprio projeto (`src/components/ui`), seguindo o padrão do shadcn/ui.
