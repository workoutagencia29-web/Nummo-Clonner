/**
 * O painel (Next) não pode importar o render das páginas: ele usa o esbuild
 * (src/lib/runtime-bundle.ts), e o build de produção ("npm run build") falha
 * com o esbuild no caminho — o tsc e os testes não pegam isso. Aconteceu com o
 * "Ver checkout" (a ação importava src/server/services/checkout/page.ts).
 * Este teste segue os imports das ações, telas e componentes e confere que
 * nenhum chega lá.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SRC = path.join(ROOT, "src");
const FORBIDDEN = path.join(SRC, "lib", "runtime-bundle.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Imports que entram no bundle (sem os `import type`/`export type`). */
function runtimeImports(file: string): string[] {
  const code = readFileSync(file, "utf8");
  const specs: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (!m[2]) specs.push(m[3]);
  }
  for (const m of code.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) specs.push(m[1]);
  return specs;
}

/** Caminho de imports de `entry` até o arquivo proibido (null = não chega). */
function pathToForbidden(entry: string): string[] | null {
  const prev = new Map<string, string | null>([[entry, null]]);
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift() as string;
    if (file === FORBIDDEN) {
      const chain: string[] = [];
      for (let f: string | null = file; f; f = prev.get(f) ?? null) chain.unshift(path.relative(ROOT, f));
      return chain;
    }
    for (const spec of runtimeImports(file)) {
      const next = resolveImport(file, spec);
      if (next && !prev.has(next)) {
        prev.set(next, file);
        queue.push(next);
      }
    }
  }
  return null;
}

describe("build do painel sem o esbuild", () => {
  it("ações, telas e componentes não importam o render das páginas", () => {
    const entries = [
      ...walk(path.join(SRC, "server", "actions")),
      ...walk(path.join(SRC, "app")),
      ...walk(path.join(SRC, "components")),
    ];
    const bad = entries.map(pathToForbidden).filter((chain): chain is string[] => chain !== null);
    expect(bad.map((chain) => chain.join(" → "))).toEqual([]);
  });
});
