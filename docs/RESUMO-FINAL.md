# Offer Studio — resumo final

Data: 01/10/2026. As 6 fases do plano estão concluídas e testadas. O manual completo está no **README.md** da pasta do Offer Studio. Os detalhes técnicos estão em **docs/PLANO.md**.

---

## O que foi entregue em cada fase

**Fase 1 — Base**
- Atalho de dois cliques para abrir o app. O banco de dados já vem junto: não precisa instalar nada além do Node.
- Login com uma conta só.
- Painel de ofertas com busca, filtros, pastas, tags, duplicar e lixeira (com "Desfazer").
- Páginas do funil e Configurações.

**Fase 2 — Clonador**
- Cole o link e o robô abre a página no computador e no celular.
- Ele baixa imagens, fontes, vídeos e estilos e bloqueia os pixels e chats do dono original.
- Ele encontra os checkouts brasileiros e sugere as páginas do funil (upsell, downsell, obrigado).
- Antes de salvar, você revisa a cópia. Também dá para importar um ZIP ou colar o HTML.
- Sites com proteção anti-robô são explicados, nunca burlados.

**Fase 3 — Editor visual**
- Edição direto na página, com mais de 40 blocos e 9 modelos.
- Ajuste separado para computador, tablet e celular.
- Localizar e substituir, editor de código, imagens convertidas para WebP.
- Desfazer/refazer, salvamento automático, Histórico (pontos de restauração) e prévia rodando de verdade.

**Fase 4 — Pixels**
- Meta, TikTok, Kwai, GA4, Google Ads e UTMify.
- Eventos por regra (tempo, rolagem, clique, formulário) e "Usar recomendados".
- Repasse de UTMs e IDs de clique para o checkout.
- Aviso de cookies (LGPD) com Consent Mode do Google.
- Tela "Testar pixels" ao vivo.

**Fase 5 — Baixar ZIP**
- ZIP pronto para qualquer hospedagem: página inicial, uma pasta por página do funil, SEO, favicon, imagem de compartilhamento, páginas de política e termos.
- Teste A/B em pastas (`oferta-a/`, `oferta-b/`) com divisor por percentual.
- `eventos.php` opcional para a API de Conversões.
- Passo a passo para Hostinger e HostGator no app e no LEIA-ME.

**Fase 6 — Extras**
- **Backup automático** todo dia, com backup manual na hora e **restauração** com conferência e backup de segurança antes. Também dá para levar tudo para outro Mac pela primeira tela.
- **Teste A/B medido:** cada evento leva a versão vista (`os_versao`) e o checkout recebe a marca da versão.
- **Cartão "Próximos passos"** em cada oferta: mostra o que falta para ela sair pronta.
- **Esqueci a senha:** atalho "Redefinir senha" na pasta do app.
- **Polimento** de todas as telas:
  - textos sem jargão;
  - avisos com o conserto ali mesmo;
  - "Sair sem salvar?" ao sair com algo não salvo;
  - celular sem rolagem para os lados;
  - ícone próprio;
  - acessibilidade.
- **Correção encontrada nesta verificação final:** ao fechar o app, o desligamento era cortado no meio. Por isso o banco de dados ficava ligado depois de fechar. Agora o app desliga direito.

---

## O que foi testado

| Verificação | Resultado |
|---|---|
| Checagem de tipos (TypeScript) e padrão de código (Biome, 578 arquivos) | Sem erros |
| Testes automáticos (Vitest) | **2.611 passaram** e 13 pulados, em 139 arquivos (cerca de 15 min). Mais 1 teste novo do desligamento, que passou. |
| Testes de ponta a ponta no navegador (Playwright, app real) | **74 de 74 passaram** (cerca de 5 min) |
| Compilação de produção (`next build`) | Sem erros e sem avisos |
| Jornada completa como usuário (app real em produção, banco e pasta separados) | **13 de 13 etapas ok** (detalhe abaixo) |

Na jornada, o app foi aberto do zero como no atalho e percorrido assim:

1. Criar a conta.
2. Clonar uma página de vendas de teste com o upsell.
3. No editor, trocar a headline, adicionar o "Botão do checkout" e criar o link dele.
4. Cadastrar o pixel da Meta e as regras recomendadas.
5. Criar a versão B, com 50% do tráfego para cada versão.
6. Baixar o ZIP, descompactar e publicar numa subpasta (`/sub/`).

No Chromium, com a página publicada:

- O divisor mandou visitantes para `oferta-a/` e `oferta-b/`. Nenhum arquivo ficou faltando (zero erros 404).
- O aviso de cookies apareceu. O pixel só carregou depois do "Aceitar", e o PageView e o InitiateCheckout levaram `os_versao=A` ou `B`.
- O checkout recebeu `utm_source`, `utm_campaign`, `fbclid` e `src=versao-a` ou `versao-b`. O `utm_content` do anúncio continuou intacto.

Por fim, o backup e a restauração:

1. Fazer um backup.
2. Criar outra oferta.
3. Restaurar o backup e entrar de novo.

Voltaram a oferta, a versão B, o pixel, o link do checkout e a headline. A oferta criada depois do backup sumiu, como esperado.

Seus dados reais (banco `offerstudio`) não foram tocados em nenhum teste.

---

## Limitações conhecidas

- **Proteção anti-robô e cloakers:** esses sites não são clonados. A saída é salvar a página no navegador (Chrome, Edge ou Firefox) e importar o ZIP.
- **Quizzes e páginas que dependem do servidor do dono** não ficam 100% independentes.
- **VSL da Panda ou VTurb** pode bloquear o seu domínio. Nesse caso, troque pelo seu vídeo.
- **Contador regressivo de página clonada** no modo "Editável" fica parado. O app avisa e oferece o modo "Com scripts", ou use o bloco "Contador regressivo" do editor.
- **Checkouts da página clonada:** a janela do ZIP não avisa dos links que ainda levam ao checkout da página clonada. O cartão "Próximos passos" avisa: confira lá antes de baixar.
- **Métricas:** não há métricas de visitas e vendas no painel. Elas ficam no UTMify, no Meta e no GA4. Para comparar as versões A/B, use o `os_versao`.
- **Imagem de compartilhamento:** só aparece no WhatsApp e no Facebook depois de preencher "Onde está no ar" e gerar o ZIP de novo.
- **Safari:**
  - não abre a prévia (`*.localhost`): o atalho já abre o Offer Studio no Chrome (ou Edge, Brave, Firefox, Arc) quando um deles está instalado — no seu Mac, o Chrome;
  - pode descompactar o ZIP sozinho (veja o README);
  - apaga a escolha da versão A/B em cerca de 7 dias no iPhone.
- **Editor:** feito para computador. Abaixo de 900 px de largura ele avisa e oferece "Ver página".
- **Backup:** precisa do Offer Studio aberto no horário. Se estiver fechado, o backup sai quando você abrir. Backup de uma versão mais nova não restaura numa versão mais antiga.
- **Pequenos acabamentos que ficaram para depois:**
  - selo "botão sem link" no card da oferta;
  - endereço de oferta inexistente responde com a tela "não encontrada", mas sem o código 404;
  - títulos aparecem como "Texto" no editor;
  - ofertas criadas de modelos antes desta fase ficaram sem miniatura.

---

## Decisões para você confirmar

1. **A versão A/B no checkout.**
   - Na **Hotmart, Kiwify e Eduzz**, a versão vai no parâmetro **`src`** (`versao-a`, `versao-b`). O `sck` nunca é mexido.
   - Nas outras plataformas, ela vai no `utm_content`, **só quando ele ainda não existe**.
   - **O `utm_content` que vem do anúncio nunca é alterado**, para a UTMify continuar atribuindo a venda ao anúncio certo.
   - Consequência: nessas outras plataformas, o tráfego pago chega ao checkout sem a versão. A orientação é usar um link de checkout diferente em cada versão.
   - Se preferir acrescentar a versão ao `utm_content` (`…|versao-b`), é uma troca pequena.
2. **Cookies no modo "Pedir permissão" (o padrão).**
   - Antes do "Aceitar", nada fica guardado no aparelho da pessoa.
   - Quem ignora o aviso e volta outro dia direto (sem UTMs) chega ao checkout sem a origem.
   - A alternativa é guardar só as UTMs antes da escolha. Também é uma troca pequena.
3. **Backup padrão:** todo dia às 03:00, guardando os 10 últimos, na pasta Documentos. **Recomendo trocar para a iCloud Drive**: se o Mac quebrar ou for roubado, o backup continua lá.
4. **Cookie da versão A/B (`os_ab_…`):** é tratado como funcional. Ele só lembra a versão, então é gravado antes do "Aceitar". A política de privacidade do modelo já cita esse cookie. Confirme com quem cuida do jurídico, se houver.

---

## O que você precisa fazer agora

1. **Abra o Offer Studio** com dois cliques em **"Abrir Offer Studio.command"**.
   - Se o macOS bloquear: Ajustes do Sistema → Privacidade e Segurança → **Abrir Mesmo Assim**.
   - **Crie a sua conta** (nome, e-mail e senha) e guarde a senha. Se esquecer, use o atalho **"Redefinir senha"**.
2. **Configure o backup**, antes de qualquer outra coisa:
   1. Vá em **Configurações → Backup**.
   2. Em "Pasta dos backups", escolha **iCloud Drive** (ou um disco externo em "Outra pasta").
   3. Confira o horário: o Offer Studio precisa estar aberto nessa hora. Se costuma fechar à noite, escolha um horário em que ele fica aberto.
   4. Clique em **Fazer backup agora** e veja aparecer "Backup em dia".
   5. Se o macOS perguntar se o Terminal pode acessar a pasta, clique em **Permitir**.
3. **Clone a primeira oferta** (Clonar oferta → cole o link) ou comece de um modelo (Nova oferta). Siga o cartão **"Próximos passos"** da oferta.
4. **Links e checkouts:** troque os checkouts da página clonada pelos **seus links** da Hotmart, Kiwify, Eduzz e outras. Trocando aqui, todos os botões mudam juntos. No editor, ligue os botões novos com "Link da oferta".
5. **Empresa e SEO:**
   - preencha nome da empresa, CNPJ (ou CPF), e-mail e, se quiser, telefone e endereço. Eles entram na política de privacidade, nos termos e nos rodapés;
   - preencha o título, a descrição, o favicon e a imagem de compartilhamento.
   - Adicione as páginas **Política de privacidade** e **Termos de uso** pelos modelos (Adicionar página).
6. **Pixels e rastreamento:**
   1. Cadastre os **IDs dos pixels**:
      - Meta: o número do pixel;
      - TikTok;
      - GA4 (`G-…`);
      - Google Ads (`AW-…`, com o **rótulo de conversão** de cada evento);
      - Kwai;
      - UTMify: não repita aqui o pixel da Meta que já está na UTMify.
   2. Em **Eventos**, clique em **Usar recomendados**.
   3. **Tokens da API de Conversões (Meta) e da Events API (TikTok):** só cadastre se a sua hospedagem tiver **PHP**.
      - Na Meta, o token fica em Gerenciador de Eventos → seu pixel → Configurações → API de Conversões → Gerar token de acesso.
      - O token fica guardado com criptografia e só sai no `eventos.php` do ZIP.
   4. Em **Privacidade**, deixe "Pedir permissão" e escolha a página da política de privacidade.
7. **Teste antes de publicar:** clique em **Testar pixels**, abra a página de teste, aceite os cookies e clique no botão de compra. Confira que cada pixel aparece como carregado e os eventos chegam.
8. **Teste A/B (opcional):** no menu ⋯ da página → **Teste A/B…** → **Criar versão B**. Edite a B e ajuste o percentual.
9. **Baixe o ZIP e suba na hospedagem:**
   1. Clique em **Baixar ZIP** e resolva os avisos da janela.
   2. Clique em **Gerar ZIP**.
   3. Na **Hostinger**: Gerenciador de arquivos → `public_html` → apague o `default.php` → Fazer upload do ZIP → botão direito → **Extrair** (nome da pasta em branco).
   4. Na **HostGator/cPanel**: Gerenciador de Arquivos → `public_html` → Carregar → Extrair.
   5. Confira que o `index.html` ficou direto em `public_html`. Apague o ZIP e o `LEIA-ME.txt` de lá.
   6. **`eventos.php`:** só ligue a opção do ZIP se a hospedagem tiver **PHP 7.4 ou mais novo**. Hostinger, HostGator e qualquer cPanel têm; Netlify e Cloudflare Pages não. Depois de subir, abra `seudominio.com.br/eventos.php`: tem que aparecer "eventos.php do Offer Studio funcionando.". Se aparecer código ou o navegador baixar o arquivo, apague o `eventos.php` e a pasta `eventos-dados` na hora.
10. **Depois de publicar:**
    1. Na aba **Detalhes**, preencha **Onde está no ar** com o endereço do site.
    2. Gere o ZIP de novo e suba por cima: assim a imagem de compartilhamento aparece no WhatsApp e no Facebook.
    3. Marque a oferta como **No ar**.

### O que testar primeiro (sugestão)

1. Clone uma página sua (ou de um concorrente que você conhece bem). Compare a cópia com o original no computador e no celular, na tela de revisão.
2. Abra no editor, troque um texto e uma imagem e clique em **Ver página**.
3. Ligue o botão de compra ao seu checkout e cadastre o seu pixel da Meta. Faça o **Testar pixels** com a extensão **Meta Pixel Helper** ligada.
4. Gere o ZIP e suba numa **subpasta de teste** da hospedagem (ex.: `seudominio.com.br/teste/`). Abra com `?utm_source=teste` no fim do endereço, aceite os cookies e clique em comprar. O checkout tem que receber `utm_source=teste`.
5. Faça um **backup** e confira o arquivo na pasta escolhida.
