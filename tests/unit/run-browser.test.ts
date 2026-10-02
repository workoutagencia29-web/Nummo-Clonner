/** O atalho abre o painel num navegador que abre a prévia (*.localhost): o Safari não abre. */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { preferredBrowser } from "../../scripts/run";

const dir = mkdtempSync(path.join(os.tmpdir(), "os-apps-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("prefere o primeiro navegador instalado da lista; sem nenhum, volta null (padrão do Mac)", () => {
  expect(preferredBrowser(["Google Chrome", "Firefox"], [dir])).toBeNull();
  mkdirSync(path.join(dir, "Firefox.app"));
  expect(preferredBrowser(["Google Chrome", "Firefox"], [dir])).toBe("Firefox");
  mkdirSync(path.join(dir, "Google Chrome.app"));
  expect(preferredBrowser(["Google Chrome", "Firefox"], [dir])).toBe("Google Chrome");
});
