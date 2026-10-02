/**
 * Quando fazer o backup automático (regras puras, testadas sem banco).
 *
 * - Todo dia no horário escolhido, enquanto o Offer Studio está aberto (com o
 *   Mac dormindo no horário, roda ao acordar).
 * - Ao abrir o Offer Studio (depois de uma espera curta) — ou a qualquer
 *   momento com ele aberto —, se o último backup automático que deu certo tem
 *   mais de 24 h (ou nunca houve um): uma tentativa por abertura.
 * - Se essa tentativa falhou e o backup continua atrasado, tenta de novo a
 *   cada hora.
 */
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
/** Espera depois de abrir o Offer Studio antes do backup de recuperação. */
export const STARTUP_DELAY_MS = 90_000;
/** Nova tentativa depois de um automático que falhou. */
export const RETRY_MS = HOUR_MS;
/** Um automático feito há menos que isso antes do horário dispensa o do horário. */
export const SLOT_SKIP_MS = 6 * HOUR_MS;
/** Atrasado: sem backup automático há mais que isso. */
export const OVERDUE_MS = DAY_MS;
/** Na saúde do backup, "atrasado" a partir daqui. */
export const STALE_MS = 2 * DAY_MS;

export interface AutoBackupInput {
  now: Date;
  auto: boolean;
  /** Hora do dia (0–23, hora local). */
  hour: number;
  /** Quando o worker começou a rodar. */
  workerStartedAt: Date;
  /** Último backup automático que deu certo. */
  lastSuccessAt: Date | null;
  /** Última tentativa de backup automático (deu certo ou não). */
  lastAttemptAt: Date | null;
  lastAttemptFailed: boolean;
}

export type AutoBackupReason = "slot" | "overdue" | "retry";

/** Horário de hoje (ou de ontem, se ainda não chegou) — o último horário que já passou. */
export function lastSlot(now: Date, hour: number): Date {
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
  if (slot.getTime() > now.getTime()) slot.setDate(slot.getDate() - 1);
  return slot;
}

/** Próximo horário depois de `now`. */
export function nextSlot(now: Date, hour: number): Date {
  const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0, 0);
  if (slot.getTime() <= now.getTime()) slot.setDate(slot.getDate() + 1);
  return slot;
}

/** Diz se é hora de um backup automático (e por quê); null = ainda não. */
export function autoBackupDue(s: AutoBackupInput): AutoBackupReason | null {
  if (!s.auto) return null;
  const now = s.now.getTime();
  if (now - s.workerStartedAt.getTime() < STARTUP_DELAY_MS) return null;
  const lastSuccess = s.lastSuccessAt?.getTime() ?? null;
  const lastAttempt = s.lastAttemptAt?.getTime() ?? null;

  // Horário do dia que passou com o Offer Studio aberto e sem tentativa desde então.
  const slot = lastSlot(s.now, s.hour).getTime();
  if (
    slot > s.workerStartedAt.getTime() &&
    (lastAttempt === null || lastAttempt < slot) &&
    (lastSuccess === null || slot - lastSuccess >= SLOT_SKIP_MS)
  ) {
    return "slot";
  }

  const overdue = lastSuccess === null || now - lastSuccess > OVERDUE_MS;
  if (!overdue) return null;
  // Atrasado (ao abrir ou com o app aberto): uma tentativa por abertura.
  if (lastAttempt === null || lastAttempt < s.workerStartedAt.getTime()) return "overdue";
  // Falhou e continua atrasado: de hora em hora.
  if (s.lastAttemptFailed && now - lastAttempt >= RETRY_MS) return "retry";
  return null;
}

/** Próximo backup automático previsto (para mostrar); null = desligado. */
export function nextAutoBackupAt(s: { now: Date; auto: boolean; hour: number }): Date | null {
  if (!s.auto) return null;
  return nextSlot(s.now, s.hour);
}

export type BackupHealthLevel = "ok" | "warn" | "error" | "running";

export interface BackupHealth {
  level: BackupHealthLevel;
  title: string;
  detail: string;
}

export interface BackupHealthInput {
  now: Date;
  auto: boolean;
  running: boolean;
  /** Último backup que deu certo (qualquer tipo). */
  lastSuccessAt: Date | null;
  /** Última falha (qualquer tipo), com a mensagem. */
  lastFailure: { at: Date; message: string } | null;
  /** Pasta que não dá para usar (iCloud desligada…). */
  folderProblem: string | null;
  /** Aviso importante do último backup que deu certo (arquivos estragados que ficaram de fora). */
  lastWarning?: string | null;
}

/** Saúde do backup para o card "Sistema" e o topo do card "Backup". */
export function backupHealth(s: BackupHealthInput, describeAgo: (d: Date) => string): BackupHealth {
  if (s.running)
    return { level: "running", title: "Fazendo backup agora", detail: "Pode continuar usando o Offer Studio." };
  const last = s.lastSuccessAt;
  const failedAfter = s.lastFailure && (!last || s.lastFailure.at.getTime() > last.getTime());
  if (s.folderProblem) return { level: "error", title: "Pasta de backup indisponível", detail: s.folderProblem };
  if (failedAfter && s.lastFailure) {
    return { level: "error", title: "O último backup falhou", detail: s.lastFailure.message };
  }
  if (!last) {
    return s.auto
      ? {
          level: "warn",
          title: "Nenhum backup ainda",
          detail:
            "O primeiro backup automático acontece logo depois de abrir o Offer Studio. Ou clique em “Fazer backup agora”.",
        }
      : { level: "error", title: "Nenhum backup", detail: "O backup automático está desligado. Faça um backup agora." };
  }
  const age = s.now.getTime() - last.getTime();
  // O aviso de arquivos estragados se repete em todo backup até uma restauração
  // consertar: não pode esconder "desligado" nem "atrasado" (vai junto no detalhe).
  const warning = s.lastWarning ? ` ${s.lastWarning}` : "";
  if (!s.auto) {
    return {
      level: "warn",
      title: "Backup automático desligado",
      detail: `Último backup ${describeAgo(last)}. Ligue o automático para não depender de lembrar.${warning}`,
    };
  }
  if (age > STALE_MS) {
    return {
      level: "warn",
      title: "Backup atrasado",
      detail: `Último backup ${describeAgo(last)}. O backup automático só roda com o Offer Studio aberto.${warning}`,
    };
  }
  if (s.lastWarning) {
    return {
      level: "warn",
      title: "Último backup com arquivos estragados",
      detail: `Último backup ${describeAgo(last)}. ${s.lastWarning}`,
    };
  }
  return { level: "ok", title: "Backup em dia", detail: `Último backup ${describeAgo(last)}.` };
}
