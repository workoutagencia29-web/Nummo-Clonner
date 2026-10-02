"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BackupFileView } from "@/server/services/backup";
import { AuthForm } from "./auth-form";
import { FirstRunRestore } from "./first-run-restore";

/**
 * Tela de entrada: o formulário (criar acesso ou entrar) e, no primeiro acesso
 * de uma instalação nova, "Restaurar de um backup". Depois de restaurar, a
 * página volta no modo "Entrar" com o e-mail da conta do backup já preenchido.
 */
export function EntrarScreen({
  mode,
  next,
  firstRun,
}: {
  mode: "signin" | "signup";
  next: string;
  /** Instalação nova: backups achados nas pastas sugeridas. */
  firstRun: { backups: BackupFileView[]; folders: string[] } | null;
}) {
  const router = useRouter();
  const [restored, setRestored] = useState<{ email: string | null } | null>(null);
  const notice = restored
    ? restored.email
      ? "Backup restaurado. Entre com a conta do backup (a senha é a que valia quando ele foi feito)."
      : "Backup restaurado. Crie o seu acesso para continuar."
    : undefined;

  return (
    <>
      <AuthForm
        key={`${mode}-${restored ? "r" : ""}`}
        mode={mode}
        next={next}
        defaultEmail={restored?.email ?? undefined}
        notice={notice}
      />
      {firstRun && !restored && (
        <FirstRunRestore
          backups={firstRun.backups}
          folders={firstRun.folders}
          onRestored={(email) => {
            setRestored({ email });
            router.refresh();
          }}
        />
      )}
    </>
  );
}
