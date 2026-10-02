/**
 * Integração das correções da Fase 2 — partes sem navegador:
 * - G3 data#16 / security#9: agenda da limpeza automática no worker (ao
 *   iniciar e a cada 6 h, só entre clonagens; falha nunca derruba o worker).
 * - G2/G3 security#3: endereços internos de importação reconhecidos por uma
 *   regra só (synthetic.ts), inclusive com ponto final no host.
 * - G3 ux#7: a dica de importar fala do .html e da pasta "_files".
 * - G2 ux#6: revisão não afirma que um vídeo foi baixado quando não sabe.
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

import { CloneReview } from "@/app/(painel)/clonar/[jobId]/clone-review";
import { isVirtualCloneUrl, linkFunnelPages, normalizeCloneUrl } from "@/server/services/clone";
import type { CleanupReport } from "@/server/services/clone-cleanup";
import { CLEANUP_INTERVAL_MS, CLEANUP_RETRY_MS, createCleanupSchedule } from "@/worker/cleanup-schedule";
import { detectProtection, IMPORT_HINT } from "@/worker/clone/protection";
import type { CloneResult } from "@/worker/clone/types";

const EMPTY_REPORT: CleanupReport = {
  jobs: 0,
  expired: 0,
  uploads: 0,
  cloneFolders: 0,
  assets: 0,
  tmp: 0,
  bytes: 0,
  assetsDeferred: false,
};

describe("G3 data#16 — agenda da limpeza automática no worker", () => {
  function setup(run: () => Promise<CleanupReport>) {
    let clock = 1_000_000;
    const lines: string[] = [];
    const errors: unknown[] = [];
    const schedule = createCleanupSchedule({
      now: () => clock,
      run,
      log: (line) => lines.push(line),
      onError: (err) => errors.push(err),
    });
    return {
      schedule,
      lines,
      errors,
      advance: (ms: number) => {
        clock += ms;
      },
    };
  }

  it("roda logo na primeira folga do worker e depois só a cada 6 horas", async () => {
    const run = vi.fn(async () => ({ ...EMPTY_REPORT, jobs: 2, cloneFolders: 2, bytes: 5 * 1024 * 1024 }));
    const { schedule, lines, advance } = setup(run);
    expect(await schedule.runIfDue()).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(lines).toEqual(["Limpeza automática: 2 clonagens antigas (5,0 MB liberados)."]);
    advance(CLEANUP_INTERVAL_MS - 1);
    expect(await schedule.runIfDue()).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    advance(1);
    expect(await schedule.runIfDue()).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("nada apagado: não escreve linha de log", async () => {
    const { schedule, lines } = setup(async () => EMPTY_REPORT);
    await schedule.runIfDue();
    expect(lines).toEqual([]);
  });

  it("falha (banco fora do ar) nunca lança: registra e tenta de novo em 15 minutos, não em 6 horas", async () => {
    let fail = true;
    const run = vi.fn(async () => {
      if (fail) throw new Error("banco fora do ar");
      return EMPTY_REPORT;
    });
    const { schedule, errors, advance } = setup(run);
    await expect(schedule.runIfDue()).resolves.toBe(true);
    expect(errors).toHaveLength(1);
    fail = false;
    advance(CLEANUP_RETRY_MS - 1);
    expect(await schedule.runIfDue()).toBe(false);
    advance(1);
    expect(await schedule.runIfDue()).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("arquivos baixados adiados (havia clonagem rodando): volta em 15 minutos", async () => {
    const run = vi.fn(async () => ({ ...EMPTY_REPORT, assetsDeferred: true }));
    const { schedule, advance } = setup(run);
    await schedule.runIfDue();
    advance(CLEANUP_RETRY_MS);
    expect(await schedule.runIfDue()).toBe(true);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("nunca roda duas limpezas ao mesmo tempo", async () => {
    let release: () => void = () => {};
    const run = vi.fn(
      () =>
        new Promise<CleanupReport>((resolve) => {
          release = () => resolve(EMPTY_REPORT);
        }),
    );
    const { schedule } = setup(run);
    const first = schedule.runIfDue();
    expect(await schedule.runIfDue()).toBe(false);
    release();
    expect(await first).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe("G2/G3 security#3 — endereços internos de importação", () => {
  it("uma regra só (synthetic.ts): host com ponto final também é interno", () => {
    expect(isVirtualCloneUrl("http://importado.offerstudio/index.html")).toBe(true);
    expect(isVirtualCloneUrl("http://importado.offerstudio./index.html")).toBe(true);
    expect(isVirtualCloneUrl("http://colado.offerstudio/")).toBe(true);
    expect(isVirtualCloneUrl("https://offerstudio.com.br/")).toBe(false);
    expect(isVirtualCloneUrl("não é link")).toBe(false);
    expect(() => normalizeCloneUrl("http://importado.offerstudio./index.html")).toThrow(/arquivo importado/);
  });
});

describe("G1 fidelity#12 — salvar a clonagem mantém o doctype", () => {
  const LEGACY = '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">';
  const targets = new Map([["loja.test/upsell", "pg1"]]);

  it("trocar os links do funil (cheerio) não troca o doctype antigo por <!DOCTYPE html>", () => {
    const html = `${LEGACY}\n<html><head></head><body><a href="/upsell">Sim</a></body></html>`;
    const out = linkFunnelPages(html, targets, { pageUrl: "https://loja.test/" });
    expect(out).toContain('href="os-page:pg1"');
    expect(out.startsWith(LEGACY)).toBe(true);
    expect(out.match(/<!doctype/gi)).toHaveLength(1);
  });

  it("página sem doctype continua sem", () => {
    const html = `<html><head></head><body><a href="/upsell">Sim</a></body></html>`;
    const out = linkFunnelPages(html, targets, { pageUrl: "https://loja.test/" });
    expect(out).toContain('href="os-page:pg1"');
    expect(/<!doctype/i.test(out)).toBe(false);
  });
});

describe("G3 ux#7 — dica de importar quando o site bloqueia o robô", () => {
  it("fala do arquivo .html junto com a pasta “_files” (não só da pasta)", () => {
    expect(IMPORT_HINT).toContain("arquivo .html junto com a pasta “_files”");
    expect(IMPORT_HINT).toMatch(/importe aqui\.$/);
    const blocked = detectProtection({
      status: 403,
      headers: {},
      html: "<h1>Forbidden</h1>",
      title: "",
      bodyTextLength: 9,
    });
    expect(blocked?.message).toContain(IMPORT_HINT);
    const login = detectProtection({
      status: 200,
      headers: {},
      html: `<form><input type="email" name="email"><input type="password" name="senha"><button>Entrar</button></form>`,
      title: "Entrar",
      bodyTextLength: 40,
    });
    expect(login?.kind).toBe("LOGIN_WALL");
    expect(login?.message).toContain("pasta “_files”");
  });
});

describe("G2 ux#6 — vídeo do site na revisão", () => {
  const result: CloneResult = {
    title: "Oferta",
    finalUrl: "https://loja.exemplo.com/",
    responsive: true,
    devices: {
      desktop: {
        outputs: {
          EDITABLE: { htmlKey: "clones/x/d-e.html" },
          PRESERVE_JS: { htmlKey: "clones/x/d-p.html", assetMap: {} },
        },
      },
    },
    removed: [],
    checkouts: [],
    funnel: [],
    videos: [
      { provider: "NATIVE", src: "https://loja.exemplo.com/antigo.mp4", thirdParty: false },
      { provider: "NATIVE", src: "https://loja.exemplo.com/novo.mp4", thirdParty: false, downloaded: true },
    ],
    delay: null,
    warnings: [],
    suggestedMode: "EDITABLE",
    assets: [],
    stats: { assets: 1, bytes: 1, failed: 0, blockedRequests: 0, durationMs: 1 },
  };

  it("clonagem antiga (sem a informação) não afirma 'baixado'; a nova, baixada, afirma", () => {
    const html = renderToStaticMarkup(
      createElement(CloneReview, {
        jobId: "r1",
        label: "https://loja.exemplo.com/",
        result,
        defaultName: "Oferta",
        previews: {},
        folders: [],
        initialChildren: [],
        funnelKeys: {},
        capturedDevices: ["desktop"],
      }),
    );
    const labels = [...html.matchAll(/Vídeo do site[^<]*/g)].map((m) => m[0]);
    expect(labels).toEqual(["Vídeo do site", "Vídeo do site (baixado)"]);
  });
});
