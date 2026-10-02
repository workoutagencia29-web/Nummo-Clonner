import { gunzipSync, gzipSync } from "node:zlib";

/** Compacta o JSON do projeto do editor para gravar no banco/storage. */
export function packProject(data: unknown): Uint8Array<ArrayBuffer> {
  const buf = gzipSync(Buffer.from(JSON.stringify(data), "utf8"), { level: 6 });
  return new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
}

export function unpackProject<T = unknown>(bytes: Uint8Array): T {
  return JSON.parse(gunzipSync(bytes).toString("utf8")) as T;
}

/** Aplica uma transformação de texto dentro do projeto compactado. */
export function transformPackedProject(bytes: Uint8Array, fn: (json: string) => string): Uint8Array<ArrayBuffer> {
  const json = gunzipSync(bytes).toString("utf8");
  return packProject(JSON.parse(fn(json)));
}
