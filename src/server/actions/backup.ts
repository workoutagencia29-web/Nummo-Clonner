"use server";

import { z } from "zod";
import { toUserMessage, UserError } from "@/lib/errors";
import { type ActionResult, protectedAction } from "@/server/action";
import {
  BackupSettingsPatchSchema,
  cancelRestore,
  deleteBackupFile,
  downloadFirstRunBackup,
  firstRunBackups,
  getBackupJob,
  getBackupOverview,
  getRestoreJob,
  inspectBackupFile,
  isBrandNewInstall,
  listBackups,
  revealBackupFile,
  saveBackupSettings,
  startManualBackup,
  startRestore,
} from "@/server/services/backup";

const id = z.string().min(1, "Pedido inválido.").max(40, "Pedido inválido.");
const filePath = z.string().trim().min(1, "Informe o caminho do arquivo de backup.").max(1024, "Caminho longo demais.");
/** Identifica o backup que você conferiu (SHA-256 do manifest). */
const fingerprint = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Pedido inválido.")
  .optional();
const confirmation = z
  .string()
  .trim()
  .refine((v) => v.toUpperCase() === "RESTAURAR", "Digite RESTAURAR para confirmar.");

/**
 * Ação sem login: só para a tela de entrada (primeiro acesso de uma instalação
 * nova e o andamento de uma restauração, quando as sessões já foram encerradas).
 * Mesmas regras de validação e tradução de erros das protegidas.
 */
function publicAction<S extends z.ZodType, T>(
  schema: S,
  handler: (input: z.output<S>) => Promise<T>,
): (input: z.input<S>) => Promise<ActionResult<T>> {
  return async (input) => {
    try {
      return { ok: true, data: await handler(schema.parse(input)) };
    } catch (err) {
      const info = toUserMessage(err);
      if (info.message.startsWith("Algo deu errado")) console.error("[action]", err);
      return { ok: false, error: info.message, field: info.field };
    }
  };
}

const NOT_NEW_INSTALL =
  "Este Offer Studio já tem uma conta ou ofertas. Entre e restaure o backup em Configurações → Backup.";

async function requireBrandNewInstall() {
  if (!(await isBrandNewInstall())) throw new UserError(NOT_NEW_INSTALL);
}

// ─── Configurações → Backup (com login) ──────────────────────────────────────

/** Situação do backup (último, próximo, em andamento, saúde). */
export const backupOverviewAction = protectedAction(z.object({}).prefault({}), () => getBackupOverview());

/** Backups encontrados na pasta configurada. */
export const listBackupsAction = protectedAction(z.object({}).prefault({}), () => listBackups());

/** "Fazer backup agora" (o worker faz; acompanhe com backupJobAction). */
export const startBackupAction = protectedAction(z.object({}).prefault({}), () => startManualBackup());

/** Andamento de um backup. */
export const backupJobAction = protectedAction(z.object({ id }), async ({ id }) => {
  const job = await getBackupJob(id);
  if (!job) throw new UserError("Backup não encontrado.");
  return job;
});

/** Salva pasta, automático, horário e quantos guardar (só os campos enviados). */
export const saveBackupSettingsAction = protectedAction(BackupSettingsPatchSchema, (patch) =>
  saveBackupSettings(patch),
);

/** Lê um backup para a confirmação da restauração. */
export const inspectBackupAction = protectedAction(z.object({ path: filePath }), ({ path }) => inspectBackupFile(path));

/** Restaura um backup (com a confirmação digitada). */
export const startRestoreAction = protectedAction(
  z.object({ path: filePath, confirm: confirmation, fingerprint }),
  ({ path, fingerprint }) => startRestore(path, fingerprint),
);

/** Apaga um backup da pasta (só arquivos da lista). */
export const deleteBackupFileAction = protectedAction(z.object({ path: filePath }), async ({ path }) => {
  await deleteBackupFile(path);
});

/** Mostra o arquivo no Finder (só arquivos da lista). */
export const revealBackupFileAction = protectedAction(z.object({ path: filePath }), async ({ path }) => {
  await revealBackupFile(path);
});

// ─── Tela de entrada (sem login) ─────────────────────────────────────────────

/** Andamento de uma restauração (sem dados pessoais: vale sem login). */
export const restoreStatusAction = publicAction(z.object({ id }), async ({ id }) => {
  const job = await getRestoreJob(id);
  if (!job) throw new UserError("Restauração não encontrada.");
  return job;
});

/** Desiste de uma restauração que ainda não começou. */
export const cancelRestoreAction = publicAction(z.object({ id }), async ({ id }) => {
  await cancelRestore(id);
});

/** Primeiro acesso: backups encontrados nas pastas sugeridas. */
export const firstRunBackupsAction = publicAction(z.object({}).prefault({}), async () => {
  await requireBrandNewInstall();
  return firstRunBackups();
});

/**
 * Primeiro acesso: traz da iCloud Drive um backup da lista que está só na nuvem
 * (espera um pouco; ready = false enquanto ainda baixa).
 */
export const downloadFirstRunBackupAction = publicAction(z.object({ path: filePath }), async ({ path }) => {
  await requireBrandNewInstall();
  return downloadFirstRunBackup(path);
});

/** Primeiro acesso: lê um backup para a confirmação. */
export const inspectFirstRunBackupAction = publicAction(z.object({ path: filePath }), async ({ path }) => {
  await requireBrandNewInstall();
  return inspectBackupFile(path);
});

/** Primeiro acesso: restaura um backup numa instalação nova (sem conta e sem ofertas). */
export const startFirstRunRestoreAction = publicAction(
  z.object({ path: filePath, confirm: confirmation, fingerprint }),
  async ({ path, fingerprint }) => {
    await requireBrandNewInstall();
    return startRestore(path, fingerprint);
  },
);
