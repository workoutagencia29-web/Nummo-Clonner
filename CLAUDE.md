@AGENTS.md

# Offer Studio — notas do projeto

App local (Mac, usuário único) para clonar, editar e exportar páginas de oferta. Plano e fases: docs/PLANO.md. Toda a interface e as mensagens de erro são em **português do Brasil**.

## Comandos
- `npm run dev` / `npm start` — sobem Postgres embutido + painel + worker (scripts/run.ts). `OS_DB_NAME` e `PORT` trocam banco/porta.
- `npm test` (Vitest, banco `offerstudio_test`), `npm run e2e` (Playwright, banco `offerstudio_e2e_auto`, porta 3200), `npm run verify` (tudo).
- `npx tsx scripts/with-db.ts [--db nome] -- <comando>` roda algo com o Postgres ligado (ex.: `prisma migrate dev`).
- Postgres embutido é COMPARTILHADO (app, testes, E2E, scripts) no mesmo cluster `data/postgres`: `startPostgres` liga destacado (pg_ctl) e registra quem usa em `data/postgres-users`; `handle.stop()` só desliga quando é o último. Nunca pare o servidor de outro jeito (pg_ctl stop, kill) — derruba o app aberto.
- Nunca use o banco `offerstudio` (dados reais do usuário) em testes.
- `embedded-postgres` só via `loadEmbeddedPostgres()` (scripts/lib/postgres.ts): importado direto, o `async-exit-hook` dele mata o processo no Ctrl+C antes de sair da lista de usuários do banco.
- App de rascunho (verificação manual): `PORT=<p> OS_DB_NAME=offerstudio_<algo> DATA_DIR=<pasta temporária> OS_OPEN_BROWSER=0 npm start`; desligue com SIGINT no grupo de processos (como o Ctrl+C), nunca matando o Postgres.
- `npm run redefinir-senha` (scripts/reset-password.ts) troca a senha da conta única.

## Convenções
- Server actions: `protectedAction(schemaZod, handler)` em src/server/actions — exige login, valida com zod (mensagens pt-BR) e traduz erros via `toUserMessage` (src/lib/errors.ts). No cliente, use `useAction()` (toasts automáticos).
- Regras de negócio em src/server/services (testáveis sem Next); consultas de tela em src/server/queries.ts.
- Erros para o usuário: lance `UserError("mensagem em pt-BR", "campo")`.
- Links entre páginas do funil são gravados como `os-page:<pageId>` (src/lib/internal-links.ts).
- Arquivos: src/lib/storage.ts (disco local, endereçado por hash). Arquivos de páginas clonadas são referenciados como `/os-assets/<sha256>.<ext>`.
- Clonador: src/worker/clone (job.ts orquestra; capture.ts = Playwright; build.ts = saídas EDITABLE/PRESERVE_JS). Testes de ponta a ponta: tests/unit/clone-job.test.ts com os sites offline de tests/fixtures (`OS_CLONE_HOST_MAP=*.fixture.test=127.0.0.1`).
- Editor visual: src/editor (GrapesJS 0.23.6, UI própria em editor-app.tsx; config em grapes/setup.ts; blocos em blocks/, widgets em widgets/, modelos em templates/). HTML salvo ↔ editor por src/lib/editor-html.ts (scripts viram <os-script>, on* viram data-os-on-*, CSS original numa folha base em @layer os-original). Nada executa no canvas; comportamento das páginas fica em src/runtime (widgets via data-os-widget), injetado por src/lib/page-render.ts. Timers de módulos do editor: use editorTimeout (grapes/lifecycle.ts).
- Botões ligados a links da oferta: data-os-link="<chave>" (src/lib/offer-links.ts).
- Prévia: src/preview/server.ts em <token>.localhost:<PORT+1>, tokens em src/lib/preview.ts.
- Componentes base em src/components/ui seguem o shadcn/ui (o registro do shadcn é inacessível nesta rede: escreva à mão).
- Nada de botão sem ação: o que é de fase futura fica oculto até existir.
- Formulários do painel: `useDraft` + `SaveBar` (src/components/offers/tracking/form-kit.tsx) — "Alterações não salvas · Descartar · Salvar". O SaveBar chama `useUnsavedChanges` (src/hooks/use-unsaved-changes.ts): a aba ganha um ponto e sair por um link pergunta antes (UnsavedChangesGuard montado na tela). Abas com formulários usam `<TabsContent keepMounted>` (o não salvo continua lá na volta).
- Endereços de links da oferta: `linkUrlProblem`/`linkUrlHint` (src/lib/link-url.ts), na ação e na tela. Tamanhos de arquivo: `formatBytes` (src/lib/format.ts).
- Tela da oferta: abas na URL (`?aba=links|rastreamento|configuracoes|detalhes`, `&secao=` nos pixels: src/components/offers/offer-tabs.tsx). "Próximos passos": `computeReadiness` (src/lib/readiness.ts + src/server/services/readiness.ts). Avisos do ZIP: src/lib/export/warnings.ts (com consertos em src/components/offers/export/warning-fixes.tsx).
- Teste A/B medido: a letra da versão vai em `os_versao` nos eventos e o checkout ganha `versao-<letra>` (`markVersion` em src/runtime/tracking/forwarding.ts: `src` na Hotmart/Kiwify/Eduzz, `utm_content` nas outras, só quando o parâmetro não existe — nunca sobrescreve o que veio do anúncio).
- Backup: src/server/services/backup (archive = gerar, restore = restaurar, schedule = agenda/saúde, settings = pasta). Fora do banco `offerstudio`, a pasta "de casa" é `<DATA_DIR>/backup-home` (`OS_BACKUP_HOME`): testes nunca gravam nos Documentos do usuário. Tabela nova do schema entra no backup sozinha (ordem pelas chaves estrangeiras); se for passageira ou só deste Mac, ponha em `TRANSIENT_TABLES`/`LOCAL_TABLES` (src/server/services/backup/format.ts).
- Telas: "não encontrado" com `NotFoundState` (src/components/app/not-found-state.tsx); carregamento com `PageLoading` (src/components/app/page-loading.tsx). Textos do usuário sem jargão: "Computador" (não desktop), "Com scripts" (não Preservar JS), "Histórico" (salvamentos) × "Versão" (só A/B), "Ver página" (aba nova) × "Modo prévia" (no editor).
- Rede: GitHub/Vercel/ghcr.io bloqueados; npm funciona.
