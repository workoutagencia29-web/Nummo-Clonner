/**
 * Regras do backup automático (puras): horário do dia com o app aberto,
 * recuperação ao abrir (último automático com mais de 24 h), nova tentativa
 * depois de uma falha e a saúde mostrada em Configurações. Também os textos da
 * tela e o formato/compatibilidade do arquivo.
 */
import { describe, expect, it } from "vitest";
import { friendlyDate, isConfirmed, keepChoices, nextAutoLabel } from "@/app/(painel)/configuracoes/_backup/logic";
import {
  APP_BACKUP_NAME_RE,
  BACKUP_FILE_RE,
  backupFileName,
  compareVersions,
  compatibilityProblem,
  corruptFilesWarning,
  installTag,
  installTagOfName,
  isBackupStorageKey,
  NEWER_VERSION_MESSAGE,
} from "@/server/services/backup/format";
import {
  type AutoBackupInput,
  autoBackupDue,
  backupHealth,
  lastSlot,
  nextAutoBackupAt,
  nextSlot,
  RETRY_MS,
  STARTUP_DELAY_MS,
} from "@/server/services/backup/schedule";
import { dependencyOrder, type SchemaMeta } from "@/server/services/backup/tables";

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);

function input(over: Partial<AutoBackupInput>): AutoBackupInput {
  return {
    now: at(10, 12),
    auto: true,
    hour: 3,
    workerStartedAt: at(10, 8),
    lastSuccessAt: at(10, 3),
    lastAttemptAt: at(10, 3),
    lastAttemptFailed: false,
    ...over,
  };
}

describe("horários", () => {
  it("último e próximo horário", () => {
    expect(lastSlot(at(10, 12), 3)).toEqual(at(10, 3));
    expect(lastSlot(at(10, 2, 59), 3)).toEqual(at(9, 3));
    expect(lastSlot(at(10, 3), 3)).toEqual(at(10, 3));
    expect(nextSlot(at(10, 2, 59), 3)).toEqual(at(10, 3));
    expect(nextSlot(at(10, 3), 3)).toEqual(at(11, 3));
    expect(nextSlot(at(31, 23, 30), 3)).toEqual(new Date(2026, 10, 1, 3));
    expect(nextAutoBackupAt({ now: at(10, 12), auto: true, hour: 3 })).toEqual(at(11, 3));
    expect(nextAutoBackupAt({ now: at(10, 12), auto: false, hour: 3 })).toBeNull();
  });
});

describe("quando fazer o backup automático", () => {
  it("desligado: nunca", () => {
    expect(autoBackupDue(input({ auto: false, lastSuccessAt: null, lastAttemptAt: null }))).toBeNull();
  });

  it("no horário, com o Offer Studio aberto desde antes", () => {
    const base = { workerStartedAt: at(9, 20), lastSuccessAt: at(9, 3), lastAttemptAt: at(9, 3) };
    expect(autoBackupDue(input({ ...base, now: at(10, 2, 59) }))).toBeNull();
    expect(autoBackupDue(input({ ...base, now: at(10, 3, 0) }))).toBe("slot");
    // Mac dormindo às 3h: roda ao acordar.
    expect(autoBackupDue(input({ ...base, now: at(10, 8, 15) }))).toBe("slot");
    // Já feito depois do horário: não repete.
    expect(
      autoBackupDue(input({ ...base, now: at(10, 9), lastSuccessAt: at(10, 3, 1), lastAttemptAt: at(10, 3, 1) })),
    ).toBeNull();
  });

  it("horário que passou com o app fechado não conta; o backup volta quando completar 24 h", () => {
    // Abriu às 10h; o último foi ontem às 15h (19 h atrás): espera completar 24 h.
    const fresh = { workerStartedAt: at(10, 10), lastSuccessAt: at(9, 15), lastAttemptAt: at(9, 15) };
    expect(autoBackupDue(input({ ...fresh, now: at(10, 10, 5) }))).toBeNull();
    expect(autoBackupDue(input({ ...fresh, now: at(10, 14, 59) }))).toBeNull();
    expect(autoBackupDue(input({ ...fresh, now: at(10, 15, 1) }))).toBe("overdue");
    // Feito às 15h01: o próximo é o do horário de amanhã (12 h depois).
    const done = { workerStartedAt: at(10, 10), lastSuccessAt: at(10, 15, 1), lastAttemptAt: at(10, 15, 1) };
    expect(autoBackupDue(input({ ...done, now: at(10, 23) }))).toBeNull();
    expect(autoBackupDue(input({ ...done, now: at(11, 3) }))).toBe("slot");
  });

  it("ao abrir, se o último automático tem mais de 24 h, depois de uma espera curta", () => {
    const start = at(10, 10);
    const old = { workerStartedAt: start, lastSuccessAt: at(9, 3), lastAttemptAt: at(9, 3) };
    expect(autoBackupDue(input({ ...old, now: new Date(start.getTime() + STARTUP_DELAY_MS - 1000) }))).toBeNull();
    expect(autoBackupDue(input({ ...old, now: new Date(start.getTime() + STARTUP_DELAY_MS) }))).toBe("overdue");
    // Nunca houve backup: também.
    expect(
      autoBackupDue(input({ workerStartedAt: start, lastSuccessAt: null, lastAttemptAt: null, now: at(10, 10, 2) })),
    ).toBe("overdue");
    // Já tentou depois de abrir (deu certo): não repete.
    expect(
      autoBackupDue(
        input({ workerStartedAt: start, lastSuccessAt: at(10, 10, 2), lastAttemptAt: at(10, 10, 2), now: at(10, 12) }),
      ),
    ).toBeNull();
  });

  it("falhou e continua atrasado: tenta de novo a cada hora", () => {
    const start = at(10, 10);
    const failed = {
      workerStartedAt: start,
      lastSuccessAt: at(8, 3),
      lastAttemptAt: at(10, 10, 2),
      lastAttemptFailed: true,
    };
    expect(autoBackupDue(input({ ...failed, now: at(10, 10, 30) }))).toBeNull();
    expect(autoBackupDue(input({ ...failed, now: new Date(at(10, 10, 2).getTime() + RETRY_MS) }))).toBe("retry");
    // Falhou mas o último que deu certo é recente: espera o próximo horário.
    expect(autoBackupDue(input({ ...failed, lastSuccessAt: at(10, 3), now: at(10, 12) }))).toBeNull();
  });

  it("recuperação logo antes do horário dispensa o do horário", () => {
    const base = { workerStartedAt: at(10, 1), lastSuccessAt: at(10, 1, 2), lastAttemptAt: at(10, 1, 2) };
    expect(autoBackupDue(input({ ...base, now: at(10, 3) }))).toBeNull();
    // No dia seguinte, o horário volta a valer.
    expect(autoBackupDue(input({ ...base, now: at(11, 3) }))).toBe("slot");
  });
});

describe("saúde do backup", () => {
  const ago = (d: Date) => `em ${d.getDate()}/${d.getMonth() + 1}`;
  const now = at(10, 12);
  it("em dia, atrasado, desligado, falhou, rodando, nunca", () => {
    const base = { now, auto: true, running: false, lastSuccessAt: at(10, 3), lastFailure: null, folderProblem: null };
    expect(backupHealth(base, ago).level).toBe("ok");
    expect(backupHealth({ ...base, lastSuccessAt: at(7, 3) }, ago)).toMatchObject({
      level: "warn",
      title: "Backup atrasado",
    });
    expect(backupHealth({ ...base, auto: false }, ago)).toMatchObject({
      level: "warn",
      title: "Backup automático desligado",
    });
    expect(backupHealth({ ...base, lastFailure: { at: at(10, 11), message: "Disco cheio." } }, ago)).toMatchObject({
      level: "error",
      detail: "Disco cheio.",
    });
    // Falha antiga (antes do último sucesso) não conta.
    expect(backupHealth({ ...base, lastFailure: { at: at(9, 11), message: "x" } }, ago).level).toBe("ok");
    expect(backupHealth({ ...base, running: true }, ago).level).toBe("running");
    expect(backupHealth({ ...base, lastSuccessAt: null }, ago)).toMatchObject({
      level: "warn",
      title: "Nenhum backup ainda",
    });
    expect(backupHealth({ ...base, lastSuccessAt: null, auto: false }, ago).level).toBe("error");
    expect(backupHealth({ ...base, folderProblem: "A iCloud Drive não está ligada." }, ago)).toMatchObject({
      level: "error",
    });
  });

  it("arquivo estragado (aviso que se repete em todo backup) não esconde “atrasado” nem “desligado”", () => {
    const warning = corruptFilesWarning(1);
    const base = { now, auto: true, running: false, lastSuccessAt: at(10, 3), lastFailure: null, folderProblem: null };
    // Em dia: o aviso é o título.
    expect(backupHealth({ ...base, lastWarning: warning }, ago)).toMatchObject({
      level: "warn",
      title: "Último backup com arquivos estragados",
    });
    // Último backup de 9 dias atrás: “atrasado” vem primeiro, com o aviso junto.
    const stale = backupHealth({ ...base, lastSuccessAt: at(1, 3), lastWarning: warning }, ago);
    expect(stale).toMatchObject({ level: "warn", title: "Backup atrasado" });
    expect(stale.detail).toContain("só roda com o Offer Studio aberto");
    expect(stale.detail).toContain(warning);
    // Automático desligado: título e conselho continuam aparecendo.
    const off = backupHealth({ ...base, auto: false, lastWarning: warning }, ago);
    expect(off).toMatchObject({ level: "warn", title: "Backup automático desligado" });
    expect(off.detail).toContain("Ligue o automático");
    expect(off.detail).toContain(warning);
    // Falha depois do último sucesso continua mais importante.
    expect(
      backupHealth({ ...base, lastWarning: warning, lastFailure: { at: at(10, 11), message: "Disco cheio." } }, ago),
    ).toMatchObject({ level: "error", title: "O último backup falhou" });
  });
});

describe("textos da tela", () => {
  const now = at(10, 12);
  it("datas, próximo automático, confirmação e quantos guardar", () => {
    expect(friendlyDate(at(10, 3), now)).toBe("hoje às 03:00");
    expect(friendlyDate(at(9, 23, 5), now)).toBe("ontem às 23:05");
    expect(friendlyDate(at(11, 3), now)).toBe("amanhã às 03:00");
    expect(friendlyDate(at(2, 3), now)).toBe("02/10 às 03:00");
    expect(friendlyDate(new Date(2025, 11, 31, 8), now)).toBe("31/12/2025 às 08:00");
    expect(nextAutoLabel({ auto: false, nextAutoAt: null, autoSoon: false }, now)).toBe("Desligado");
    expect(nextAutoLabel({ auto: true, nextAutoAt: at(11, 3).toISOString(), autoSoon: true }, now)).toBe(
      "Em instantes",
    );
    expect(nextAutoLabel({ auto: true, nextAutoAt: at(11, 3).toISOString(), autoSoon: false }, now)).toBe(
      "amanhã às 03:00",
    );
    expect(isConfirmed(" restaurar ")).toBe(true);
    expect(isConfirmed("RESTAURA")).toBe(false);
    expect(keepChoices(10)).toEqual([3, 5, 7, 10, 14, 20, 30]);
    expect(keepChoices(4)).toEqual([3, 4, 5, 7, 10, 14, 20, 30]);
  });
});

describe("formato do arquivo", () => {
  it("nome com data e hora locais (e sufixo para o mesmo minuto)", () => {
    expect(backupFileName(at(1, 3, 7))).toBe("offer-studio-backup-2026-10-01-0307.zip");
    expect(backupFileName(at(1, 3, 7), 2)).toBe("offer-studio-backup-2026-10-01-0307-2.zip");
  });

  it("nome com a marca da instalação: dois Macs no mesmo minuto nunca disputam o nome", () => {
    const tagA = installTag("os-mac-a");
    const tagB = installTag("os-mac-b");
    expect(tagA).toMatch(/^[0-9a-f]{5}$/);
    expect(tagA).toBe(installTag("os-mac-a"));
    expect(tagA).not.toBe(tagB);
    const a = backupFileName(at(1, 3), 1, "os-mac-a");
    const b = backupFileName(at(1, 3), 1, "os-mac-b");
    expect(a).toBe(`offer-studio-backup-2026-10-01-0300-${tagA}.zip`);
    expect(a).not.toBe(b);
    expect(backupFileName(at(1, 3), 3, "os-mac-a")).toBe(`offer-studio-backup-2026-10-01-0300-${tagA}-3.zip`);
    expect(installTagOfName(a)).toBe(tagA);
    expect(installTagOfName("offer-studio-backup-2026-10-01-0300.zip")).toBeNull();
    expect(installTagOfName(`offer-studio-backup-2026-10-01-0300-${tagA} 2.zip`)).toBe(tagA);
  });

  it("limpeza automática: só nomes que o app dá (cópias e arquivos renomeados ficam)", () => {
    const tag = installTag("os-mac-a");
    const appNames = [
      "offer-studio-backup-2026-10-01-0300.zip",
      "offer-studio-backup-2026-10-01-0300-2.zip",
      `offer-studio-backup-2026-10-01-0300-${tag}.zip`,
      `offer-studio-backup-2026-10-01-0300-${tag}-12.zip`,
      // Conflito da iCloud Drive.
      "offer-studio-backup-2026-10-01-0300 2.zip",
      `offer-studio-backup-2026-10-01-0300-${tag} 3.zip`,
    ];
    const userNames = [
      "offer-studio-backup-2026-10-01-0300 copy.zip",
      "offer-studio-backup-2026-10-01-0300 copy 2.zip",
      "offer-studio-backup-2026-10-01-0300 cópia.zip",
      "offer-studio-backup-2026-10-01-0300 (1).zip",
      "offer-studio-backup-2026-10-01-0300 IMPORTANTE antes da mudanca.zip",
      "offer-studio-backup-2026-10-01-0300-final.zip",
      `offer-studio-backup-2026-10-01-0300-${tag} copy.zip`,
    ];
    for (const name of appNames) {
      expect(APP_BACKUP_NAME_RE.test(name), name).toBe(true);
      expect(BACKUP_FILE_RE.test(name), name).toBe(true);
    }
    for (const name of userNames) {
      expect(APP_BACKUP_NAME_RE.test(name), name).toBe(false);
      // Continuam na lista (dá para restaurar).
      expect(BACKUP_FILE_RE.test(name), name).toBe(true);
    }
  });

  it("chaves de storage aceitas (nada de ../ nem pastas desconhecidas)", () => {
    expect(isBackupStorageKey(`a/ab/${"ab".padEnd(64, "0")}.png`)).toBe(true);
    expect(isBackupStorageKey("versions/cmabc/1234-uuid.json.gz")).toBe(true);
    expect(isBackupStorageKey("clones/job1/desktop.jpg")).toBe(true);
    expect(isBackupStorageKey("exports/x/y.zip")).toBe(false);
    expect(isBackupStorageKey("uploads/x.zip")).toBe(false);
    expect(isBackupStorageKey("versions/../../etc/passwd")).toBe(false);
    expect(isBackupStorageKey(`a/cd/${"ab".padEnd(64, "0")}.png/../../x`)).toBe(false);
  });

  it("versões: aceita antigo, recusa mais novo", () => {
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("0.2.0", "0.10.0")).toBe(-1);
    expect(compareVersions("1.0", "0.9.9")).toBe(1);
    const current = { appVersion: "0.2.0", migrations: ["a", "b"] };
    expect(compatibilityProblem({ format: 1, appVersion: "0.1.0", migrations: ["a"] }, current)).toBeNull();
    expect(compatibilityProblem({ format: 1, appVersion: "0.3.0", migrations: ["a"] }, current)).toBe(
      NEWER_VERSION_MESSAGE,
    );
    expect(compatibilityProblem({ format: 2, appVersion: "0.1.0", migrations: ["a"] }, current)).toBe(
      NEWER_VERSION_MESSAGE,
    );
    expect(compatibilityProblem({ format: 1, appVersion: "0.2.0", migrations: ["a", "c"] }, current)).toBe(
      NEWER_VERSION_MESSAGE,
    );
  });

  it("ordem de dependência: pais antes dos filhos, referência à própria tabela ignorada", () => {
    const meta = (name: string, refs: string[]) => ({
      name,
      columns: [],
      primaryKey: ["id"],
      serialColumns: [],
      foreignKeys: refs.map((refTable) => ({ columns: ["x"], refTable })),
    });
    const schema: SchemaMeta = new Map([
      ["Page", meta("Page", ["Offer"])],
      ["Offer", meta("Offer", ["Folder"])],
      ["Folder", meta("Folder", [])],
      ["CloneJob", meta("CloneJob", ["CloneJob", "Offer"])],
      ["CloneLog", meta("CloneLog", ["CloneJob"])],
    ]);
    expect(dependencyOrder(["Page", "CloneLog", "Offer", "CloneJob", "Folder"], schema)).toEqual([
      "Folder",
      "Offer",
      "CloneJob",
      "Page",
      "CloneLog",
    ]);
    const cyclic: SchemaMeta = new Map([
      ["A", meta("A", ["B"])],
      ["B", meta("B", ["A"])],
    ]);
    expect(() => dependencyOrder(["A", "B"], cyclic)).toThrow(/circular/);
  });
});
