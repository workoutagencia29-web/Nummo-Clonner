/**
 * Fase 5 — peças do diálogo "Baixar ZIP" renderizadas no servidor (primeira
 * pintura): árvore, opções que só aparecem quando se aplicam, aviso do PHP,
 * passo a passo da hospedagem e a lista "ZIPs anteriores" em todos os estados.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExportHistory } from "@/components/offers/export/export-history";
import { HostingGuide } from "@/components/offers/export/hosting-guide";
import { buildTreeRows } from "@/components/offers/export/logic";
import { ExportOptionsForm, ExportTree, Notice } from "@/components/offers/export/parts";
import type { ExportOptions, ExportView } from "@/lib/export/options";
import { dateTime } from "@/lib/format";

const noop = () => {};
const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const count = (text: string, part: string) => text.split(part).length - 1;
const DEFAULTS: ExportOptions = { splitter: true, serverEvents: false, optimizeHtml: true, lighterImages: true };

function view(over: Partial<ExportView> & { id: string }): ExportView {
  return {
    offerId: "o1",
    status: "DONE",
    progress: 100,
    step: null,
    options: DEFAULTS,
    fileName: "oferta-teste-2026-09-29.zip",
    bytes: 2.4 * 1024 * 1024,
    errorMessage: null,
    warnings: [],
    createdAt: "2026-09-29T15:30:00.000Z",
    finishedAt: "2026-09-29T15:30:04.000Z",
    ...over,
  };
}

describe("ExportTree", () => {
  it("uma linha por item, com nome, rótulo, tipo e recuo", () => {
    const rows = buildTreeRows([
      { path: "index.html", kind: "splitter", label: "Divisor A/B" },
      { path: "oferta-a/index.html", kind: "variant", label: "Oferta A (50%)" },
      { path: "obrigado/index.html", kind: "page", label: "Obrigado" },
      { path: "obrigado/celular/index.html", kind: "mobile", label: "Versão celular" },
      { path: "politica/index.html", kind: "legal", label: "Política de privacidade" },
      { path: "assets/", kind: "file", label: "Imagens, CSS e fontes" },
    ]);
    const out = html(createElement(ExportTree, { rows }));
    expect(out).toContain('aria-label="Arquivos e pastas do ZIP"');
    expect(count(out, "<li")).toBe(6);
    for (const text of ["index.html", "oferta-a/", "obrigado/", "celular/", "politica/", "assets/"]) {
      expect(out).toContain(`>${text}</span>`);
    }
    for (const label of ["Divisor A/B", "Oferta A (50%)", "Versão celular", "Política de privacidade"]) {
      expect(out).toContain(label);
    }
    expect(out).toContain('data-path="obrigado/celular/" data-kind="mobile"');
    // Recuo: raiz 12px, um nível 32px.
    expect(out).toMatch(/data-path="obrigado\/"[^>]*padding-left:12px/);
    expect(out).toMatch(/data-path="obrigado\/celular\/"[^>]*padding-left:32px/);
    // Ícones decorativos escondidos do leitor de tela.
    expect(count(out, 'aria-hidden="true"')).toBe(6);
  });

  it("carregando → esqueleto; vazio → aviso", () => {
    const loading = html(createElement(ExportTree, { rows: [], loading: true }));
    expect(loading).toContain('aria-busy="true"');
    expect(loading).toContain("Carregando o conteúdo do ZIP");
    expect(html(createElement(ExportTree, { rows: [] }))).toContain("Nada para listar ainda.");
  });
});

describe("ExportOptionsForm", () => {
  const form = (over: Partial<Parameters<typeof ExportOptionsForm>[0]> = {}) =>
    html(
      createElement(ExportOptionsForm, {
        options: DEFAULTS,
        onChange: noop,
        hasVariants: true,
        hasServerEventTokens: true,
        ...over,
      }),
    );

  it("com versões e token: as quatro opções, com explicação", () => {
    const out = form();
    expect(out).toContain("Divisor A/B");
    expect(out).toContain("O index.html de cada página com versões sorteia a versão pelo percentual");
    // Sem o divisor vale a versão de controle (que pode não ser a A).
    expect(out).toContain("a pasta de cada página mostra a versão de controle");
    expect(out).not.toContain("mostra a versão A");
    expect(out).toContain("API de Conversões (Meta) e Events API (TikTok)");
    expect(out).toContain("eventos.php");
    expect(out).toContain("HTML otimizado");
    expect(out).toContain("Imagens mais leves");
    expect(out).toContain("O visual não muda. Não vale para páginas “Com scripts”.");
    expect(count(out, 'role="switch"')).toBe(4);
    // Padrão: divisor, HTML otimizado e imagens mais leves ligados, eventos.php desligado.
    expect(count(out, 'aria-checked="true"')).toBe(3);
    expect(out).not.toContain("Só ligue se a sua hospedagem tiver PHP");
  });

  it("nome e explicação da opção conforme as plataformas com token", () => {
    const both = form({ serverEventVendors: ["META", "TIKTOK"] });
    expect(both).toContain(">API de Conversões (Meta) e Events API (TikTok)</label>");
    expect(both).toContain("as conversões para a Meta e o TikTok pelo");
    const meta = form({ serverEventVendors: ["META"] });
    expect(meta).toContain(">API de Conversões (Meta)</label>");
    expect(meta).toContain("as conversões para a Meta pelo");
    expect(meta).not.toContain("TikTok");
    const tiktok = form({ serverEventVendors: ["TIKTOK"] });
    expect(tiktok).toContain(">Events API (TikTok)</label>");
    expect(tiktok).toContain("as conversões para o TikTok pelo");
    expect(tiktok).not.toContain("Meta");
  });

  it("sem versões e sem token: só o HTML otimizado e as imagens mais leves", () => {
    const out = form({ hasVariants: false, hasServerEventTokens: false });
    expect(out).not.toContain("Divisor A/B");
    expect(out).not.toContain("eventos.php");
    expect(count(out, 'role="switch"')).toBe(2);
  });

  it("eventos.php ligado → aviso de que a hospedagem PRECISA ter PHP", () => {
    const out = form({ options: { ...DEFAULTS, serverEvents: true } });
    expect(out).toContain("Só ligue se a sua hospedagem tiver PHP");
    expect(out).toContain("Hostinger, HostGator");
    expect(out).toContain("token de acesso");
    expect(out).toContain('data-variant="warning"');
  });

  it("desabilitado enquanto gera", () => {
    const out = form({ disabled: true });
    expect(count(out, "disabled")).toBeGreaterThanOrEqual(3);
  });
});

describe("HostingGuide", () => {
  it("fechado: só o título; aberto: passo a passo completo", () => {
    const closed = html(createElement(HostingGuide, { open: false, onOpenChange: noop }));
    expect(closed).toContain("Como subir na hospedagem");
    expect(closed).not.toContain("public_html");

    const open = html(createElement(HostingGuide, { open: true, onOpenChange: noop }));
    for (const text of [
      "Gerenciador de arquivos",
      "public_html",
      "Extrair",
      "Numa subpasta",
      "?utm_source=teste",
      "Meta Pixel Helper",
      "Netlify",
      "eventos.php",
    ]) {
      expect(open).toContain(text);
    }
    expect(open).not.toContain("Preservar JS");
  });

  it("páginas Preservar JS: avisa que só funcionam na raiz do domínio", () => {
    const one = html(createElement(HostingGuide, { open: true, onOpenChange: noop, preserveJsPages: ["Quiz"] }));
    expect(one).toContain("a página <strong>Quiz</strong> (modo “Com scripts”) só funciona na raiz do domínio");
    const two = html(
      createElement(HostingGuide, { open: true, onOpenChange: noop, preserveJsPages: ["Quiz", "Checkout"] }),
    );
    expect(two).toContain("as páginas <strong>Quiz, Checkout</strong> (modo “Com scripts”) só funcionam");
  });

  it("ZIP com o pagamento.php (pagamento na página ou só o checkout): não subir as chaves sem PHP e testar o pagamento.php", () => {
    const plain = html(createElement(HostingGuide, { open: true, onOpenChange: noop }));
    expect(plain).not.toContain("pagamento-dados");
    expect(plain).not.toContain("pagamento.php");
    // Só o checkout do Offer Studio (FlevoPay): as chaves da FlevoPay também ficariam visíveis.
    const pix = html(
      createElement(HostingGuide, { open: true, onOpenChange: noop, hasPayments: true, paymentGateways: ["FlevoPay"] }),
    );
    expect(pix).toContain("ela guarda a chave da FlevoPay, que ficaria visível");
    expect(pix).toContain(
      "seudominio.com.br/pagamento.php</strong>: deve aparecer “funcionando”, com a chave da FlevoPay",
    );
    expect(pix).toContain("no painel da FlevoPay");
    expect(pix).not.toContain("Kyvo");
    const all = html(
      createElement(HostingGuide, {
        open: true,
        onOpenChange: noop,
        hasPayments: true,
        paymentGateways: ["Kyvo", "FlevoPay", "BlackCat"],
      }),
    );
    expect(all).toContain("ela guarda as chaves da Kyvo, da FlevoPay e da BlackCat, que ficariam visíveis");
    expect(all).toContain("cadastradas e HTTPS");
    expect(all).toContain("no painel do gateway");
    // Plano antigo (sem a lista): a Kyvo do pagamento na página.
    expect(html(createElement(HostingGuide, { open: true, onOpenChange: noop, hasPayments: true }))).toContain(
      "a chave da Kyvo",
    );
  });
});

describe("ExportHistory", () => {
  const history = (over: Partial<Parameters<typeof ExportHistory>[0]> = {}) =>
    html(
      createElement(ExportHistory, {
        rows: [],
        loading: false,
        error: null,
        hasVariants: true,
        deletingId: null,
        onRetry: noop,
        onDelete: noop,
        onDownload: noop,
        ...over,
      }),
    );

  it("vazio, carregando e erro", () => {
    expect(history()).toContain("Nenhum ZIP gerado ainda.");
    expect(history()).toContain("Guardamos os 5 mais recentes");
    const loading = history({ loading: true });
    expect(loading).toContain('aria-busy="true"');
    expect(loading).not.toContain("Nenhum ZIP gerado ainda.");
    const error = history({ error: "Não foi possível falar com o Offer Studio. Ele ainda está aberto?" });
    expect(error).toContain("Ele ainda está aberto?");
    expect(error).toContain("Tentar de novo");
  });

  it("ZIP pronto: data, tamanho, opções, baixar e apagar", () => {
    const item = view({
      id: "e1",
      options: { splitter: true, serverEvents: true, optimizeHtml: true, lighterImages: true },
    });
    const out = history({ rows: [item] });
    const when = dateTime(item.createdAt);
    expect(out).toContain("oferta-teste-2026-09-29.zip");
    expect(out).toContain(`${when} · 2,4 MB · Divisor A/B · eventos.php · HTML otimizado`);
    // "Baixar" é um botão (confere se o arquivo existe antes de baixar), não um link solto.
    expect(out).not.toContain("/download");
    expect(out).toMatch(new RegExp(`<button[^>]*aria-label="Baixar oferta-teste-2026-09-29.zip de ${when}"`));
    expect(out).toContain(`aria-label="Apagar oferta-teste-2026-09-29.zip de ${when}"`);
    expect(out).not.toContain("Pronto<");
  });

  it("falhou: selo, mensagem e só apagar; gerando: progresso, sem baixar nem apagar; na fila: cancelar", () => {
    const failed = history({
      rows: [view({ id: "f", status: "FAILED", bytes: null, errorMessage: "A página Obrigado está vazia." })],
    });
    expect(failed).toContain("Falhou");
    expect(failed).toContain("A página Obrigado está vazia.");
    expect(failed).not.toContain("Baixar");
    expect(failed).toContain("Apagar");
    expect(failed).not.toContain("2,4 MB");

    const running = history({ rows: [view({ id: "r", status: "RUNNING", progress: 42, bytes: null })] });
    expect(running).toContain("Gerando o ZIP");
    expect(running).toContain(" · 42%");
    expect(running).not.toContain("Baixar");
    expect(running).not.toContain("Apagar");
    expect(running).not.toContain("Cancelar");

    // Na fila (ex.: robô de tarefas parado) dá para cancelar o pedido.
    const queued = history({ rows: [view({ id: "q", status: "QUEUED", progress: 0, bytes: null })] });
    expect(queued).toContain("Na fila");
    expect(queued).toMatch(/aria-label="Cancelar [^"]+"/);
    expect(queued).toContain('title="Cancelar este pedido"');
    expect(queued).not.toContain("Baixar");
  });

  it("apagando: botão ocupado", () => {
    const out = history({ rows: [view({ id: "e1" })], deletingId: "e1" });
    expect(out).toMatch(/aria-label="Apagar [^"]+"[^>]*disabled=""/);
  });

  it("sem versões na oferta, o divisor não aparece no resumo", () => {
    const out = history({ rows: [view({ id: "e1" })], hasVariants: false });
    expect(out).not.toContain("Divisor A/B");
    expect(out).toContain("HTML otimizado");
  });
});

describe("Notice", () => {
  it("variantes com papel acessível", () => {
    const out = html(createElement(Notice, { variant: "error", role: "alert", title: "Erro" }, "Detalhe"));
    expect(out).toContain('role="alert"');
    expect(out).toContain('data-variant="error"');
    expect(out).toContain("Erro");
    expect(out).toContain("Detalhe");
  });
});
