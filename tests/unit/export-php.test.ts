/**
 * eventos.php com o PHP de verdade. Só roda quando o computador tem o `php`
 * (ou quando OS_PHP_BIN aponta para um); sem PHP, a sintaxe (PHP 7.4) já é
 * conferida pelo php-parser em export-helpers.test.ts.
 *
 * - `php -l` nos dois arquivos gerados;
 * - `php -S` servindo a pasta, como a hospedagem: aberto no navegador (GET)
 *   mostra que funciona sem mostrar tokens; o POST do script das páginas
 *   (sendBeacon: JSON como text/plain, formato de docs/PLANO.md) responde 204
 *   e monta os pedidos da API de Conversões (Meta) e da Events API (TikTok) —
 *   o envio é trocado por um registro em arquivo; outra origem (ou nenhuma)
 *   403; corpo grande 413; JSON inválido 400; eventos-dados/config.php aberto
 *   direto 404;
 * - IP do visitante: o da conexão; X-Forwarded-For só com trust_proxy; o
 *   limite por IP não se engana trocando o cabeçalho; faixas da Cloudflare;
 * - envio de verdade (com cURL e, sem ele, por allow_url_fopen) para
 *   "plataformas" locais lentas: o 204 sai na hora e os dois pedidos chegam
 *   com o corpo e o Access-Token certos.
 *
 * Sem PHP instalado, dá para rodar com o PHP em WebAssembly (PHP 7.4 a 8.5):
 *   npm install --prefix <pasta> @php-wasm/cli
 *   <pasta>/php → exec env PHP=7.4 node <pasta>/node_modules/@php-wasm/cli/php-wasm.js \
 *                   -d opcache.enable=0 -d opcache.enable_cli=0 "$@"
 *   TMPDIR=/private/tmp/os-php OS_PHP_BIN=<pasta>/php npx vitest run tests/unit/export-php.test.ts
 * (o PHP em WebAssembly não enxerga a pasta temporária padrão do macOS, /var/folders.)
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingHttpHeaders } from "node:http";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CLOUDFLARE_RANGES,
  EVENTOS_CONFIG_FILE,
  EVENTOS_MAX_BODY,
  EVENTOS_RATE_LIMIT,
  eventosConfigPhp,
  eventosPhp,
  HTACCESS_FILE,
  htaccess,
  META_EVENTS_URL,
  TIKTOK_EVENTS_URL,
} from "@/lib/export/php";

/** `php` do computador (ou OS_PHP_BIN); null quando não tem. */
function findPhp(): string | null {
  for (const bin of [process.env.OS_PHP_BIN, "php"]) {
    if (!bin) continue;
    const r = spawnSync(bin, ["-v"], { encoding: "utf8", timeout: 30_000 });
    if (r.status === 0 && /PHP \d/.test(r.stdout)) return bin;
  }
  return null;
}

const PHP = findPhp();

const META_PIXEL = "123456789012345";
const META_TOKEN = "EAAGm0PX4ZCpsBA'KZ\\Zy1234567890";
const TIKTOK_PIXEL = "C1ABCDEFGHIJ2KLMNOPQ";
const TIKTOK_TOKEN = "0123456789abcdef0123456789abcdef01234567";

/** Troca o envio às plataformas por uma linha em saida.jsonl (URL, corpo, cabeçalhos). */
function instrumented(code: string): string {
  const out = code.replace(
    /function os_post\(\$url, \$body, \$headers\)\n\{/,
    "function os_post($url, $body, $headers)\n{\n    file_put_contents(__DIR__ . '/saida.jsonl', json_encode(array($url, json_decode($body, true), $headers)) . \"\\n\", FILE_APPEND);\n    return;",
  );
  if (out === code) throw new Error("os_post não encontrado no eventos.php");
  return out;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

const configPhp = ({ trustProxy = false } = {}) => {
  const code = eventosConfigPhp([
    { vendor: "META", pixelId: META_PIXEL, token: META_TOKEN, testEventCode: "TEST123" },
    { vendor: "TIKTOK", pixelId: TIKTOK_PIXEL, token: TIKTOK_TOKEN, testEventCode: null },
  ]);
  if (!trustProxy) return code;
  const out = code.replace("'trust_proxy' => false", "'trust_proxy' => true");
  if (out === code) throw new Error("trust_proxy não encontrado no config.php");
  return out;
};

/** Pasta como no ZIP: eventos.php na raiz e os tokens em eventos-dados/ (com o .htaccess dela). */
async function writeSite(dir: string, eventos: string, config = configPhp()) {
  await writeFile(path.join(dir, "eventos.php"), eventos);
  await mkdir(path.join(dir, path.dirname(EVENTOS_CONFIG_FILE)), { recursive: true });
  await writeFile(path.join(dir, EVENTOS_CONFIG_FILE), config);
  await writeFile(path.join(dir, HTACCESS_FILE), htaccess());
}

/** `php -S` servindo `dir` (como a hospedagem), já respondendo. */
async function startPhp(dir: string, extraArgs: string[] = []): Promise<{ server: ChildProcess; origin: string }> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(PHP as string, [...extraArgs, "-S", `127.0.0.1:${port}`, "-t", dir], { stdio: "ignore" });
  for (let i = 0; i < 300; i++) {
    const ok = await fetch(`${origin}/eventos.php`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return { server, origin };
    await new Promise((r) => setTimeout(r, 100));
  }
  server.kill();
  throw new Error("php -S não respondeu");
}

describe.skipIf(!PHP)("eventos.php no PHP de verdade", () => {
  let dir: string;
  let server: ChildProcess | null = null;
  let base: string;
  let origin: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "os-eventos-php-"));
    await writeSite(dir, instrumented(eventosPhp()));
    await writeFile(path.join(dir, "original.php"), eventosPhp());
    ({ server, origin } = await startPhp(dir));
    base = `${origin}/`;
  }, 60_000);

  afterAll(async () => {
    server?.kill();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function sent(): Promise<[string, Record<string, unknown>, string[]][]> {
    const text = await readFile(path.join(dir, "saida.jsonl"), "utf8").catch(() => "");
    return text
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }

  async function clearSent() {
    await rm(path.join(dir, "saida.jsonl"), { force: true });
  }

  const now = Math.floor(Date.now() / 1000);
  const pageView = () => ({
    event: "PAGE_VIEW",
    event_name: { META: "PageView" },
    event_id: "pv-123",
    event_time: now,
    event_source_url: `${base}oferta-a/?utm_source=facebook`,
    fbp: "fb.1.1727650000000.1234567890",
    fbc: "fb.1.1727650000000.AbC123_x",
    ttp: "ttpCookie_1",
    ttclid: "tt-999",
  });
  const beacon = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}eventos.php`, {
      method: "POST",
      headers: {
        "content-type": "text/plain;charset=UTF-8",
        origin,
        "user-agent": "Mozilla/5.0 Teste",
        "x-forwarded-for": "10.1.1.1, 200.150.10.20",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("php -l aceita os arquivos gerados", async () => {
    for (const file of ["original.php", EVENTOS_CONFIG_FILE]) {
      const r = spawnSync(PHP as string, ["-l", path.join(dir, file)], { encoding: "utf8", timeout: 30_000 });
      expect(r.status, `${file}: ${r.stdout}${r.stderr}`).toBe(0);
      expect(r.stdout).toContain("No syntax errors");
    }
  });

  it("aberto no navegador: mostra que funciona, sem tokens", async () => {
    const res = await fetch(`${base}eventos.php`);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain("eventos.php do Offer Studio funcionando.");
    expect(text).toContain("Meta (API de Conversões): 1 pixel(s)");
    expect(text).toContain("TikTok (Events API): 1 pixel(s)");
    expect(text).not.toContain(META_TOKEN);
    expect(text).not.toContain(TIKTOK_TOKEN);
  });

  it("eventos-dados/config.php aberto direto: 404 sem conteúdo (o php -S ignora o .htaccess)", async () => {
    const res = await fetch(`${base}${EVENTOS_CONFIG_FILE}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });

  it("PageView: 204 e só a Meta (o TikTok não recebe PageView pelo servidor)", async () => {
    await clearSent();
    const res = await beacon(pageView());
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    await expect.poll(async () => (await sent()).length).toBe(1);
    const [[url, body, headers]] = await sent();
    expect(url).toBe(META_EVENTS_URL(META_PIXEL));
    expect(headers).toContain("Content-Type: application/json");
    expect(body).toEqual({
      data: [
        {
          event_name: "PageView",
          event_time: now,
          event_id: "pv-123",
          action_source: "website",
          event_source_url: `${base}oferta-a/?utm_source=facebook`,
          // IP da conexão: o X-Forwarded-For do pedido é ignorado sem trust_proxy.
          user_data: {
            client_ip_address: "127.0.0.1",
            client_user_agent: "Mozilla/5.0 Teste",
            fbp: "fb.1.1727650000000.1234567890",
            fbc: "fb.1.1727650000000.AbC123_x",
          },
        },
      ],
      access_token: META_TOKEN,
      test_event_code: "TEST123",
    });
  });

  it("InitiateCheckout com valor: Meta e TikTok (Access-Token no cabeçalho)", async () => {
    await clearSent();
    const res = await beacon({
      ...pageView(),
      event: "INITIATE_CHECKOUT",
      event_name: { META: "InitiateCheckout", TIKTOK: "InitiateCheckout" },
      event_id: "ic-1",
      value: 97.5,
      currency: "BRL",
    });
    expect(res.status).toBe(204);
    await expect.poll(async () => (await sent()).length).toBe(2);
    const calls = await sent();
    const meta = calls.find((c) => c[0].includes("graph.facebook.com"));
    const tiktok = calls.find((c) => c[0] === TIKTOK_EVENTS_URL);
    expect((meta?.[1].data as Record<string, unknown>[])[0].custom_data).toEqual({ value: 97.5, currency: "BRL" });
    expect(tiktok?.[2]).toContain(`Access-Token: ${TIKTOK_TOKEN}`);
    expect(tiktok?.[1]).toEqual({
      event_source: "web",
      event_source_id: TIKTOK_PIXEL,
      data: [
        {
          event: "InitiateCheckout",
          event_time: now,
          event_id: "ic-1",
          user: { ttclid: "tt-999", ttp: "ttpCookie_1", ip: "127.0.0.1", user_agent: "Mozilla/5.0 Teste" },
          page: { url: `${base}oferta-a/?utm_source=facebook` },
          properties: { value: 97.5, currency: "BRL" },
        },
      ],
    });
  });

  it("teste A/B: os_versao vai em custom_data (Meta) e properties (TikTok); valor fora do formato fica de fora", async () => {
    await clearSent();
    const res = await beacon({
      ...pageView(),
      event: "INITIATE_CHECKOUT",
      event_name: { META: "InitiateCheckout", TIKTOK: "InitiateCheckout" },
      event_id: "ic-ab",
      os_versao: "B",
    });
    expect(res.status).toBe(204);
    await expect.poll(async () => (await sent()).length).toBe(2);
    const calls = await sent();
    const meta = calls.find((c) => c[0].includes("graph.facebook.com"));
    const tiktok = calls.find((c) => c[0] === TIKTOK_EVENTS_URL);
    expect((meta?.[1].data as Record<string, unknown>[])[0].custom_data).toEqual({ os_versao: "B" });
    expect((tiktok?.[1].data as Record<string, unknown>[])[0].properties).toEqual({ os_versao: "B" });

    // Com valor: os dois juntos.
    await clearSent();
    await beacon({ ...pageView(), event_id: "pv-ab", os_versao: "A", value: 10, currency: "BRL" });
    await expect.poll(async () => (await sent()).length).toBe(1);
    expect(((await sent())[0][1].data as Record<string, unknown>[])[0].custom_data).toEqual({
      value: 10,
      currency: "BRL",
      os_versao: "A",
    });

    // Fora do formato (HTML, longo demais): o evento sai sem a versão.
    await clearSent();
    await beacon({ ...pageView(), event_id: "pv-ab2", os_versao: "<b>B</b>" });
    await beacon({ ...pageView(), event_id: "pv-ab3", os_versao: "x".repeat(21) });
    await expect.poll(async () => (await sent()).length).toBe(2);
    for (const [, body] of await sent()) {
      expect((body.data as Record<string, unknown>[])[0].custom_data).toBeUndefined();
    }
  });

  it("recusa o que não veio da página: outra origem, corpo grande, JSON inválido, formulário", async () => {
    await clearSent();
    expect((await beacon(pageView(), { origin: "https://site-malicioso.com" })).status).toBe(403);
    // Sem Origin nem Referer (curl, outro servidor): não é o script das páginas.
    const bare = await fetch(`${base}eventos.php`, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: JSON.stringify(pageView()),
    });
    expect(bare.status).toBe(403);
    // Só o Referer (página que esconde a Origin): vale o Referer.
    expect((await beacon(pageView(), { origin: "null", referer: `${base}oferta-a/` })).status).toBe(204);
    expect((await beacon(pageView(), { origin: "null", referer: "https://outro.com/" })).status).toBe(403);
    await expect.poll(async () => (await sent()).length).toBe(1);
    await clearSent();
    expect((await beacon({ ...pageView(), extra: "a".repeat(EVENTOS_MAX_BODY) })).status).toBe(413);
    expect((await beacon("{nao-e-json")).status).toBe(400);
    expect((await beacon({ ...pageView(), event_id: "<script>" })).status).toBe(400);
    expect((await beacon("a=1", { "content-type": "application/x-www-form-urlencoded" })).status).toBe(415);
    expect((await fetch(`${base}eventos.php`, { method: "PUT", body: "{}" })).status).toBe(405);
    await new Promise((r) => setTimeout(r, 200));
    expect(await sent()).toEqual([]);
  });
});

/**
 * IP do visitante e limite por IP: o IP é o da conexão (REMOTE_ADDR); o
 * X-Forwarded-For só vale com 'trust_proxy' => true (outro CDN na frente) e o
 * CF-Connecting-IP só quando a conexão vem das faixas da Cloudflare. Trocar o
 * cabeçalho a cada pedido não escapa do limite nem escolhe o IP da Meta.
 */
describe.skipIf(!PHP)("eventos.php: IP do visitante e limite por IP", () => {
  const LIMIT = 4;
  const servers: ChildProcess[] = [];
  const dirs: string[] = [];

  /** eventos.php com o limite baixo (para o teste) e o envio registrado em arquivo. */
  async function site(opts: { trustProxy?: boolean } = {}) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "os-eventos-ip-"));
    dirs.push(dir);
    const code = instrumented(eventosPhp());
    const limited = code.replace(`const OS_RATE_LIMIT = ${EVENTOS_RATE_LIMIT};`, `const OS_RATE_LIMIT = ${LIMIT};`);
    if (limited === code) throw new Error("OS_RATE_LIMIT não encontrado no eventos.php");
    await writeSite(dir, limited, configPhp(opts));
    const { server, origin } = await startPhp(dir);
    servers.push(server);
    return { dir, origin };
  }

  afterAll(async () => {
    for (const server of servers) server.kill();
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  const post = (origin: string, headers: Record<string, string>, id: string) =>
    fetch(`${origin}/eventos.php`, {
      method: "POST",
      headers: { "content-type": "text/plain;charset=UTF-8", origin, ...headers },
      body: JSON.stringify({
        event: "PAGE_VIEW",
        event_name: { META: "PageView" },
        event_id: id,
        event_source_url: `${origin}/`,
      }),
    });

  async function ips(dir: string): Promise<string[]> {
    const text = await readFile(path.join(dir, "saida.jsonl"), "utf8").catch(() => "");
    return text
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l)[1].data[0].user_data.client_ip_address);
  }

  it("sem trust_proxy: trocar o X-Forwarded-For não muda o IP enviado nem escapa do limite", async () => {
    const { dir, origin } = await site();
    // O limite conta por minuto do relógio: começa longe da virada.
    const second = new Date().getSeconds();
    if (second > 48) await new Promise((r) => setTimeout(r, (61 - second) * 1000));
    const statuses: number[] = [];
    for (let i = 0; i < LIMIT + 2; i++) {
      const res = await post(origin, { "x-forwarded-for": `200.150.10.${i + 1}`, "x-real-ip": "8.8.8.8" }, `pv-${i}`);
      statuses.push(res.status);
    }
    expect(statuses).toEqual([...Array(LIMIT).fill(204), 429, 429]);
    await expect.poll(async () => (await ips(dir)).length).toBe(LIMIT);
    expect(new Set(await ips(dir))).toEqual(new Set(["127.0.0.1"]));
    // CF-Connecting-IP de uma conexão que não vem da Cloudflare: ignorado.
    expect((await post(origin, { "cf-connecting-ip": "200.1.2.3" }, "pv-cf")).status).toBe(429);
  }, 60_000);

  it("com trust_proxy: o primeiro IP público do X-Forwarded-For", async () => {
    const { dir, origin } = await site({ trustProxy: true });
    expect((await post(origin, { "x-forwarded-for": "10.1.1.1, 200.150.10.20" }, "pv-1")).status).toBe(204);
    expect((await post(origin, { "x-forwarded-for": "192.168.0.9", "x-real-ip": "200.99.1.1" }, "pv-2")).status).toBe(
      204,
    );
    // Só IPs privados: fica o da conexão.
    expect((await post(origin, { "x-forwarded-for": "10.0.0.1" }, "pv-3")).status).toBe(204);
    await expect.poll(async () => (await ips(dir)).length).toBe(3);
    expect(await ips(dir)).toEqual(["200.150.10.20", "200.99.1.1", "127.0.0.1"]);
  }, 60_000);

  it("faixas da Cloudflare (IPv4 e IPv6) reconhecidas; o resto não", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "os-eventos-cf-"));
    dirs.push(dir);
    // Só as funções do eventos.php (sem o código que responde ao pedido).
    const code = eventosPhp();
    const start = code.indexOf("function os_ip_in(");
    const end = code.indexOf("function os_public_ip(");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const cases: [string, boolean][] = [
      ["173.245.48.1", true],
      ["104.16.0.1", true],
      ["172.71.255.254", true],
      ["162.159.1.1", true],
      ["2606:4700::6810:84e5", true],
      ["2a06:98c7:ffff::1", true],
      ["8.8.8.8", false],
      ["172.72.0.1", false],
      ["127.0.0.1", false],
      ["2001:db8::1", false],
      ["lixo", false],
    ];
    const script = `<?php\n${code.slice(start, end)}\nforeach (${JSON.stringify(cases.map(([ip]) => ip))
      .replace(/^\[/, "array(")
      .replace(/\]$/, ")")} as $ip) { echo $ip, '=', os_from_cloudflare($ip) ? '1' : '0', "\\n"; }\n`;
    await writeFile(path.join(dir, "cf.php"), script);
    const r = spawnSync(PHP as string, [path.join(dir, "cf.php")], { encoding: "utf8", timeout: 30_000 });
    expect(r.status, r.stderr).toBe(0);
    const got = Object.fromEntries(
      r.stdout
        .trim()
        .split("\n")
        .map((l) => l.split("=") as [string, string]),
    );
    for (const [ip, want] of cases) expect(got[ip], ip).toBe(want ? "1" : "0");
    expect(CLOUDFLARE_RANGES.length).toBeGreaterThan(10);
  }, 60_000);
});

interface VendorHit {
  url: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

/**
 * Envio de verdade: o eventos.php (sem instrumentar, só com os endereços das
 * plataformas trocados por um servidor local LENTO) manda os pedidos pelo
 * cURL — ou, sem cURL, pelo allow_url_fopen — e responde 204 antes deles.
 */
describe.skipIf(!PHP).each([
  ["com cURL", [] as string[], "cURL"],
  ["sem cURL (allow_url_fopen)", ["-d", "disable_functions=curl_init"], "allow_url_fopen"],
])("eventos.php enviando de verdade %s", (_, extraArgs, sender) => {
  const UPSTREAM_DELAY_MS = 1500;
  let dir: string;
  let php: ChildProcess | null = null;
  let origin: string;
  const hits: VendorHit[] = [];
  const vendors = createHttpServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => {
      raw += c.toString("utf8");
    });
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(raw);
      } catch {
        body = { invalido: raw };
      }
      hits.push({ url: req.url ?? "", headers: req.headers, body });
      // Plataforma lenta: o visitante não pode esperar por ela.
      setTimeout(() => {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"error":{"message":"Invalid OAuth access token","fbtrace_id":"SEGREDO-DA-PLATAFORMA"}}');
      }, UPSTREAM_DELAY_MS);
    });
  });

  beforeAll(async () => {
    await new Promise<void>((r) => vendors.listen(0, "127.0.0.1", () => r()));
    const vendorBase = `http://127.0.0.1:${(vendors.address() as { port: number }).port}`;
    const code = eventosPhp()
      .replace("'https://graph.facebook.com/v21.0/'", `'${vendorBase}/meta/'`)
      .replace(`'${TIKTOK_EVENTS_URL}'`, `'${vendorBase}/tiktok/'`);
    if (!code.includes(`${vendorBase}/meta/`) || !code.includes(`${vendorBase}/tiktok/`)) {
      throw new Error("endereços das plataformas não encontrados no eventos.php");
    }
    dir = await mkdtemp(path.join(os.tmpdir(), "os-eventos-envio-"));
    await writeSite(dir, code);
    ({ server: php, origin } = await startPhp(dir, extraArgs));
  }, 60_000);

  afterAll(async () => {
    php?.kill();
    await new Promise<void>((r) => vendors.close(() => r()));
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("mostra como envia; responde 204 na hora e os pedidos chegam às duas plataformas", async () => {
    expect(await (await fetch(`${origin}/eventos.php`)).text()).toContain(`envio: ${sender}`);
    hits.length = 0;
    const now = Math.floor(Date.now() / 1000);
    const started = Date.now();
    const res = await fetch(`${origin}/eventos.php`, {
      method: "POST",
      headers: {
        "content-type": "text/plain;charset=UTF-8",
        origin,
        "user-agent": "Mozilla/5.0 Teste",
        "x-forwarded-for": "200.150.10.20",
      },
      body: JSON.stringify({
        event: "INITIATE_CHECKOUT",
        event_name: { META: "InitiateCheckout", TIKTOK: "InitiateCheckout" },
        event_id: "ic-real-1",
        event_time: now,
        event_source_url: `${origin}/oferta-b/?utm_source=facebook`,
        value: 197,
        currency: "BRL",
        fbp: "fb.1.1727650000000.1234567890",
        ttclid: "tt-1",
      }),
    });
    expect(res.status).toBe(204);
    // Nada da resposta das plataformas (erro, fbtrace_id) volta para a página.
    expect(await res.text()).toBe("");
    expect(Date.now() - started).toBeLessThan(UPSTREAM_DELAY_MS);

    await expect.poll(() => hits.length, { timeout: 15_000 }).toBe(2);
    const meta = hits.find((h) => h.url === `/meta/${META_PIXEL}/events`);
    const tiktok = hits.find((h) => h.url === "/tiktok/");
    expect(meta?.headers["content-type"]).toBe("application/json");
    expect(meta?.body).toMatchObject({
      access_token: META_TOKEN,
      test_event_code: "TEST123",
      data: [
        {
          event_name: "InitiateCheckout",
          event_id: "ic-real-1",
          event_time: now,
          action_source: "website",
          event_source_url: `${origin}/oferta-b/?utm_source=facebook`,
          user_data: {
            client_ip_address: "127.0.0.1",
            client_user_agent: "Mozilla/5.0 Teste",
            fbp: "fb.1.1727650000000.1234567890",
          },
          custom_data: { value: 197, currency: "BRL" },
        },
      ],
    });
    expect(tiktok?.headers["access-token"]).toBe(TIKTOK_TOKEN);
    expect(tiktok?.body).toMatchObject({
      event_source: "web",
      event_source_id: TIKTOK_PIXEL,
      data: [{ event: "InitiateCheckout", event_id: "ic-real-1", user: { ttclid: "tt-1", ip: "127.0.0.1" } }],
    });
    // O token do TikTok vai só no cabeçalho, nunca no corpo.
    expect(JSON.stringify(tiktok?.body)).not.toContain(TIKTOK_TOKEN);
  }, 30_000);
});
