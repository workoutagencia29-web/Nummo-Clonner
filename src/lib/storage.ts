/**
 * Armazenamento de arquivos em disco local (<DATA_DIR>/storage).
 *
 * As chaves são caminhos relativos com "/" (ex.: "a/3f/3f9c…e1.webp"). Arquivos
 * enviados ou baixados são endereçados pelo hash SHA-256 do conteúdo, então o
 * mesmo arquivo nunca ocupa espaço duas vezes.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { env } from "@/lib/env";

// turbopackIgnore: o rastreamento de arquivos do build não deve varrer os dados do usuário.
const ROOT = path.join(/* turbopackIgnore: true */ env.dataDir, "storage");

/** Resolve uma chave para o caminho no disco, bloqueando "../" e afins. */
export function storagePath(key: string) {
  if (
    !key ||
    key.includes("\0") ||
    key.startsWith("/") ||
    key.split("/").some((p) => p === ".." || p === "." || p === "")
  ) {
    throw new Error(`Chave de storage inválida: ${key}`);
  }
  const full = path.resolve(/* turbopackIgnore: true */ ROOT, key);
  if (!full.startsWith(`${ROOT}${path.sep}`)) throw new Error(`Chave de storage inválida: ${key}`);
  return full;
}

/** Grava de forma atômica (arquivo temporário + rename). */
export async function putObject(key: string, data: Uint8Array | string) {
  const full = storagePath(key);
  await mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.${randomUUID()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, full);
}

export async function getObject(key: string) {
  return readFile(storagePath(key));
}

export function objectStream(key: string) {
  return createReadStream(storagePath(key));
}

export async function objectInfo(key: string) {
  try {
    const s = await stat(storagePath(key));
    if (!s.isFile()) return null;
    return { size: s.size, modifiedAt: s.mtime };
  } catch {
    return null;
  }
}

export function objectExists(key: string) {
  return existsSync(storagePath(key));
}

export async function deleteObject(key: string) {
  await rm(storagePath(key), { force: true });
}

export function sha256(data: Uint8Array | string) {
  return createHash("sha256").update(data).digest("hex");
}

/** Grava pelo hash do conteúdo e devolve a chave ("a/ab/abcdef….ext"). */
export async function putContentAddressed(data: Uint8Array, ext: string) {
  const hash = sha256(data);
  const cleanExt =
    ext
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase()
      .slice(0, 8) || "bin";
  const key = `a/${hash.slice(0, 2)}/${hash}.${cleanExt}`;
  if (!objectExists(key)) await putObject(key, data);
  return { key, sha256: hash, bytes: data.byteLength };
}

/**
 * Move um arquivo temporário (já baixado em disco) para o endereço pelo hash,
 * calculando o SHA-256 em streaming. Se o arquivo já existe, só apaga o temporário.
 */
export async function putFileContentAddressed(tmpPath: string, ext: string) {
  const hasher = createHash("sha256");
  let bytes = 0;
  await pipeline(createReadStream(tmpPath), async (source: AsyncIterable<Buffer>) => {
    for await (const chunk of source) {
      bytes += chunk.length;
      hasher.update(chunk);
    }
  });
  const hash = hasher.digest("hex");
  const cleanExt =
    ext
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase()
      .slice(0, 8) || "bin";
  const key = `a/${hash.slice(0, 2)}/${hash}.${cleanExt}`;
  const full = storagePath(key);
  if (existsSync(full)) {
    await rm(tmpPath, { force: true });
    return { key, sha256: hash, bytes };
  }
  await mkdir(path.dirname(full), { recursive: true });
  try {
    await rename(tmpPath, full);
  } catch (err) {
    // Outro disco/volume (EXDEV): copia para um temporário ao lado e renomeia.
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    const staging = `${full}.${randomUUID()}.tmp`;
    await copyFile(tmpPath, staging);
    await rename(staging, full);
    await rm(tmpPath, { force: true });
  }
  return { key, sha256: hash, bytes };
}

const MIME_BY_EXT: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  pdf: "application/pdf",
  zip: "application/zip",
  gz: "application/gzip",
};

export function mimeFromKey(key: string) {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}
