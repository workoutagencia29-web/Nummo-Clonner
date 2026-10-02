"use client";

import { KeyRoundIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * "Esqueci a senha": o Offer Studio roda só neste Mac e não manda e-mail, então
 * a senha nova é criada pelo atalho "Redefinir senha" da pasta do app.
 */
export function ForgotPassword() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs font-normal">
          Esqueci a senha
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-4 text-primary" />
            Criar uma senha nova
          </DialogTitle>
          <DialogDescription>
            Por segurança, a senha só pode ser trocada aqui no Mac. Suas ofertas não mudam.
          </DialogDescription>
        </DialogHeader>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm">
          <li>
            Abra a pasta do Offer Studio (a mesma do atalho <strong>Abrir Offer Studio</strong>).
          </li>
          <li>
            Dê dois cliques em <strong>Redefinir senha</strong>.
          </li>
          <li>Na janela que abrir, digite a senha nova duas vezes (ela não aparece enquanto você digita).</li>
          <li>Volte aqui e entre com a senha nova.</li>
        </ol>
        <p className="text-xs text-muted-foreground">
          Prefere o Terminal? Na pasta do Offer Studio, rode{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono">npm run redefinir-senha</code>.
        </p>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button">Entendi</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
