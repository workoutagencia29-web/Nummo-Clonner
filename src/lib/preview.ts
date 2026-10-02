/**
 * Links de prévia. Cada prévia roda numa origem própria
 * (http://<token>.localhost:<PREVIEW_PORT>), separada do painel: scripts das
 * páginas clonadas não enxergam os cookies nem as telas do Offer Studio.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const PreviewTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("clone"),
    jobId: z.string(),
    device: z.enum(["desktop", "mobile"]),
    mode: z.enum(["EDITABLE", "PRESERVE_JS"]),
  }),
  z.object({ kind: z.literal("document"), documentId: z.string() }),
  /** Páginas salvas de uma oferta (navega entre as páginas do funil). */
  z.object({
    kind: z.literal("offer"),
    offerId: z.string(),
    pageId: z.string().optional(),
    variantId: z.string().optional(),
  }),
]);
export type PreviewTarget = z.infer<typeof PreviewTargetSchema>;

const TOKEN_RE = /^[a-z2-7]{26}$/;

export function previewPort() {
  return Number(process.env.PREVIEW_PORT || 3001);
}

export function previewUrl(token: string, path = "/") {
  return `http://${token}.localhost:${previewPort()}${path}`;
}

/** Origem (esquema + host curinga + porta) usada na CSP do painel. */
export function previewOriginPattern() {
  return `http://*.localhost:${previewPort()}`;
}

/** Token em base32 minúsculo (válido como rótulo de DNS). */
function newToken() {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes = randomBytes(26);
  let out = "";
  for (const b of bytes) out += alphabet[b % 32];
  return out;
}

export async function createPreviewToken(target: PreviewTarget, ttlHours = 12) {
  const id = newToken();
  await prisma.previewToken.create({
    data: { id, target, expiresAt: new Date(Date.now() + ttlHours * 3600_000) },
  });
  // Limpeza oportunista de tokens vencidos.
  void prisma.previewToken.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
  return id;
}

export async function resolvePreviewToken(id: string): Promise<PreviewTarget | null> {
  if (!TOKEN_RE.test(id)) return null;
  const row = await prisma.previewToken.findUnique({ where: { id } });
  if (!row || row.expiresAt < new Date()) return null;
  const parsed = PreviewTargetSchema.safeParse(row.target);
  return parsed.success ? parsed.data : null;
}
