/**
 * Textos e contas da tela de backup (puros, testados sem navegador).
 */
import { addDays, format, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";

export type BackupKind = "AUTO" | "MANUAL" | "SAFETY";

export const KIND_LABEL: Record<BackupKind, string> = {
  AUTO: "Automático",
  MANUAL: "Manual",
  SAFETY: "Antes de restaurar",
};

export function kindLabel(kind: BackupKind | null): string {
  return kind ? KIND_LABEL[kind] : "—";
}

const MB = 1024 * 1024;

/** "350 KB", "12,4 MB", "1,2 GB". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(1).replace(".", ",")} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "hoje às 03:00", "ontem às 15:20", "amanhã às 03:00", "28/09/2026 às 03:00". */
export function friendlyDate(date: Date | string, now = new Date()): string {
  const d = new Date(date);
  const time = format(d, "HH:mm", { locale: ptBR });
  const sameYear = d.getFullYear() === now.getFullYear();
  if (isSameDay(d, now)) return `hoje às ${time}`;
  if (isSameDay(d, addDays(now, -1))) return `ontem às ${time}`;
  if (isSameDay(d, addDays(now, 1))) return `amanhã às ${time}`;
  return `${format(d, sameYear ? "dd/MM" : "dd/MM/yyyy", { locale: ptBR })} às ${time}`;
}

/** "03:00" */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Opções de "Guardar os N backups automáticos mais novos" (o valor salvo entra se for outro). */
export const KEEP_CHOICES = [3, 5, 7, 10, 14, 20, 30];

export function keepChoices(current: number): number[] {
  return [...new Set([...KEEP_CHOICES, current])].sort((a, b) => a - b);
}

export function offersLabel(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${n} ${n === 1 ? "oferta" : "ofertas"}`;
}

/** Próximo automático em palavras. */
export function nextAutoLabel(opts: { auto: boolean; nextAutoAt: string | null; autoSoon: boolean }, now = new Date()) {
  if (!opts.auto) return "Desligado";
  if (opts.autoSoon) return "Em instantes";
  return opts.nextAutoAt ? friendlyDate(opts.nextAutoAt, now) : "—";
}

export const CONFIRM_WORD = "RESTAURAR";

export function isConfirmed(text: string): boolean {
  return text.trim().toUpperCase() === CONFIRM_WORD;
}

export function isFinished(status: string): boolean {
  return status === "DONE" || status === "FAILED";
}
