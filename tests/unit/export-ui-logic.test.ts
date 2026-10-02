/**
 * Fase 5 — "Baixar ZIP": regras da tela (sem React): árvore "O que vai no ZIP",
 * opções, etapas, tamanhos e o ritmo das leituras de progresso.
 */
import { describe, expect, it } from "vitest";
import {
  buildTreeRows,
  clampProgress,
  EVENTS_FILES,
  eventsFilesFor,
  exportOfferHref,
  exportStage,
  fatalPollMessage,
  formatBytes,
  historyRows,
  initialOptions,
  isFinished,
  nextPollDelay,
  nodePath,
  optionsSummary,
  optionsToSend,
  planOptionsFor,
  progressStep,
  runningExport,
  SPLITTER_OFF_LABEL,
  serverEventsLabel,
  serverEventsWho,
  splitterOffLabel,
  type TreeEntry,
  treeForOptions,
  visiblePlanWarnings,
  withoutParam,
} from "@/components/offers/export/logic";
import { EXPORTS_KEPT_PER_OFFER, type ExportView, serverEventsTreeLabel } from "@/lib/export/options";

function view(over: Partial<ExportView> & { id: string }): ExportView {
  return {
    offerId: "o1",
    status: "DONE",
    progress: 100,
    step: null,
    options: { splitter: true, serverEvents: false, optimizeHtml: true },
    fileName: "oferta-2026-09-29.zip",
    bytes: 1000,
    errorMessage: null,
    warnings: [],
    createdAt: "2026-09-29T12:00:00.000Z",
    finishedAt: "2026-09-29T12:00:05.000Z",
    ...over,
  };
}

const TREE: TreeEntry[] = [
  { path: "index.html", kind: "splitter", label: "Divisor A/B" },
  { path: "oferta-a/index.html", kind: "variant", label: "Oferta A (50%)" },
  { path: "oferta-b/index.html", kind: "variant", label: "Oferta B (50%)" },
  { path: "obrigado/index.html", kind: "page", label: "Obrigado" },
  { path: "obrigado/celular/index.html", kind: "mobile", label: "Versão celular" },
  { path: "politica/index.html", kind: "legal", label: "Política de privacidade" },
  { path: "assets/", kind: "file", label: "Imagens, CSS e fontes" },
  { path: "LEIA-ME.txt", kind: "file", label: "Como subir na hospedagem" },
];

describe("nodePath", () => {
  it("a pasta é a página; o index.html da raiz e os arquivos soltos ficam como estão", () => {
    expect(nodePath("index.html")).toBe("index.html");
    expect(nodePath("oferta-a/index.html")).toBe("oferta-a/");
    expect(nodePath("upsell/oferta-b/celular/index.html")).toBe("upsell/oferta-b/celular/");
    expect(nodePath("assets/")).toBe("assets/");
    expect(nodePath("LEIA-ME.txt")).toBe("LEIA-ME.txt");
  });

  it("normaliza barras, ./ e / do começo", () => {
    expect(nodePath("./obrigado//index.html")).toBe("obrigado/");
    expect(nodePath("/eventos.php")).toBe("eventos.php");
    expect(nodePath("assets\\x.js")).toBe("assets/x.js");
    expect(nodePath("  obrigado/index.html ")).toBe("obrigado/");
  });
});

describe("buildTreeRows", () => {
  it("monta a árvore com profundidade, na ordem do plano", () => {
    const rows = buildTreeRows(TREE);
    expect(rows.map((r) => [r.path, r.name, r.depth, r.kind])).toEqual([
      ["index.html", "index.html", 0, "splitter"],
      ["oferta-a/", "oferta-a/", 0, "variant"],
      ["oferta-b/", "oferta-b/", 0, "variant"],
      ["obrigado/", "obrigado/", 0, "page"],
      ["obrigado/celular/", "celular/", 1, "mobile"],
      ["politica/", "politica/", 0, "legal"],
      ["assets/", "assets/", 0, "file"],
      ["LEIA-ME.txt", "LEIA-ME.txt", 0, "file"],
    ]);
    expect(rows.find((r) => r.path === "assets/")?.isFolder).toBe(true);
    expect(rows.find((r) => r.path === "LEIA-ME.txt")?.isFolder).toBe(false);
  });

  it("cria as pastas que só aparecem dentro de um caminho e põe os filhos logo abaixo delas", () => {
    const rows = buildTreeRows([
      { path: "index.html", kind: "page", label: "Página inicial" },
      { path: "upsell/oferta-b/index.html", kind: "variant", label: "Upsell B" },
      { path: "LEIA-ME.txt", kind: "file", label: "Leia" },
      { path: "upsell/index.html", kind: "splitter", label: "Divisor do Upsell" },
      { path: "upsell/oferta-a/index.html", kind: "variant", label: "Upsell A" },
    ]);
    expect(rows.map((r) => `${"  ".repeat(r.depth)}${r.name}|${r.kind}|${r.label}`)).toEqual([
      "index.html|page|Página inicial",
      // Pasta criada pelo filho; depois recebe o próprio item (divisor).
      "upsell/|splitter|Divisor do Upsell",
      "  oferta-b/|variant|Upsell B",
      "  oferta-a/|variant|Upsell A",
      "LEIA-ME.txt|file|Leia",
    ]);
  });

  it("pasta sem item próprio fica como 'folder'; caminho repetido vale uma vez", () => {
    const rows = buildTreeRows([
      { path: "assets/os-runtime-1.js", kind: "file", label: "Script" },
      { path: "assets/os-runtime-1.js", kind: "file", label: "Repetido" },
      { path: "", kind: "file", label: "vazio" },
    ]);
    expect(rows).toEqual([
      { path: "assets/", name: "assets/", depth: 0, kind: "folder", label: "", isFolder: true },
      {
        path: "assets/os-runtime-1.js",
        name: "os-runtime-1.js",
        depth: 1,
        kind: "file",
        label: "Script",
        isFolder: false,
      },
    ]);
  });

  it("lista vazia → nenhuma linha", () => {
    expect(buildTreeRows([])).toEqual([]);
  });
});

describe("treeForOptions", () => {
  const plan = { tree: TREE, hasServerEventTokens: true };
  const EVENTS_PATHS = ["eventos.php", "eventos-dados/config.php", "eventos-dados/.htaccess"];
  const withEvents: TreeEntry[] = [
    ...TREE.slice(0, -1),
    { path: "eventos.php", kind: "file", label: "Precisa de PHP · envia os eventos para a Meta pelo servidor" },
    { path: "eventos-dados/config.php", kind: "file", label: "Tokens do eventos.php (não compartilhe)" },
    { path: "eventos-dados/.htaccess", kind: "file", label: "Bloqueia a pasta dos tokens (Apache)" },
    TREE[TREE.length - 1],
  ];

  it("com as mesmas opções do plano, a árvore é a dele, sem mudar nada", () => {
    expect(treeForOptions(plan, { splitter: true, serverEvents: false })).toBe(TREE);
    expect(
      treeForOptions(
        { tree: withEvents, hasServerEventTokens: true },
        { splitter: false, serverEvents: true },
        { splitter: false, serverEvents: true },
      ),
    ).toBe(withEvents);
  });

  it("acabou de desligar o divisor: o index.html passa a mostrar a versão de controle", () => {
    const tree = treeForOptions(plan, { splitter: false, serverEvents: false });
    expect(tree[0]).toEqual({ path: "index.html", kind: "page", label: splitterOffLabel(TREE[0].label) });
    expect(tree.slice(1)).toEqual(TREE.slice(1));
    // Não altera o plano recebido.
    expect(TREE[0].kind).toBe("splitter");
    // Plano já pedido sem divisor: não mexe (não tem como prever o divisor antes do plano novo).
    const pageTree: TreeEntry[] = [{ path: "index.html", kind: "page", label: "Página — versão A (principal)" }];
    expect(
      treeForOptions(
        { tree: pageTree, hasServerEventTokens: false },
        { splitter: true, serverEvents: false },
        { splitter: false, serverEvents: false },
      ),
    ).toEqual(pageTree);
  });

  it('sem divisor, as versões perdem o percentual (formato do servidor: " · 50%")', () => {
    const server: TreeEntry[] = [
      { path: "index.html", kind: "splitter", label: "Página principal — divisor A/B" },
      { path: "oferta-a/index.html", kind: "variant", label: "Página principal — versão A · 50%" },
      { path: "oferta-b/index.html", kind: "variant", label: "Página principal — versão B (Headline nova) · 33,5%" },
      { path: "upsell/index.html", kind: "page", label: "Upsell · 100%" },
    ];
    const off = treeForOptions({ tree: server, hasServerEventTokens: false }, { splitter: false, serverEvents: false });
    expect(off.map((e) => e.label)).toEqual([
      SPLITTER_OFF_LABEL,
      "Página principal — versão A",
      "Página principal — versão B (Headline nova)",
      // Só as versões mudam.
      "Upsell · 100%",
    ]);
    // Com o divisor ligado (como o plano), nada muda.
    expect(treeForOptions({ tree: server, hasServerEventTokens: false }, { splitter: true, serverEvents: false })).toBe(
      server,
    );
  });

  it("o eventos.php entra com as plataformas atendidas no rótulo, como o servidor mostra", () => {
    const on = treeForOptions(
      { tree: TREE, hasServerEventTokens: true, serverEventVendors: ["TIKTOK", "META"] },
      { splitter: true, serverEvents: true },
    );
    // O requisito vem primeiro (não some quando o rótulo é cortado) e sem parênteses dentro de parênteses.
    expect(on.find((e) => e.path === "eventos.php")?.label).toBe(
      "Precisa de PHP · envia os eventos para a Meta e o TikTok pelo servidor",
    );
    expect(eventsFilesFor(["META"])[0].label).toBe("Precisa de PHP · envia os eventos para a Meta pelo servidor");
    expect(eventsFilesFor(["TIKTOK"])[0].label).toBe("Precisa de PHP · envia os eventos para o TikTok pelo servidor");
    // O mesmo texto que o servidor usa na prévia.
    expect(eventsFilesFor(["META"])[0].label).toBe(serverEventsTreeLabel(["META"]));
    expect(eventsFilesFor([])).toEqual(EVENTS_FILES);
    expect(eventsFilesFor(undefined)).toEqual(EVENTS_FILES);
    expect(eventsFilesFor(["META"]).slice(1)).toEqual(EVENTS_FILES.slice(1));
  });

  it("acabou de ligar o eventos.php: ele e os arquivos dele entram antes do LEIA-ME", () => {
    const on = treeForOptions(plan, { splitter: true, serverEvents: true });
    const paths = on.map((e) => e.path);
    expect(paths.slice(-4)).toEqual([...EVENTS_PATHS, "LEIA-ME.txt"]);
    expect(on.slice(-4, -1)).toEqual(EVENTS_FILES);
    expect(TREE).toHaveLength(8);
    // Sem token: nunca aparece.
    const noToken = treeForOptions({ tree: TREE, hasServerEventTokens: false }, { splitter: true, serverEvents: true });
    expect(noToken).toBe(TREE);
  });

  it("acabou de desligar o eventos.php: ele e os arquivos dele saem", () => {
    const off = treeForOptions(
      { tree: withEvents, hasServerEventTokens: true },
      { splitter: true, serverEvents: false },
      { splitter: true, serverEvents: true },
    );
    expect(off).toEqual(TREE);
    // Um eventos.php dentro de uma pasta (arquivo do "Preservar JS") não é o da API.
    const nested: TreeEntry[] = [
      { path: "api/eventos.php", kind: "file", label: "Arquivo do site" },
      { path: "eventos.php", kind: "file", label: "API" },
    ];
    expect(
      treeForOptions(
        { tree: nested, hasServerEventTokens: true },
        { splitter: true, serverEvents: false },
        { splitter: true, serverEvents: true },
      ),
    ).toEqual([nested[0]]);
  });

  it("plano já com o eventos.php: não repete", () => {
    const on = treeForOptions({ tree: withEvents, hasServerEventTokens: true }, { splitter: true, serverEvents: true });
    for (const p of EVENTS_PATHS) expect(on.filter((e) => e.path === p)).toHaveLength(1);
    expect(on.find((e) => e.path === "eventos.php")?.label).toContain("Meta");
  });

  it("sem LEIA-ME, o eventos.php vai para o fim", () => {
    const tree = treeForOptions(
      { tree: [{ path: "index.html", kind: "page", label: "Página inicial" }], hasServerEventTokens: true },
      { splitter: true, serverEvents: true },
    );
    expect(tree.map((e) => e.path)).toEqual(["index.html", ...EVENTS_PATHS]);
  });
});

describe("planOptionsFor e visiblePlanWarnings", () => {
  it("o plano nunca é pedido com o eventos.php sem token", () => {
    expect(planOptionsFor({ splitter: false, serverEvents: true }, true)).toEqual({
      splitter: false,
      serverEvents: true,
    });
    expect(planOptionsFor({ splitter: true, serverEvents: true }, false)).toEqual({
      splitter: true,
      serverEvents: false,
    });
    expect(planOptionsFor({ splitter: true, serverEvents: true }, undefined).serverEvents).toBe(false);
  });

  it("o aviso de PHP do eventos.php fica na própria opção; os outros aparecem", () => {
    const php =
      "O eventos.php só funciona em hospedagem com PHP (Hostinger, HostGator, cPanel). Em Netlify, Vercel ou outra hospedagem só de arquivos, não suba o eventos.php nem o eventos-config.php: os tokens ficariam visíveis.";
    const notIncluded =
      "O eventos.php não foi incluído: nenhum pixel da Meta ou do TikTok tem a API de Conversões/Events API ligada com o token salvo (aba Pixels).";
    const preserve = "A página “Quiz” usa “Preservar JS”: suba a oferta na raiz do domínio (public_html).";
    expect(visiblePlanWarnings([php, notIncluded, preserve])).toEqual([notIncluded, preserve]);
    expect(visiblePlanWarnings(null)).toEqual([]);
  });
});

describe("nome da opção do eventos.php", () => {
  it("só a Meta, só o TikTok ou as duas", () => {
    expect(serverEventsLabel(["META"])).toBe("API de Conversões (Meta)");
    expect(serverEventsLabel(["TIKTOK"])).toBe("Events API (TikTok)");
    expect(serverEventsLabel(["META", "TIKTOK"])).toBe("API de Conversões (Meta) e Events API (TikTok)");
    // Sem a lista (plano antigo): o nome geral.
    expect(serverEventsLabel(undefined)).toBe("API de Conversões (Meta) e Events API (TikTok)");
    expect(serverEventsWho(["META"])).toBe("para a Meta");
    expect(serverEventsWho(["TIKTOK"])).toBe("para o TikTok");
    expect(serverEventsWho(["TIKTOK", "META"])).toBe("para a Meta e o TikTok");
    expect(serverEventsWho([])).toBe("para a Meta e o TikTok");
  });
});

describe("formatBytes", () => {
  it("fala o tamanho em português", () => {
    expect(formatBytes(0)).toBe("0 bytes");
    expect(formatBytes(1)).toBe("1 byte");
    expect(formatBytes(900)).toBe("900 bytes");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(850 * 1024)).toBe("850 KB");
    expect(formatBytes(1000 * 1024)).toBe("1 MB");
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2,4 MB");
    expect(formatBytes(15 * 1024 * 1024)).toBe("15 MB");
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe("1,5 GB");
  });

  it("sem tamanho → travessão", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(undefined)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
    expect(formatBytes(-5)).toBe("—");
  });
});

describe("optionsSummary", () => {
  it("lista só as opções ligadas; o divisor só conta quando a oferta tem versões", () => {
    expect(optionsSummary({ splitter: true, serverEvents: true, optimizeHtml: true }, true)).toEqual([
      "Divisor A/B",
      "eventos.php",
      "HTML otimizado",
    ]);
    expect(optionsSummary({ splitter: true, serverEvents: false, optimizeHtml: true }, false)).toEqual([
      "HTML otimizado",
    ]);
    expect(optionsSummary({ splitter: false, serverEvents: false, optimizeHtml: false }, true)).toEqual([]);
  });

  it("opções faltando ou vazias valem o padrão", () => {
    expect(optionsSummary({}, true)).toEqual(["Divisor A/B", "HTML otimizado"]);
    expect(optionsSummary(null, false)).toEqual(["HTML otimizado"]);
  });
});

describe("opções iniciais e envio", () => {
  it("usa as opções do último ZIP pronto; sem nenhum, o padrão", () => {
    expect(initialOptions([])).toEqual({ splitter: true, serverEvents: false, optimizeHtml: true });
    expect(initialOptions(null)).toEqual({ splitter: true, serverEvents: false, optimizeHtml: true });
    const list = [
      view({ id: "3", status: "FAILED", options: { splitter: false, serverEvents: false, optimizeHtml: false } }),
      view({ id: "2", status: "DONE", options: { splitter: false, serverEvents: true, optimizeHtml: true } }),
      view({ id: "1", status: "DONE" }),
    ];
    expect(initialOptions(list)).toEqual({ splitter: false, serverEvents: true, optimizeHtml: true });
  });

  it("opções inválidas no histórico → padrão", () => {
    const broken = view({ id: "1", options: { splitter: "sim" } as never });
    expect(initialOptions([broken])).toEqual({ splitter: true, serverEvents: false, optimizeHtml: true });
  });

  it("sem token configurado, nunca pede o eventos.php", () => {
    const opts = { splitter: true, serverEvents: true, optimizeHtml: true };
    expect(optionsToSend(opts, { hasServerEventTokens: true }).serverEvents).toBe(true);
    expect(optionsToSend(opts, { hasServerEventTokens: false }).serverEvents).toBe(false);
    expect(optionsToSend(opts, null).serverEvents).toBe(false);
    expect(optionsToSend(opts, null)).toMatchObject({ splitter: true, optimizeHtml: true });
  });
});

describe("etapas", () => {
  it("exportStage", () => {
    expect(exportStage(null, null, null)).toBe("setup");
    expect(exportStage("a", null, null)).toBe("progress");
    expect(exportStage("a", view({ id: "b" }), null)).toBe("progress");
    expect(exportStage("a", view({ id: "a", status: "QUEUED" }), null)).toBe("progress");
    expect(exportStage("a", view({ id: "a", status: "RUNNING" }), null)).toBe("progress");
    expect(exportStage("a", view({ id: "a", status: "DONE" }), null)).toBe("done");
    expect(exportStage("a", view({ id: "a", status: "FAILED" }), null)).toBe("failed");
    expect(exportStage("a", null, "sumiu")).toBe("failed");
  });

  it("isFinished, clampProgress e progressStep", () => {
    expect(isFinished("DONE")).toBe(true);
    expect(isFinished("FAILED")).toBe(true);
    expect(isFinished("RUNNING")).toBe(false);
    expect(isFinished("QUEUED")).toBe(false);
    expect(clampProgress(45.6)).toBe(46);
    expect(clampProgress(-3)).toBe(0);
    expect(clampProgress(180)).toBe(100);
    expect(clampProgress(undefined)).toBe(0);
    expect(clampProgress(Number.NaN)).toBe(0);
    expect(progressStep(null)).toBe("Na fila…");
    expect(progressStep(view({ id: "a", status: "QUEUED", step: null }))).toBe("Na fila…");
    expect(progressStep(view({ id: "a", status: "RUNNING", step: null }))).toBe("Preparando os arquivos…");
    expect(progressStep(view({ id: "a", status: "DONE", step: null }))).toBe("Pronto");
    expect(progressStep(view({ id: "a", status: "RUNNING", step: "  Copiando imagens…  " }))).toBe("Copiando imagens…");
  });

  it("historyRows tira o ZIP acompanhado e guarda no máximo 5", () => {
    const list = Array.from({ length: 7 }, (_, i) => view({ id: String(i) }));
    expect(historyRows(list, null).map((e) => e.id)).toEqual(["0", "1", "2", "3", "4"]);
    expect(historyRows(list, "0").map((e) => e.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(historyRows(list, null)).toHaveLength(EXPORTS_KEPT_PER_OFFER);
    expect(historyRows(null, null)).toEqual([]);
  });

  it("runningExport: só o mais novo, e só se ainda estiver sendo gerado", () => {
    expect(runningExport([view({ id: "a", status: "RUNNING" }), view({ id: "b" })])?.id).toBe("a");
    expect(runningExport([view({ id: "a", status: "QUEUED" })])?.id).toBe("a");
    expect(runningExport([view({ id: "a" }), view({ id: "b", status: "RUNNING" })])).toBeNull();
    expect(runningExport([])).toBeNull();
    expect(runningExport(null)).toBeNull();
  });
});

describe("leituras de progresso", () => {
  it("nextPollDelay: 1 s; com falhas, dobra até 8 s", () => {
    expect(nextPollDelay(0)).toBe(1000);
    expect(nextPollDelay(1)).toBe(2000);
    expect(nextPollDelay(2)).toBe(4000);
    expect(nextPollDelay(3)).toBe(8000);
    expect(nextPollDelay(50)).toBe(8000);
    expect(nextPollDelay(0, 500)).toBe(500);
  });

  it("fatalPollMessage: 404/401/403 param; o resto tenta de novo", () => {
    expect(fatalPollMessage(404)).toMatch(/não existe mais/);
    expect(fatalPollMessage(401)).toBe("Sua sessão expirou. Entre de novo.");
    expect(fatalPollMessage(401, "Entre de novo.")).toBe("Entre de novo.");
    expect(fatalPollMessage(403, "Endereço não permitido.")).toBe("Endereço não permitido.");
    expect(fatalPollMessage(500)).toBeNull();
    expect(fatalPollMessage(502, "x")).toBeNull();
  });
});

describe("endereços", () => {
  it("withoutParam tira só o parâmetro pedido", () => {
    expect(withoutParam("http://localhost:3000/ofertas/x?baixar=1", "baixar")).toBe("/ofertas/x");
    expect(withoutParam("http://localhost:3000/ofertas/x?aba=links&baixar=1#topo", "baixar")).toBe(
      "/ofertas/x?aba=links#topo",
    );
    expect(withoutParam("/ofertas/x?aba=links", "baixar")).toBe("/ofertas/x?aba=links");
  });

  it("exportOfferHref abre a oferta com o diálogo", () => {
    expect(exportOfferHref("abc")).toBe("/ofertas/abc?baixar=1");
  });
});
