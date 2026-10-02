/**
 * Clonador: download seguro (fetcher), detecção de charset, armazenamento de
 * arquivo em disco pelo hash e importação de ZIP.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { brotliCompressSync, crc32, deflateRawSync, deflateSync, gzipSync } from "node:zlib";
import iconv from "iconv-lite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { deleteObject, objectExists, putFileContentAddressed, storagePath } from "@/lib/storage";
import { decodeText, fixMetaCharset } from "@/worker/clone/charset";
import {
  createFetcher,
  FetchError,
  type Fetcher,
  isBlockedAddress,
  matchHostMap,
  parseHostMap,
} from "@/worker/clone/fetcher";
import { findZipEntry, findZipFile, readZipSite, resolveZipPath } from "@/worker/clone/zip-import";

const TMP = path.join(env.dataDir, `tmp-clone-fetcher-${randomBytes(4).toString("hex")}`);
const writtenKeys = new Set<string>();

afterAll(async () => {
  for (const key of writtenKeys) await deleteObject(key);
  await rm(TMP, { recursive: true, force: true });
});

// ─── Charset ─────────────────────────────────────────────────────────────────

describe("decodeText", () => {
  it("usa o BOM de UTF-8 mesmo com cabeçalho dizendo outra coisa", () => {
    const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("<p>Olá, promoção!</p>", "utf8")]);
    const out = decodeText(body, "text/html; charset=iso-8859-1");
    expect(out).toEqual({ text: "<p>Olá, promoção!</p>", charset: "utf-8" });
  });

  it("usa o BOM de UTF-16LE", () => {
    const body = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Ação", "utf16le")]);
    expect(decodeText(body)).toEqual({ text: "Ação", charset: "utf-16le" });
  });

  it("latin1 pelo charset do Content-Type", () => {
    const body = iconv.encode("<p>Promoção imperdível</p>", "latin1");
    const out = decodeText(body, "text/html; charset=ISO-8859-1");
    expect(out.text).toBe("<p>Promoção imperdível</p>");
    expect(out.charset).toBe("windows-1252");
  });

  it("latin1 pelo <meta charset> e pelo <meta http-equiv>", () => {
    const a = iconv.encode('<html><head><meta charset="iso-8859-1"><title>Ação</title>', "latin1");
    expect(decodeText(a, "text/html").text).toContain("<title>Ação</title>");

    const b = iconv.encode(
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1"><title>Coração</title>',
      "latin1",
    );
    const out = decodeText(b);
    expect(out.text).toContain("Coração");
    expect(out.charset).toBe("windows-1252");
  });

  it("o cabeçalho tem prioridade sobre o <meta>", () => {
    const body = Buffer.from('<meta charset="iso-8859-1"><p>Olá</p>', "utf8");
    expect(decodeText(body, "text/html; charset=utf-8")).toMatchObject({ text: expect.stringContaining("Olá") });
  });

  it("UTF-8 válido sem declaração continua UTF-8", () => {
    const out = decodeText(Buffer.from("<p>Não perca — só hoje</p>", "utf8"), "text/html");
    expect(out).toEqual({ text: "<p>Não perca — só hoje</p>", charset: "utf-8" });
  });

  it("sem declaração e UTF-8 inválido cai para windows-1252", () => {
    // 0x93/0x94 = aspas curvas no windows-1252; 0xE7 = ç
    const body = Buffer.from([0x3c, 0x70, 0x3e, 0x93, 0x61, 0xe7, 0xe3, 0x6f, 0x94, 0x3c, 0x2f, 0x70, 0x3e]);
    expect(decodeText(body, "text/html")).toEqual({ text: "<p>“ação”</p>", charset: "windows-1252" });
  });

  it("CSS com @charset", () => {
    const body = iconv.encode('@charset "iso-8859-1";\n.a::before{content:"ção"}', "latin1");
    const out = decodeText(body, "text/css");
    expect(out.text).toContain('content:"ção"');
    expect(out.charset).toBe("windows-1252");
  });

  it("CSS sem @charset nem cabeçalho, em UTF-8", () => {
    expect(decodeText(Buffer.from('.a{content:"é"}', "utf8"), "text/css").charset).toBe("utf-8");
  });
});

describe("fixMetaCharset", () => {
  it("troca as declarações antigas por <meta charset=utf-8> no início do <head>", () => {
    const html =
      '<!doctype html><html><head><title>x</title><meta charset="iso-8859-1">' +
      '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">' +
      '<meta name="viewport" content="width=device-width"></head><body></body></html>';
    expect(fixMetaCharset(html)).toBe(
      '<!doctype html><html><head><meta charset="utf-8"><title>x</title>' +
        '<meta name="viewport" content="width=device-width"></head><body></body></html>',
    );
  });

  it("mantém outros <meta> e o conteúdo do <body>", () => {
    const html =
      '<html><head lang="pt"><meta name="description" content="charset=latin1 no texto"></head>' +
      "<body><script>var s = '<meta charset=\"x\">';</script></body></html>";
    const out = fixMetaCharset(html);
    expect(out.startsWith('<html><head lang="pt"><meta charset="utf-8"><meta name="description"')).toBe(true);
    expect(out).toContain("var s = '<meta charset=\"x\">';");
  });

  it("não confunde <header> com <head> e insere após <html> quando não há <head>", () => {
    const html = '<!DOCTYPE html><html lang="pt-BR"><body><header>Topo</header></body></html>';
    expect(fixMetaCharset(html)).toBe(
      '<!DOCTYPE html><html lang="pt-BR"><meta charset="utf-8"><body><header>Topo</header></body></html>',
    );
  });

  it("fragmento sem <html>: coloca no começo; e é idempotente", () => {
    expect(fixMetaCharset("<p>oi</p>")).toBe('<meta charset="utf-8"><p>oi</p>');
    const once = fixMetaCharset('<html><head><meta charset="windows-1252"></head></html>');
    expect(fixMetaCharset(once)).toBe(once);
    expect(once).toBe('<html><head><meta charset="utf-8"></head></html>');
  });
});

// ─── Endereços e mapa de hosts ───────────────────────────────────────────────

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.255",
    "0.0.0.0",
    "0.1.2.3",
    "224.0.0.1",
    "239.255.255.250",
    "255.255.255.255",
    "::1",
    "::",
    "[::1]",
    "fc00::1",
    "fd12:3456:789a::1",
    "fe80::1",
    "fe80::1%lo0",
    "febf::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:7f00:1",
    "::7f00:1",
    "64:ff9b::7f00:1",
    "2002:c0a8:101::1",
    "não-é-ip",
    "",
  ])("bloqueia %j", (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "172.15.255.255",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "192.169.0.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
  ])("libera %j", (ip) => {
    expect(isBlockedAddress(ip)).toBe(false);
  });
});

describe("matchHostMap / parseHostMap", () => {
  const map = {
    "*.fixture.test": "127.0.0.1:4555",
    "*.deep.fixture.test": "127.0.0.1:4557",
    "exato.test": "127.0.0.1:4556",
  };

  it("nomes exatos e curingas", () => {
    expect(matchHostMap("exato.test", map)).toBe("127.0.0.1:4556");
    expect(matchHostMap("EXATO.test.", map)).toBe("127.0.0.1:4556");
    expect(matchHostMap("site.fixture.test", map)).toBe("127.0.0.1:4555");
    expect(matchHostMap("a.b.fixture.test", map)).toBe("127.0.0.1:4555");
    expect(matchHostMap("fixture.test", map)).toBe("127.0.0.1:4555");
    expect(matchHostMap("x.deep.fixture.test", map)).toBe("127.0.0.1:4557");
  });

  it("não casa nomes parecidos", () => {
    expect(matchHostMap("notfixture.test", map)).toBeNull();
    expect(matchHostMap("sub.exato.test", map)).toBeNull();
    expect(matchHostMap("exemplo.com", map)).toBeNull();
    expect(matchHostMap("site.fixture.test", undefined)).toBeNull();
  });

  it("lê o formato da variável OS_CLONE_HOST_MAP", () => {
    expect(parseHostMap("*.fixture.test=127.0.0.1:4555, other.test=127.0.0.1:4556,,lixo,=x")).toEqual({
      "*.fixture.test": "127.0.0.1:4555",
      "other.test": "127.0.0.1:4556",
    });
    expect(parseHostMap("")).toEqual({});
    expect(parseHostMap(undefined)).toEqual({});
  });
});

// ─── Fetcher contra um servidor local ────────────────────────────────────────

const FILE_DATA = randomBytes(100 * 1024);
const BIG = Buffer.alloc(2000, "a");

let server: Server;
let port = 0;
const fetchers: Fetcher[] = [];

function makeFetcher(opts: Parameters<typeof createFetcher>[0] = {}) {
  const f = createFetcher({ hostMap: { "*.fixture.test": `127.0.0.1:${port}` }, ...opts });
  fetchers.push(f);
  return f;
}

function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://x");
  const send = (status: number, headers: Record<string, string | number>, body?: Buffer | string) => {
    res.writeHead(status, headers);
    res.end(body);
  };
  switch (url.pathname) {
    case "/text":
      return send(200, { "content-type": "text/html; charset=utf-8" }, "<h1>Olá</h1>");
    case "/gzip":
      return send(200, { "content-type": "text/css", "content-encoding": "gzip" }, gzipSync(".a{color:red}"));
    case "/br":
      return send(200, { "content-type": "text/css", "content-encoding": "br" }, brotliCompressSync(".b{}"));
    case "/deflate":
      return send(200, { "content-encoding": "deflate" }, deflateSync("zlib deflate"));
    case "/deflate-raw":
      return send(200, { "content-encoding": "deflate" }, deflateRawSync("raw deflate"));
    case "/gzip-bomb":
      return send(200, { "content-encoding": "gzip" }, gzipSync(Buffer.alloc(5 * 1024 * 1024)));
    case "/r1":
      return send(302, { location: "/r2" });
    case "/r2":
      return send(301, { location: "http://other.fixture.test/final?x=1#frag" });
    case "/final":
      return send(200, { "content-type": "text/plain" }, `host=${req.headers.host}`);
    case "/loop":
      return send(302, { location: `/loop?n=${Number(url.searchParams.get("n") ?? 0) + 1}` });
    case "/evil":
      return send(302, { location: `http://127.0.0.1:${port}/text` });
    case "/evil-localhost":
      return send(302, { location: `http://localhost:${port}/text` });
    case "/evil-file":
      return send(302, { location: "file:///etc/passwd" });
    case "/big":
      return send(200, { "content-length": BIG.length }, BIG);
    case "/big-chunked":
      res.writeHead(200, { "content-type": "text/plain" });
      res.write(BIG.subarray(0, 1000));
      res.end(BIG.subarray(1000));
      return;
    case "/slow":
      return; // nunca responde
    case "/stall-body":
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("começo…");
      return; // corpo nunca termina
    case "/missing":
      return send(404, { "content-type": "text/html" }, "não achei");
    case "/echo":
      return send(
        200,
        { "content-type": "application/json" },
        JSON.stringify({ referer: req.headers.referer ?? null, ua: req.headers["user-agent"] }),
      );
    case "/file":
      return send(200, { "content-type": "application/octet-stream", "content-length": FILE_DATA.length }, FILE_DATA);
    default:
      return send(404, {}, "");
  }
}

beforeAll(async () => {
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const f of fetchers) await f.close().catch(() => {});
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("createFetcher", () => {
  it("baixa texto (200) pelo hostMap", async () => {
    const res = await makeFetcher().fetchResource("http://site.fixture.test/text");
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.contentType).toBe("text/html; charset=utf-8");
    expect(res.body.toString("utf8")).toBe("<h1>Olá</h1>");
    expect(res.finalUrl).toBe("http://site.fixture.test/text");
    expect(res.error).toBeUndefined();
  });

  it("descompacta gzip, br e deflate (zlib e cru)", async () => {
    const f = makeFetcher();
    expect((await f.fetchResource("http://site.fixture.test/gzip")).body.toString()).toBe(".a{color:red}");
    expect((await f.fetchResource("http://site.fixture.test/br")).body.toString()).toBe(".b{}");
    expect((await f.fetchResource("http://site.fixture.test/deflate")).body.toString()).toBe("zlib deflate");
    expect((await f.fetchResource("http://site.fixture.test/deflate-raw")).body.toString()).toBe("raw deflate");
  });

  it("segue a cadeia de redirecionamentos e informa a URL final", async () => {
    const res = await makeFetcher().fetchResource("http://site.fixture.test/r1");
    expect(res.ok).toBe(true);
    expect(res.finalUrl).toBe("http://other.fixture.test/final?x=1");
    expect(res.body.toString()).toBe("host=other.fixture.test");
  });

  it("para depois de 5 redirecionamentos", async () => {
    const res = await makeFetcher().fetchResource("http://site.fixture.test/loop");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Redirecionamentos demais/);
  });

  it("bloqueia redirecionamento para 127.0.0.1 e localhost (fora do hostMap)", async () => {
    const f = makeFetcher();
    const a = await f.fetchResource("http://site.fixture.test/evil");
    expect(a.ok).toBe(false);
    expect(a.status).toBe(0);
    expect(a.error).toMatch(/bloqueado por segurança/);
    expect(a.finalUrl).toBe(`http://127.0.0.1:${port}/text`);

    const b = await f.fetchResource("http://site.fixture.test/evil-localhost");
    expect(b.ok).toBe(false);
    expect(b.error).toMatch(/bloqueado por segurança/);

    const c = await f.fetchResource("http://site.fixture.test/evil-file");
    expect(c.error).toMatch(/só é possível baixar links http/);
  });

  it("bloqueia acesso direto a endereços internos, a menos que allowPrivate", async () => {
    const blocked = await makeFetcher({ hostMap: {} }).fetchResource(`http://127.0.0.1:${port}/text`);
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/bloqueado por segurança/);

    const v6 = await makeFetcher({ hostMap: {} }).fetchResource(`http://[::1]:${port}/text`);
    expect(v6.error).toMatch(/bloqueado por segurança/);

    const allowed = await makeFetcher({ hostMap: {}, allowPrivate: true }).fetchResource(
      `http://127.0.0.1:${port}/text`,
    );
    expect(allowed.ok).toBe(true);
    expect(allowed.body.toString()).toBe("<h1>Olá</h1>");
  });

  it("recusa protocolos que não são http/https e URLs inválidas", async () => {
    const f = makeFetcher();
    expect((await f.fetchResource("file:///etc/passwd")).error).toMatch(/só é possível baixar links http/);
    expect((await f.fetchResource("ftp://site.fixture.test/a")).error).toMatch(/só é possível baixar links http/);
    expect((await f.fetchResource("nada disso")).error).toMatch(/Endereço inválido/);
  });

  it("respeita o limite de tamanho (Content-Length, chunked e descompactado)", async () => {
    const f = makeFetcher({ maxBytes: 1000 });
    for (const p of ["/big", "/big-chunked", "/gzip-bomb"]) {
      const res = await f.fetchResource(`http://site.fixture.test${p}`);
      expect(res.ok, p).toBe(false);
      expect(res.error, p).toMatch(/^Arquivo maior que o limite de 1 KB/);
      expect(res.body.length, p).toBe(0);
    }
    const mb = await makeFetcher({ maxBytes: 1024 * 1024 }).fetchResource("http://site.fixture.test/gzip-bomb");
    expect(mb.error).toBe("Arquivo maior que o limite de 1 MB.");
  });

  it("tempo esgotado: servidor que não responde e corpo que trava", async () => {
    const f = makeFetcher({ timeoutMs: 300 });
    const started = Date.now();
    const slow = await f.fetchResource("http://site.fixture.test/slow");
    expect(slow.ok).toBe(false);
    expect(slow.error).toMatch(/Tempo esgotado/);
    expect(Date.now() - started).toBeLessThan(5000);

    const stall = await f.fetchResource("http://site.fixture.test/stall-body");
    expect(stall.ok).toBe(false);
    expect(stall.status).toBe(200);
    expect(stall.error).toMatch(/Tempo esgotado/);
  });

  it("404 volta com ok=false, status e mensagem", async () => {
    const res = await makeFetcher().fetchResource("http://site.fixture.test/missing");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(res.body.toString()).toBe("não achei");
    expect(res.error).toMatch(/404/);
  });

  it("envia Referer e User-Agent", async () => {
    const res = await makeFetcher({ userAgent: "TesteUA/1.0" }).fetchResource("http://site.fixture.test/echo", {
      referer: "http://site.fixture.test/",
    });
    expect(JSON.parse(res.body.toString())).toEqual({ referer: "http://site.fixture.test/", ua: "TesteUA/1.0" });
  });
});

describe("downloadToFile + putFileContentAddressed", () => {
  it("baixa para arquivo, calcula o hash e move para o storage (com deduplicação)", async () => {
    const f = makeFetcher();
    const tmp = path.join(TMP, "dl", "arquivo.tmp");
    const got = await f.downloadToFile("http://site.fixture.test/file", tmp, 10 * 1024 * 1024);
    const hash = createHash("sha256").update(FILE_DATA).digest("hex");
    expect(got).toEqual({
      bytes: FILE_DATA.length,
      sha256: hash,
      contentType: "application/octet-stream",
      finalUrl: "http://site.fixture.test/file",
    });
    expect(readFileSync(tmp).equals(FILE_DATA)).toBe(true);

    const copy = path.join(TMP, "dl", "copia.tmp");
    await copyFile(tmp, copy);

    const stored = await putFileContentAddressed(tmp, ".MP4");
    writtenKeys.add(stored.key);
    expect(stored).toEqual({ key: `a/${hash.slice(0, 2)}/${hash}.mp4`, sha256: hash, bytes: FILE_DATA.length });
    expect(objectExists(stored.key)).toBe(true);
    expect(readFileSync(storagePath(stored.key)).equals(FILE_DATA)).toBe(true);
    expect(existsSync(tmp)).toBe(false);

    // Mesmo conteúdo de novo: não duplica e apaga o temporário.
    const again = await putFileContentAddressed(copy, "mp4");
    expect(again.key).toBe(stored.key);
    expect(existsSync(copy)).toBe(false);
  });

  it("falhas lançam FetchError em português e não deixam arquivo parcial", async () => {
    const f = makeFetcher();
    const tmp = path.join(TMP, "dl", "falha.tmp");

    const notFound = f.downloadToFile("http://site.fixture.test/missing", tmp, 1024);
    await expect(notFound).rejects.toBeInstanceOf(FetchError);
    await expect(notFound).rejects.toThrow(/404/);
    expect(existsSync(tmp)).toBe(false);

    await expect(f.downloadToFile("http://site.fixture.test/big-chunked", tmp, 1500)).rejects.toThrow(
      /Arquivo maior que o limite/,
    );
    expect(existsSync(tmp)).toBe(false);

    await expect(f.downloadToFile("http://site.fixture.test/evil", tmp, 1500)).rejects.toThrow(
      /bloqueado por segurança/,
    );
  });
});

// ─── ZIP ─────────────────────────────────────────────────────────────────────

interface ZipSpec {
  /** Texto (gravado em UTF-8) ou bytes crus do nome. */
  name: string | Buffer;
  /** Marca de nome em UTF-8 (padrão: true). */
  utf8Flag?: boolean;
  data?: Buffer | string;
  /** 0 = sem compressão, 8 = deflate (padrão). */
  method?: 0 | 8;
  /** Modo unix (ex.: 0o120777 para link simbólico). */
  mode?: number;
  encrypted?: boolean;
}

/** Monta um ZIP mínimo à mão (permite nomes e atributos maliciosos). */
function buildZip(entries: ZipSpec[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = typeof e.name === "string" ? Buffer.from(e.name, "utf8") : e.name;
    const raw = typeof e.data === "string" ? Buffer.from(e.data) : (e.data ?? Buffer.alloc(0));
    const method = e.method ?? 8;
    const comp = method === 8 ? deflateRawSync(raw) : raw;
    const flags = (e.utf8Flag === false ? 0 : 0x800) | (e.encrypted ? 1 : 0);
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE((3 << 8) | 20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(((e.mode ?? 0o100644) << 16) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}

let zipCounter = 0;
async function writeZip(entries: ZipSpec[]) {
  await mkdir(TMP, { recursive: true });
  const file = path.join(TMP, `z${++zipCounter}.zip`);
  await writeFile(file, buildZip(entries));
  return file;
}

const INDEX = "<!doctype html><html><head><title>Oferta</title></head><body>Oi</body></html>";

describe("readZipSite", () => {
  it("site dentro de uma pasta (zip do sistema), ignorando .DS_Store e pastas", async () => {
    const dir = path.join(TMP, "cli-site");
    await mkdir(path.join(dir, "meu-site", "css"), { recursive: true });
    await mkdir(path.join(dir, "meu-site", "imagens"), { recursive: true });
    await writeFile(path.join(dir, "meu-site", "index.html"), INDEX);
    await writeFile(path.join(dir, "meu-site", "obrigado.html"), "<p>Obrigado</p>");
    await writeFile(path.join(dir, "meu-site", "css", "estilo.css"), "body{margin:0}");
    await writeFile(path.join(dir, "meu-site", "imagens", "promoção.png"), Buffer.from([1, 2, 3]));
    await writeFile(path.join(dir, "meu-site", ".DS_Store"), "lixo");
    const zipPath = path.join(TMP, "cli-site.zip");
    execFileSync("zip", ["-r", "-q", zipPath, "meu-site"], { cwd: dir });

    const site = await readZipSite(zipPath);
    expect(site.indexPath).toBe("meu-site/index.html");
    expect(site.rootDir).toBe("meu-site/");
    expect([...site.files.keys()].sort()).toEqual([
      "meu-site/css/estilo.css",
      "meu-site/imagens/promoção.png",
      "meu-site/index.html",
      "meu-site/obrigado.html",
    ]);
    expect(site.files.get("meu-site/index.html")?.toString()).toBe(INDEX);
    expect(site.warnings).toEqual([]);
  });

  it("index.html na raiz tem prioridade; senão o único .html; senão o maior (com aviso)", async () => {
    const root = await readZipSite(
      await writeZip([
        { name: "pasta/index.html", data: "<p>a</p>" },
        { name: "index.htm", data: "<p>b</p>" },
      ]),
    );
    expect(root.indexPath).toBe("index.htm");

    const only = await readZipSite(await writeZip([{ name: "pagina.html", data: INDEX }, { name: "a.css" }]));
    expect(only.indexPath).toBe("pagina.html");
    expect(only.warnings).toEqual([]);

    const largest = await readZipSite(
      await writeZip([
        { name: "a.html", data: "<p>curta</p>" },
        { name: "b/venda.html", data: INDEX },
      ]),
    );
    expect(largest.indexPath).toBe("b/venda.html");
    expect(largest.warnings[0]).toMatch(/usamos "b\/venda.html"/);
  });

  it("normaliza barras invertidas e ignora __MACOSX", async () => {
    const site = await readZipSite(
      await writeZip([
        { name: "site\\index.html", data: INDEX },
        { name: "__MACOSX/site/._index.html", data: "x" },
        { name: "site/./css/a.css", data: "a{}" },
      ]),
    );
    expect([...site.files.keys()].sort()).toEqual(["site/css/a.css", "site/index.html"]);
  });

  it.each([
    ["../evil.txt"],
    ["site/../../evil.txt"],
    ["..\\evil.txt"],
    ["/etc/passwd"],
    ["C:/windows/evil.txt"],
  ])("recusa o caminho perigoso %j (zip-slip)", async (name) => {
    const zip = await writeZip([
      { name: "index.html", data: INDEX },
      { name, data: "mal" },
    ]);
    await expect(readZipSite(zip)).rejects.toThrow(/O ZIP parece corrompido ou malicioso \(caminho inválido/);
  });

  it("recusa link simbólico (criado à mão e pelo zip -y)", async () => {
    const manual = await writeZip([
      { name: "index.html", data: INDEX },
      { name: "segredo", data: "/etc/passwd", method: 0, mode: 0o120777 },
    ]);
    await expect(readZipSite(manual)).rejects.toThrow(/link simbólico/);

    const dir = path.join(TMP, "cli-link");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "index.html"), INDEX);
    await symlink("/etc/passwd", path.join(dir, "senhas"));
    const zipPath = path.join(TMP, "cli-link.zip");
    execFileSync("zip", ["-r", "-q", "-y", zipPath, "."], { cwd: dir });
    await expect(readZipSite(zipPath)).rejects.toThrow(/O ZIP parece corrompido ou malicioso.*link simbólico/);
  });

  it("recusa entradas protegidas por senha", async () => {
    const zip = await writeZip([{ name: "index.html", data: INDEX, encrypted: true }]);
    await expect(readZipSite(zip)).rejects.toThrow(/protegido por senha/);
  });

  it("recusa ZIP com arquivos demais", async () => {
    const entries = Array.from({ length: 11 }, (_, i) => ({ name: `p${i}.html`, data: "x" }));
    await expect(readZipSite(await writeZip(entries), { maxEntries: 10 })).rejects.toThrow(
      /O ZIP parece corrompido ou malicioso \(tem mais de 10 arquivos\)/,
    );
    await expect(readZipSite(await writeZip(entries.slice(0, 10)), { maxEntries: 10 })).resolves.toBeTruthy();
  });

  it("recusa bomba de compressão (taxa alta) e arquivos/total grandes demais", async () => {
    const bomb = await writeZip([
      { name: "index.html", data: INDEX },
      { name: "zeros.bin", data: Buffer.alloc(5 * 1024 * 1024) },
    ]);
    await expect(readZipSite(bomb)).rejects.toThrow(/O ZIP parece corrompido ou malicioso.*taxa de compressão/);

    const two = await writeZip([
      { name: "index.html", data: INDEX },
      { name: "a.bin", data: randomBytes(2000) },
      { name: "b.bin", data: randomBytes(2000) },
    ]);
    await expect(readZipSite(two, { maxFileBytes: 1000 })).rejects.toThrow(/"a.bin" tem mais de 1 KB/);
    await expect(readZipSite(two, { maxTotalBytes: 3000 })).rejects.toThrow(/depois de descompactado/);

    // Arquivo pequeno e repetitivo (abaixo de 1 MB) não conta como bomba.
    const small = await writeZip([{ name: "index.html", data: " ".repeat(500_000) }]);
    await expect(readZipSite(small)).resolves.toMatchObject({ indexPath: "index.html" });
  });

  it("erro claro quando não há .html ou o arquivo não é ZIP", async () => {
    await expect(readZipSite(await writeZip([{ name: "estilo.css", data: "a{}" }]))).rejects.toThrow(
      "Não encontrei nenhum arquivo .html no ZIP.",
    );
    const notZip = path.join(TMP, "falso.zip");
    await writeFile(notZip, "isto não é um zip");
    await expect(readZipSite(notZip)).rejects.toThrow("O arquivo enviado não é um ZIP válido.");
  });

  it("nomes sem a marca UTF-8: UTF-8 cru (zip do Mac/Linux) ou CP850 (Windows em português)", async () => {
    const site = await readZipSite(
      await writeZip([
        { name: Buffer.from("página.html", "utf8"), utf8Flag: false, data: INDEX },
        { name: iconv.encode("imagens/ação.png", "cp850"), utf8Flag: false, data: "x" },
      ]),
    );
    expect([...site.files.keys()].sort()).toEqual(["imagens/ação.png", "página.html"]);
    expect(site.indexPath).toBe("página.html");
  });

  it("nomes acentuados em NFD viram NFC e são encontrados por qualquer forma", async () => {
    const nfd = "imagens/promoção.png".normalize("NFD");
    const site = await readZipSite(
      await writeZip([
        { name: "index.html", data: INDEX },
        { name: nfd, data: Buffer.from([9]) },
      ]),
    );
    expect(site.files.has("imagens/promoção.png".normalize("NFC"))).toBe(true);

    const encoded = resolveZipPath("index.html", "imagens/promo%C3%A7%C3%A3o.png?v=2");
    expect(encoded).toBe("imagens/promoção.png".normalize("NFC"));
    expect(findZipFile(site.files, encoded ?? "")?.equals(Buffer.from([9]))).toBe(true);

    const literalNfd = resolveZipPath("index.html", nfd);
    expect(findZipFile(site.files, literalNfd ?? "")).not.toBeNull();

    // Mapa montado com chaves NFD (sem normalizar) também é encontrado.
    const raw = new Map([[nfd, Buffer.from([7])]]);
    expect(findZipEntry(raw, "imagens/promoção.png".normalize("NFC"))?.path).toBe(nfd);
    // Caminho da URL (%XX) e maiúsculas diferentes.
    expect(findZipFile(site.files, "Imagens/promo%C3%A7%C3%A3o.PNG")).not.toBeNull();
  });
});

describe("resolveZipPath", () => {
  it.each<[string, string, string | null, string?]>([
    ["index.html", "css/a.css", "css/a.css"],
    ["index.html", "./css/../img/b.png", "img/b.png"],
    ["pages/x.html", "../img/a%20b.png?v=1#topo", "img/a b.png"],
    ["site/pages/x.html", "/img/a.png", "site/img/a.png", "site/"],
    ["index.html", "img\\foto.jpg", "img/foto.jpg"],
    ["index.html", "obrigado/", "obrigado/index.html"],
    ["index.html", "../../etc/passwd", null],
    ["index.html", "https://cdn.exemplo.com/a.js", null],
    ["index.html", "//cdn.exemplo.com/a.js", null],
    ["index.html", "data:image/png;base64,AAAA", null],
    ["index.html", "mailto:a@b.com", null],
    ["index.html", "#topo", null],
    ["index.html", "", null],
    ["index.html", "a%ZZb.png", "a%ZZb.png"],
  ])("resolveZipPath(%j, %j) → %j", (from, ref, expected, rootDir) => {
    expect(resolveZipPath(from, ref, rootDir)).toBe(expected);
  });

  it("findZipFile acha index.htm para links de pasta", () => {
    const files = new Map([["obrigado/index.htm", Buffer.from("ok")]]);
    expect(findZipFile(files, resolveZipPath("index.html", "obrigado/") ?? "")?.toString()).toBe("ok");
    expect(findZipFile(files, "nao-existe.html")).toBeNull();
  });
});
