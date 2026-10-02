"use client";

import { HistoryIcon, RotateCcwIcon, SaveIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { dateTime } from "@/lib/format";
import type { EditorDialogProps } from "../editor-app";

interface VersionRow {
  id: string;
  kind: "AUTO" | "MANUAL" | "CLONE" | "IMPORT" | "RESTORE" | "BULK_REPLACE" | "EXPORT";
  label: string | null;
  createdAt: string;
  bytes: number;
}

const KIND_LABEL: Record<VersionRow["kind"], string> = {
  AUTO: "Automático",
  MANUAL: "Salvo por você",
  CLONE: "Original da clonagem",
  IMPORT: "Página original",
  RESTORE: "Antes de restaurar",
  BULK_REPLACE: "Antes de substituir",
  EXPORT: "Download",
};

/**
 * Nomes que o servidor grava com "versão" — no editor, "versão" é só a do
 * teste A/B: na lista aparece o nome do tipo de ponto.
 */
const LEGACY_LABELS: Record<string, string | null> = {
  "Versão original": null,
  "Antes de restaurar uma versão": null,
  "Versão salva": "Ponto salvo",
};

/** Nome mostrado na lista do Histórico. */
export function historyLabel(row: Pick<VersionRow, "kind" | "label">): string {
  const label = row.label?.trim();
  if (!label) return KIND_LABEL[row.kind];
  if (label in LEGACY_LABELS) return LEGACY_LABELS[label] ?? KIND_LABEL[row.kind];
  return label;
}

/**
 * Histórico da página: pontos de restauração automáticos e com nome, e voltar
 * para qualquer um. ("Versão" no editor é só a do teste A/B.)
 */
export function VersionsDialog({ payload, open, onOpenChange, saveNow, reloadDiscarding }: EditorDialogProps) {
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<VersionRow | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/documents/${payload.documentId}/versions`, { cache: "no-store" });
    if (res.ok) setVersions((await res.json()) as VersionRow[]);
    else toast.error("Não foi possível carregar o histórico.");
  }, [payload.documentId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function createVersion(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (!(await saveNow())) {
        toast.error("Não foi possível salvar as alterações antes de criar o ponto de restauração.");
        return;
      }
      const res = await fetch(`/api/documents/${payload.documentId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() || "Ponto salvo" }),
      });
      if (!res.ok) {
        toast.error("Não foi possível salvar o ponto de restauração.");
        return;
      }
      setLabel("");
      toast.success("Ponto de restauração salvo.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function restore(version: VersionRow) {
    setBusy(true);
    try {
      // "A situação atual é guardada antes": sem conseguir salvar, não restaura
      // (as alterações desta aba se perderiam ao recarregar).
      if (!(await saveNow())) {
        toast.error("Não foi possível salvar a situação atual. A página não foi restaurada — tente de novo.");
        return;
      }
      const res = await fetch(`/api/documents/${payload.documentId}/versions/${version.id}/restore`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ?? "Não foi possível voltar para este ponto.");
        return;
      }
      toast.success("Página restaurada. Recarregando o editor…");
      // O servidor já tem a página restaurada: recarrega sem gravar o editor por cima.
      reloadDiscarding();
    } finally {
      setBusy(false);
      setRestoring(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Histórico</DialogTitle>
          <DialogDescription>
            O Offer Studio guarda um ponto de restauração automático a cada 10 minutos de edição. Antes de grandes
            mudanças, salve um ponto com nome para poder voltar a ele.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={createVersion} className="flex gap-2">
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Nome do ponto (ex.: antes de trocar a headline)"
            maxLength={120}
            aria-label="Nome do ponto de restauração"
          />
          <Button type="submit" disabled={busy}>
            {busy ? <Spinner /> : <SaveIcon />}
            Salvar ponto de restauração
          </Button>
        </form>
        <div className="max-h-80 overflow-y-auto rounded-lg border">
          {versions === null ? (
            <div className="grid place-items-center p-6">
              <Spinner />
            </div>
          ) : versions.length === 0 ? (
            <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <HistoryIcon className="size-4" />O histórico ainda está vazio. Os pontos aparecem conforme você edita.
            </p>
          ) : (
            <ul className="divide-y">
              {versions.map((v) => (
                <li key={v.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{historyLabel(v)}</p>
                    <p className="text-xs text-muted-foreground">{dateTime(v.createdAt)}</p>
                  </div>
                  {historyLabel(v) !== KIND_LABEL[v.kind] && (
                    <Badge variant={v.kind === "MANUAL" ? "secondary" : "outline"}>{KIND_LABEL[v.kind]}</Badge>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRestoring(v)}
                    disabled={busy}
                    aria-label={`Restaurar: ${historyLabel(v)}`}
                  >
                    <RotateCcwIcon />
                    Restaurar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(o) => !o && setRestoring(null)}
        title="Voltar para este ponto?"
        description="A página volta a ficar como estava nesse ponto do histórico. A situação atual é guardada antes, então dá para desfazer pelo próprio Histórico."
        confirmLabel="Restaurar"
        pending={busy}
        onConfirm={() => restoring && void restore(restoring)}
      />
    </Dialog>
  );
}
