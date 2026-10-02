import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { deleteObject, storagePath } from "@/lib/storage";
import { startZipClone } from "@/server/services/clone";

export const dynamic = "force-dynamic";

const MAX_BYTES = 200 * 1024 * 1024;

/**
 * Recebe um ZIP (corpo cru da requisição, sem multipart) e cria a clonagem.
 * Cabeçalhos: X-File-Name (nome original), X-Devices ("desktop,mobile").
 */
export async function POST(req: Request) {
  const port = process.env.PORT || "3000";
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (host !== `localhost:${port}` && host !== `127.0.0.1:${port}`) {
    return Response.json({ error: "Endereço não permitido." }, { status: 403 });
  }
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Faça login de novo." }, { status: 401 });
  if (!req.body) return Response.json({ error: "Envie um arquivo .zip." }, { status: 400 });

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return Response.json({ error: "O ZIP pode ter no máximo 200 MB." }, { status: 413 });

  const fileName = decodeURIComponent(req.headers.get("x-file-name") ?? "pagina.zip").slice(0, 300);
  if (!/\.zip$/i.test(fileName)) return Response.json({ error: "Envie um arquivo .zip." }, { status: 400 });
  const devices = (req.headers.get("x-devices") ?? "desktop,mobile")
    .split(",")
    .filter((d): d is "desktop" | "mobile" => d === "desktop" || d === "mobile");

  const key = `uploads/${randomUUID()}.zip`;
  const tmpDir = path.join(env.dataDir, "tmp");
  await mkdir(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `${randomUUID()}.zip.part`);
  let received = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length;
      if (received > MAX_BYTES) cb(new Error("LIMITE"));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(req.body as import("node:stream/web").ReadableStream),
      limiter,
      createWriteStream(tmp),
    );
    const dest = storagePath(key);
    await mkdir(path.dirname(dest), { recursive: true });
    await rename(tmp, dest);
  } catch (err) {
    await rm(tmp, { force: true });
    const tooBig = err instanceof Error && err.message === "LIMITE";
    return Response.json(
      { error: tooBig ? "O ZIP pode ter no máximo 200 MB." : "O envio foi interrompido. Tente de novo." },
      { status: tooBig ? 413 : 400 },
    );
  }

  try {
    const job = await startZipClone(key, fileName, {
      devices: devices.length ? devices : ["desktop", "mobile"],
      maxVideoMb: 200,
    });
    return Response.json({ id: job.id });
  } catch (err) {
    // Sem clonagem, o arquivo enviado não serve para nada: não deixa sobrar no disco.
    await deleteObject(key).catch(() => {});
    console.error("[clone/zip]", err);
    return Response.json({ error: "Não foi possível começar a importação. Tente de novo." }, { status: 500 });
  }
}
