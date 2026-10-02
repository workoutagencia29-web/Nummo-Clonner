/**
 * Correção da Fase 3 (grupo H, #43): "Códigos da página" com um <script> sem
 * </script> ou um <!-- sem --> engoliam o resto da página, inclusive o script
 * do Offer Studio (a oferta com atraso nunca aparecia). Agora salvar recusa com
 * a explicação em português, e códigos assim guardados antes ficam de fora da
 * página servida.
 */
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { UserError } from "@/lib/errors";
import { unclosedCodePart } from "@/lib/page-code";
import { renderPageHtml } from "@/lib/page-render";
import { runtimeScript } from "@/lib/runtime-bundle";
import { createOffer } from "@/server/services/offers";
import { getPageCode, injectPageCode, normalizePageCode, savePageCode } from "@/server/services/page-code";
import { resetDatabase } from "../setup/per-file";
import { expectUserError } from "./helpers";

describe("unclosedCodePart", () => {
  it.each([
    ["<script>fbq('track','PageView');", "um <script> sem </script>"],
    ["<script src='https://x/p.js'>", "um <script> sem </script>"],
    ["<!-- pixel do Face", "um comentário <!-- sem -->"],
    ["<style>.a{color:red}", "um <style> sem </style>"],
    ["<noscript><img src=x>", "um <noscript> sem </noscript>"],
    ["<title>Oferta", "um <title> sem </title>"],
    ["<textarea>", "um <textarea> sem </textarea>"],
    ["<template><p>x", "um <template> sem </template>"],
    ["<svg><path d='M0'>", "um <svg> sem </svg>"],
    ['<img src="https://x/p.gif', 'uma tag sem fechar (falta um ">" ou uma aspa)'],
    ["<div class=x", 'uma tag sem fechar (falta um ">" ou uma aspa)'],
  ])("%s → %s", (code, problem) => {
    expect(unclosedCodePart(code)).toBe(problem);
  });

  it.each([
    "",
    "   ",
    "<script>fbq('track','PageView');</script>",
    "<!-- ok --><script src=x></script>",
    "<noscript><img src=x></noscript>",
    "<div>aberta, o navegador fecha sozinho",
    "<p>texto",
    "<table><tr><td>x",
    "<select><option>1",
    "<meta name=a content=b>",
    "<script>var s = '<!--';</script>",
    "<svg><path d='M0'/></svg>",
  ])("%j fecha tudo", (code) => {
    expect(unclosedCodePart(code)).toBeNull();
  });
});

describe("normalizePageCode", () => {
  it("recusa código sem fechar, apontando o campo e o que ficou aberto", () => {
    let err: unknown;
    try {
      normalizePageCode({ head: "<meta name=a>", bodyEnd: "<script>\r\nfbq('track','PageView');\r\n" });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(UserError);
    expect((err as UserError).field).toBe("bodyEnd");
    expect((err as UserError).message).toBe(
      "O código no fim do <body> tem um <script> sem </script>. Do jeito que está, ele esconde o resto da página " +
        "e desliga os recursos do Offer Studio (atraso da oferta, contador, formulários). " +
        "Confira o final do código colado e feche o que ficou aberto.",
    );
    expect(() => normalizePageCode({ head: "<!-- teste" })).toThrow(
      /^O código no <head> tem um comentário <!-- sem -->\./,
    );
    expect(() => normalizePageCode({ bodyStart: "<noscript><iframe src=x>" })).toThrow(
      /^O código no início do <body> tem um <noscript> sem <\/noscript>\./,
    );
  });

  it("aceita código completo", () => {
    expect(normalizePageCode({ bodyEnd: "<script>fbq('track','PageView');</script>" }).bodyEnd).toBe(
      "<script>fbq('track','PageView');</script>",
    );
  });
});

describe("savePageCode", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("não grava código sem fechar", async () => {
    const offer = await createOffer({ name: "Oferta" });
    const page = await prisma.page.findFirstOrThrow({ where: { offerId: offer.id }, select: { id: true } });
    await savePageCode(page.id, { bodyEnd: "<script>ok()</script>" });
    await expectUserError(
      savePageCode(page.id, { bodyEnd: "<script>fbq('track','PageView');" }),
      /^O código no fim do <body> tem um <script> sem <\/script>\./,
      "bodyEnd",
    );
    expect((await getPageCode(page.id)).bodyEnd).toBe("<script>ok()</script>");
  });
});

describe("injectPageCode com código guardado antes da checagem", () => {
  const page = `<!DOCTYPE html><html><head><title>T</title></head><body><h1>Oi</h1></body></html>`;

  it("deixa de fora só o campo que não fecha", () => {
    const out = injectPageCode(page, {
      head: "<meta name=h>",
      bodyStart: "<!-- sem fim",
      bodyEnd: "<script>fbq('track','PageView');",
    });
    expect(out).toContain("<meta name=h>");
    expect(out).not.toContain("sem fim");
    expect(out).not.toContain("fbq(");
    expect(out).toContain("<h1>Oi</h1></body>");
  });
});

describe("página servida (script do Offer Studio)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("com um código antigo sem fechar, a oferta com atraso aparece no tempo certo", async () => {
    const stored = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>VSL</title></head><body>
<h1>Assista</h1><div id="oferta" data-os-delay="1">Comprar agora</div></body></html>`;
    for (const bodyEnd of ["<script>fbq('track','PageView');", "<!-- pixel do Face"]) {
      const html = renderPageHtml(stored, {
        links: [],
        pageHref: (id) => `/p/${id}`,
        runtimeTag: `<script data-os-runtime>${runtimeScript()}</script>`,
        customCode: { head: "", bodyStart: "", bodyEnd },
      });
      const page = await browser.newPage();
      try {
        await page.route("**/*", (route) =>
          route.request().url() === "http://site.test/"
            ? route.fulfill({ contentType: "text/html; charset=utf-8", body: html })
            : route.abort(),
        );
        await page.goto("http://site.test/");
        expect(await page.evaluate(() => (window as unknown as { __osRuntime?: boolean }).__osRuntime)).toBe(true);
        await page.waitForFunction(
          () => {
            const el = document.getElementById("oferta");
            return !!el && getComputedStyle(el).display !== "none";
          },
          null,
          { timeout: 4000 },
        );
      } finally {
        await page.close();
      }
    }
  });
});
