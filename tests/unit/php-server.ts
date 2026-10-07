/**
 * PHP de verdade para os testes do pagamento.php (como em export-php.test.ts):
 * o `php` do computador ou OS_PHP_BIN (PHP em WebAssembly, ver o comentário de
 * export-php.test.ts). Sem PHP, os testes que precisam dele são pulados.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";

/** `php` do computador (ou OS_PHP_BIN); null quando não tem. */
export function findPhp(): string | null {
  for (const bin of [process.env.OS_PHP_BIN, "php"]) {
    if (!bin) continue;
    const r = spawnSync(bin, ["-v"], { encoding: "utf8", timeout: 30_000 });
    if (r.status === 0 && /PHP \d/.test(r.stdout)) return bin;
  }
  return null;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

/** `php -S` servindo `dir` (como a hospedagem), já respondendo em `probe`. */
export async function startPhp(
  php: string,
  dir: string,
  probe: string,
  /** Roteador do `php -S` (caminho), quando o teste precisa (ex.: simular o IP da conexão). */
  router?: string,
): Promise<{ server: ChildProcess; origin: string }> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(php, ["-S", `127.0.0.1:${port}`, "-t", dir, ...(router ? [router] : [])], { stdio: "ignore" });
  for (let i = 0; i < 300; i++) {
    const ok = await fetch(`${origin}${probe}`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return { server, origin };
    await new Promise((r) => setTimeout(r, 100));
  }
  server.kill();
  throw new Error("php -S não respondeu");
}

/** pagamento.php apontando para a Kyvo falsa (e, se pedido, com outros limites). */
export function instrumentPagamento(code: string, apiBase: string, limits: Record<string, number> = {}): string {
  let out = code.replace("const OS_API = 'https://kyvopay.com/api';", `const OS_API = '${apiBase}';`);
  if (out === code) throw new Error("OS_API não encontrado no pagamento.php");
  for (const [name, value] of Object.entries(limits)) {
    const next = out.replace(new RegExp(`const ${name} = \\d+;`), `const ${name} = ${value};`);
    if (next === out) throw new Error(`${name} não encontrado no pagamento.php`);
    out = next;
  }
  return out;
}

/**
 * Roteador do `php -S` só dos testes: o IP da conexão (REMOTE_ADDR) vem do
 * cabeçalho X-Test-Remote, para simular compradores (e ataques) de vários IPs.
 */
export const TEST_REMOTE_ROUTER = `<?php
if (!empty($_SERVER['HTTP_X_TEST_REMOTE'])) {
    $_SERVER['REMOTE_ADDR'] = $_SERVER['HTTP_X_TEST_REMOTE'];
}
if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) === '/pagamento.php') {
    require __DIR__ . '/pagamento.php';
    return true;
}
return false;
`;
