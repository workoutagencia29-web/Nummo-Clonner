"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { discardUnsavedChanges, setLeaveHost } from "@/hooks/use-unsaved-changes";

/**
 * Pergunta antes de sair da tela por um link (menu lateral, "Ofertas"…) com
 * alterações não salvas (useUnsavedChanges). Monte uma vez na tela.
 */
export function UnsavedChangesGuard() {
  const router = useRouter();
  const [href, setHref] = useState<string | null>(null);

  useEffect(() => {
    setLeaveHost(setHref);
    return () => setLeaveHost(null);
  }, []);

  return (
    <AlertDialog open={href !== null} onOpenChange={(open) => !open && setHref(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
          <AlertDialogDescription>
            Você mudou algo nesta tela e ainda não salvou. Se sair agora, essas alterações se perdem. As abas com
            alterações não salvas estão marcadas com um ponto.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Continuar editando</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={() => {
              const to = href;
              setHref(null);
              if (!to) return;
              discardUnsavedChanges();
              router.push(to);
            }}
          >
            Sair sem salvar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
