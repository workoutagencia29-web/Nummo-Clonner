import { format, formatDistanceToNowStrict } from "date-fns";
import { ptBR } from "date-fns/locale";

/** "há 3 horas", "há 2 dias"; menos de um minuto: "agora mesmo" (nunca "há 0 segundos"). */
export function timeAgo(date: Date | string) {
  const d = new Date(date);
  if (Math.abs(Date.now() - d.getTime()) < 60_000) return "agora mesmo";
  return `há ${formatDistanceToNowStrict(d, { locale: ptBR })}`;
}

/** "28/09/2026 às 21:40". */
export function dateTime(date: Date | string) {
  return format(new Date(date), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

export function plural(n: number, singular: string, pluralForm: string) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}

/** Tamanho em português: "850 KB", "2,4 MB" (ZIP, revisão da clonagem, importação). */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const kb = bytes / 1024;
  if (kb < 1000) return `${Math.round(kb)} KB`;
  const oneDecimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
  const mb = kb / 1024;
  if (mb < 1000) return `${oneDecimal.format(mb)} MB`;
  return `${oneDecimal.format(mb / 1024)} GB`;
}
