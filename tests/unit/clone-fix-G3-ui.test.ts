/**
 * Telas da clonagem (revisão e falha), renderizadas no servidor com as ações
 * simuladas: textos e botões das correções do grupo G3.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/server/actions/clone", () => ({
  cancelCloneAction: vi.fn(),
  clonePreviewUrlAction: vi.fn(),
  retryCloneAction: vi.fn(),
  saveCloneAction: vi.fn(),
  startFunnelClonesAction: vi.fn(),
  startHtmlCloneAction: vi.fn(),
  startUrlCloneAction: vi.fn(),
}));

import { CloneFailed } from "@/app/(painel)/clonar/[jobId]/clone-failed";
import { CloneReview } from "@/app/(painel)/clonar/[jobId]/clone-review";
import { CloneStartForm } from "@/app/(painel)/clonar/clone-start-form";
import { recentCloneLink } from "@/app/(painel)/clonar/recent-clones";
import type { CloneStatus } from "@/server/services/clone";
import { IMPORT_HINT } from "@/worker/clone/protection";
import type { CloneResult } from "@/worker/clone/types";

type FailedProps = Parameters<typeof CloneFailed>[0];

function failed(props: Partial<FailedProps>) {
  return renderToStaticMarkup(
    createElement(CloneFailed, {
      jobId: "j1",
      label: "https://site.exemplo.com/",
      variant: "failed",
      message: "Algo deu errado.",
      screenshotKey: null,
      logs: [],
      source: "URL",
      errorCode: "ERROR",
      protectionDetail: null,
      canRetry: true,
      ...props,
    }),
  );
}

const count = (html: string, text: string) => html.split(text).length - 1;

describe("ux#15 / ux#7 — tela de falha", () => {
  it("proteção contra robôs: passo a passo uma vez só (com a pasta “_files”) e atalho para o ZIP", () => {
    const html = failed({
      errorCode: "BOT_CHALLENGE",
      message: `Esta página tem proteção contra robôs (Cloudflare). Não é possível clonar automaticamente. ${IMPORT_HINT}`,
    });
    expect(html).toContain("Não é possível clonar automaticamente.");
    expect(html).not.toContain(IMPORT_HINT);
    expect(count(html, "Página da Web, completa")).toBe(1);
    expect(html).toContain("Selecione os dois juntos");
    expect(html).toContain("pasta “_files”");
    expect(html).toContain('href="/clonar?aba=zip"');
    expect(html).toContain("Importar ZIP");
    expect(html).toContain("Tentar de novo");
  });

  it("erro 403 também sugere importar; 404 e falta de internet não", () => {
    expect(
      failed({ errorCode: "HTTP_ERROR", protectionDetail: "HTTP 403", message: `Recusou. ${IMPORT_HINT}` }),
    ).toContain("Página da Web, completa");
    const notFound = failed({
      errorCode: "HTTP_ERROR",
      protectionDetail: "HTTP 404",
      message: "Não encontrada (erro 404).",
    });
    expect(notFound).not.toContain("Página da Web, completa");
    expect(notFound).toContain('href="/clonar"');
    // Página que não existe: corrigir o link vem antes de "Tentar de novo" (polimento da Fase 6).
    expect(notFound).toContain("Clonar outro link");
    expect(notFound.indexOf("Clonar outro link")).toBeLessThan(notFound.indexOf("Tentar de novo"));
    expect(failed({ message: "Sem internet. Confira sua conexão e tente de novo." })).not.toContain("Arquivo ZIP");
  });

  it("login: a mensagem já explica; sem repetir o passo a passo", () => {
    const html = failed({
      errorCode: "LOGIN_WALL",
      message: "Esta página pede login… Se você tem acesso, abra a página no seu navegador já logado… e importe aqui.",
    });
    expect(html).not.toContain("Página da Web, completa");
    expect(html).toContain('href="/clonar?aba=zip"');
  });

  it("falha de um ZIP: nada de mandar compactar em ZIP de novo; erro que não muda some com o 'Tentar de novo'", () => {
    const html = failed({
      source: "ZIP",
      message: "O ZIP está protegido por senha. Compacte a pasta de novo sem senha.",
    });
    expect(html).not.toContain("Página da Web, completa");
    expect(html).toContain("Enviar outro ZIP");
    expect(failed({ source: "ZIP", errorCode: "IMPORT_INVALID" })).not.toContain("Tentar de novo");
    expect(failed({ source: "HTML" })).toContain('href="/clonar?aba=html"');
  });

  it("clonagem expirada com o arquivo apagado: sem 'Tentar de novo'", () => {
    const html = failed({ variant: "expired", source: "ZIP", canRetry: false, message: "Os arquivos foram apagados." });
    expect(html).toContain("Clonagem expirada");
    expect(html).not.toContain("Tentar de novo");
    expect(html).toContain("Enviar outro ZIP");
  });

  it("tela inicial abre na aba pedida e explica o ZIP com o .html e a pasta “_files”", () => {
    const html = renderToStaticMarkup(createElement(CloneStartForm, { initialTab: "zip" }));
    expect(html).toMatch(/aria-selected="true"[^>]*>[\s\S]*?Arquivo ZIP/);
    expect(html).toContain("Selecione os dois juntos");
    expect(html).not.toContain("compacte a pasta em .zip");
  });
});

const baseResult: CloneResult = {
  title: "Página de vendas",
  finalUrl: "https://loja.exemplo.com/",
  responsive: true,
  devices: {
    mobile: {
      outputs: {
        EDITABLE: { htmlKey: "clones/x/m-e.html" },
        PRESERVE_JS: { htmlKey: "clones/x/m-p.html", assetMap: {} },
      },
    },
  },
  removed: [],
  checkouts: [
    { url: "https://pay.hotmart.com/X", platform: "Hotmart", source: "HREF", confidence: 100, occurrences: 1 },
  ],
  funnel: [{ url: "https://loja.exemplo.com/upsell", label: "Kit", kind: "UPSELL", reason: "Endereço com upsell" }],
  videos: [
    { provider: "VTURB", videoId: "abc", thirdParty: true },
    { provider: "OTHER", src: "https://fast.wistia.net/embed/iframe/xyz", thirdParty: true },
    { provider: "NATIVE", src: "https://loja.exemplo.com/v.mp4", thirdParty: false, downloaded: false },
  ],
  delay: null,
  warnings: [],
  suggestedMode: "EDITABLE",
  assets: [],
  stats: { assets: 1, bytes: 1, failed: 0, blockedRequests: 0, durationMs: 1 },
};

type Child = CloneStatus["children"][number];
const child = (c: Partial<Child> & Pick<Child, "id" | "status">): Child => ({
  progress: 0,
  step: null,
  sourceUrl: "https://loja.exemplo.com/upsell",
  errorMessage: null,
  title: null,
  devices: [],
  matchKey: "loja.exemplo.com/upsell",
  ...c,
});

function review(children: Child[], extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(CloneReview, {
      jobId: "p1",
      label: "https://loja.exemplo.com/",
      result: baseResult,
      defaultName: "Página de vendas",
      previews: {},
      folders: [],
      initialChildren: children,
      funnelKeys: { "https://loja.exemplo.com/upsell": "loja.exemplo.com/upsell" },
      capturedDevices: ["mobile"],
      ...extra,
    }),
  );
}

/** Tag de abertura do elemento com o id/aria-label indicado. */
function tag(html: string, attr: string) {
  return new RegExp(`<[^>]*${attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^>]*>`).exec(html)?.[0] ?? "";
}

describe("revisão da clonagem", () => {
  it("data#9 / ux#3 — página do funil que falhou: sugestão liberada, erro sem 'importe aqui' e botão 'Tentar de novo'", () => {
    const html = review([
      child({
        id: "c1",
        status: "FAILED",
        errorMessage: `Esta página tem proteção contra robôs (Cloudflare). ${IMPORT_HINT}`,
      }),
    ]);
    const box = tag(html, 'id="funnel-https://loja.exemplo.com/upsell"');
    expect(box).not.toContain(' disabled=""');
    expect(box).toContain('aria-checked="false"');
    expect(html).not.toContain(IMPORT_HINT);
    expect(html).toContain("Esta página tem proteção contra robôs (Cloudflare).");
    expect(tag(html, 'aria-label="Tentar de novo https://loja.exemplo.com/upsell"')).toContain("button");
  });

  it("ativa (na fila/clonando): sugestão marcada e botão de cancelar; Salvar explica como não esperar", () => {
    const html = review([child({ id: "c2", status: "RUNNING", progress: 40, title: "Kit" })]);
    const box = tag(html, 'id="funnel-https://loja.exemplo.com/upsell"');
    expect(box).toContain(' disabled=""');
    expect(box).toContain('aria-checked="true"');
    expect(tag(html, 'aria-label="Cancelar Kit"')).toContain("button");
    expect(html).toContain("Aguardando páginas do funil…");
    expect(html).toContain("Cancele as páginas do funil");
  });

  it("página do funil com login: a mensagem não manda importar (não existe importação no funil)", () => {
    const html = review([
      child({
        id: "c3",
        status: "FAILED",
        errorMessage:
          "Esta página pede login e senha antes de mostrar o conteúdo. Se você tem acesso, abra a página no seu navegador já logado, salve com Arquivo → Salvar como (página completa) ou copie o HTML, e importe aqui.",
      }),
    ]);
    expect(html).toContain("Esta página pede login e senha antes de mostrar o conteúdo.");
    expect(html).not.toContain("importe aqui");
  });

  it("nova tentativa esconde a falha antiga da mesma página", () => {
    const html = review([
      child({ id: "old", status: "FAILED", errorMessage: "Falhou antes." }),
      child({ id: "new", status: "QUEUED" }),
    ]);
    expect(html).not.toContain("Falhou antes.");
    expect(html).toContain("Na fila");
  });

  it("ux#8 / ux#19 / ux#12 — nomes dos players, textos do editor e selo 'Só celular'", () => {
    const html = review([], { offerDeleted: true });
    expect(html).toContain("VTurb (ConverteAI)");
    expect(html).toContain("Wistia");
    expect(html).not.toMatch(/>(?:VTURB|OTHER)</);
    expect(html).toContain("Vídeo do site (não baixado: continua no site original)");
    expect(html).toContain("na aba “Links e checkouts” da oferta");
    expect(html).not.toContain("no editor você troca todos");
    expect(html).toContain("botão “Editar” da página");
    expect(html).toContain("Só celular");
    expect(html).not.toContain("Responsiva");
    expect(html).toContain("A oferta criada desta clonagem foi excluída");
  });
});

describe("ux#11 — clonagens recentes", () => {
  const base = { id: "j", source: "URL", label: "x", errorCode: null, createdAt: "", offerTrashed: false };
  it("mostra o que aconteceu com a oferta criada", () => {
    expect(recentCloneLink({ ...base, status: "SAVED", offerId: "o1" })).toMatchObject({
      label: "Salva",
      href: "/ofertas/o1",
    });
    expect(recentCloneLink({ ...base, status: "SAVED", offerId: "o1", offerTrashed: true })).toMatchObject({
      label: "Oferta na lixeira",
      href: "/lixeira",
    });
    expect(recentCloneLink({ ...base, status: "SAVED", offerId: null })).toMatchObject({
      label: "Oferta excluída",
      href: "/clonar/j",
    });
    expect(recentCloneLink({ ...base, status: "FAILED", offerId: null, errorCode: "EXPIRED" })).toMatchObject({
      label: "Expirada",
    });
  });
});
