/**
 * Tela "Testar pixels": validação do que a página em modo teste manda ao
 * servidor de prévia (PixelTestReport) e o resumo mostrado no painel.
 */
import { z } from "zod";
import { PIXEL_TEST_LOAD_EVENT, type PixelTestReport } from "./runtime-config";
import { PIXEL_VENDORS, type PixelVendorId } from "./schema";

export const PIXEL_TEST_TOKEN_RE = /^[a-z2-7]{26}$/;
export const PIXEL_TEST_SOURCES = [...PIXEL_VENDORS, "CONSENT", "RUNTIME"] as const;
export const PIXEL_TEST_STATUSES = ["LOADED", "FIRED", "BLOCKED", "ERROR"] as const;
export type PixelTestSource = (typeof PIXEL_TEST_SOURCES)[number];
export type PixelTestStatusId = (typeof PIXEL_TEST_STATUSES)[number];

const detailValue = z.union([z.string().max(300), z.number().finite(), z.boolean(), z.null()]);

export const PixelTestReportSchema = z.strictObject({
  token: z.string().regex(PIXEL_TEST_TOKEN_RE),
  vendor: z.enum(PIXEL_TEST_SOURCES),
  event: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[\p{L}\p{N} _.:/()-]+$/u),
  status: z.enum(PIXEL_TEST_STATUSES),
  detail: z
    .record(
      z
        .string()
        .min(1)
        .max(40)
        .regex(/^[A-Za-z0-9_.-]+$/),
      detailValue,
    )
    .refine((d) => Object.keys(d).length <= 20)
    .optional(),
}) satisfies z.ZodType<PixelTestReport>;

/** Valida um relatório vindo da página (JSON já lido). null = formato inválido. */
export function parsePixelTestReport(value: unknown): PixelTestReport | null {
  const parsed = PixelTestReportSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Linha da tela de teste (PixelTestEvent). */
export interface PixelTestEventRow {
  id: number;
  at: Date | string;
  vendor: string;
  event: string;
  status: PixelTestStatusId;
  detail: unknown;
}

export interface PixelTestVendorSummary {
  vendor: PixelVendorId;
  /** Situação do carregamento do pixel (o pior passo recebido manda). */
  state: "WAITING" | "LOADED" | "BLOCKED" | "ERROR";
  /** Eventos disparados (nome como a plataforma recebeu) e quantas vezes. */
  fired: { event: string; count: number }[];
  /** Eventos bloqueados/com erro (ex.: bloqueador de anúncios). */
  failed: { event: string; status: "BLOCKED" | "ERROR"; count: number }[];
}

/**
 * Passo de carregamento que não é o do pixel: o script de UTMs da UTMify
 * (detail.script = "utms") ou um segundo pixel da UTMify que não carrega
 * (detail.extra). Conta como falha à parte, sem mudar a situação do pixel.
 */
function sideLoad(e: PixelTestEventRow): boolean {
  const d = e.detail;
  return (
    e.event === PIXEL_TEST_LOAD_EVENT &&
    typeof d === "object" &&
    d !== null &&
    ((d as Record<string, unknown>).script === "utms" || (d as Record<string, unknown>).extra === true)
  );
}

/**
 * Resumo por plataforma dos passos recebidos, na ordem das plataformas
 * cadastradas na oferta. Plataformas sem nenhum passo ficam "Aguardando".
 */
export function summarizePixelTest(events: PixelTestEventRow[], vendors: PixelVendorId[]): PixelTestVendorSummary[] {
  const order = [...new Set(vendors)];
  const byVendor = new Map<PixelVendorId, PixelTestVendorSummary>(
    order.map((vendor) => [vendor, { vendor, state: "WAITING", fired: [], failed: [] }]),
  );
  const rank = { WAITING: 0, LOADED: 1, BLOCKED: 2, ERROR: 3 } as const;
  for (const e of events) {
    const summary = byVendor.get(e.vendor as PixelVendorId);
    if (!summary) continue;
    if (e.status === "FIRED") {
      const hit = summary.fired.find((f) => f.event === e.event);
      if (hit) hit.count++;
      else summary.fired.push({ event: e.event, count: 1 });
      if (summary.state === "WAITING") summary.state = "LOADED";
      continue;
    }
    if (e.status === "LOADED") {
      if (rank[summary.state] < rank.LOADED && !sideLoad(e)) summary.state = "LOADED";
      continue;
    }
    const status = e.status;
    // Falha no carregamento do pixel vs. falha num evento específico (ou no script de UTMs).
    if (e.event === PIXEL_TEST_LOAD_EVENT && !sideLoad(e)) {
      if (rank[summary.state] < rank[status]) summary.state = status;
    } else {
      const hit = summary.failed.find((f) => f.event === e.event && f.status === status);
      if (hit) hit.count++;
      else summary.failed.push({ event: e.event, status, count: 1 });
    }
  }
  return order.map((v) => byVendor.get(v) as PixelTestVendorSummary);
}
