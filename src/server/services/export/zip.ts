/**
 * Escrita do ZIP em fluxo (yazl), determinística: entradas em ordem
 * alfabética, mesma data e mesmas permissões em todas. Arquivos grandes
 * (vídeos) vão direto do disco, sem passar inteiros pela memória. Grava num
 * temporário ao lado e renomeia no fim (nunca fica um ZIP pela metade).
 */
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { brokenZipPath, isPrecompressed } from "@/lib/export/paths";

export type ZipEntry = { path: string; data: Buffer } | { path: string; file: string; size: number };

export interface WriteZipOptions {
  /** Data gravada em todas as entradas (determinística). */
  mtime: Date;
  /** Andamento: bytes do ZIP já gravados e o total esperado (aproximado). */
  onBytes?: (written: number, expected: number) => void;
}

/** Data com resolução de 2 s (a do formato ZIP), para o mesmo ZIP sair igual. */
export function zipDate(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 2000) * 2000);
}

/** Grava as entradas (ordenadas por caminho) em `target`. Devolve o tamanho final. */
export async function writeZip(entries: ZipEntry[], target: string, opts: WriteZipOptions): Promise<number> {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  // Última defesa: um ZIP com a mesma entrada duas vezes (inclusive em outra
  // caixa) ou com um arquivo no lugar de uma pasta não abre no Mac/Windows.
  const broken = brokenZipPath(sorted.map((e) => e.path));
  if (broken) throw new Error(`Entrada repetida ou em conflito no ZIP: ${broken}`);
  const zip = new ZipFile();
  const mtime = zipDate(opts.mtime);
  let expected = 0;
  for (const entry of sorted) {
    const options = { mtime, mode: 0o100644, compress: !isPrecompressed(entry.path) };
    if ("data" in entry) {
      zip.addBuffer(entry.data, entry.path, options);
      expected += entry.data.byteLength;
    } else {
      zip.addFile(entry.file, entry.path, options);
      expected += entry.size;
    }
  }
  zip.end();

  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${randomUUID()}.tmp`;
  let written = 0;
  if (opts.onBytes) {
    zip.outputStream.on("data", (chunk: Buffer) => {
      written += chunk.length;
      opts.onBytes?.(written, expected);
    });
  }
  try {
    await pipeline(zip.outputStream, createWriteStream(tmp));
    await rename(tmp, target);
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
  return (await stat(target)).size;
}
