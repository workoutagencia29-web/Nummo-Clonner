"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  BLANK_TEMPLATE,
  DEFAULT_OFFER_TEMPLATE,
  OFFER_START_TEMPLATES,
  TemplateGallery,
} from "@/components/offers/template-gallery";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { isTemplateId } from "@/editor/templates/catalog";
import { useAction } from "@/hooks/use-action";
import { createOfferAction } from "@/server/actions/offers";

const NO_FOLDER = "__none__";

/** Entrada da action de criar oferta (com o modelo da primeira página, opcional). */
type CreateOfferInput = Parameters<typeof createOfferAction>[0];

interface CreateOfferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: { id: string; name: string }[];
  defaultFolderId?: string | null;
  /** Modelo já escolhido ao abrir (ex.: o cartão "Começar de um modelo" do painel vazio). */
  defaultTemplateId?: string | null;
}

/**
 * Nova oferta: nome, pasta e o modelo da primeira página, na mesma galeria do
 * "Nova página" (a página de vendas já vem escolhida). Abre a oferta criada.
 */
export function CreateOfferDialog({
  open,
  onOpenChange,
  folders,
  defaultFolderId,
  defaultTemplateId,
}: CreateOfferDialogProps) {
  const router = useRouter();
  const { run, pending } = useAction(createOfferAction);
  const [name, setName] = useState("");
  const [folderId, setFolderId] = useState<string>(NO_FOLDER);
  const [templateId, setTemplateId] = useState<string>(DEFAULT_OFFER_TEMPLATE);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
      setTemplateId(
        defaultTemplateId && (defaultTemplateId === BLANK_TEMPLATE || isTemplateId(defaultTemplateId))
          ? defaultTemplateId
          : DEFAULT_OFFER_TEMPLATE,
      );
      setFolderId(defaultFolderId && folders.some((f) => f.id === defaultFolderId) ? defaultFolderId : NO_FOLDER);
    }
  }, [open, defaultFolderId, defaultTemplateId, folders]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Dê um nome para a oferta.");
      document.getElementById("offer-name")?.focus();
      return;
    }
    const input: CreateOfferInput = {
      name: name.trim(),
      folderId: folderId === NO_FOLDER ? null : folderId,
      tagIds: [],
    };
    if (isTemplateId(templateId)) input.templateId = templateId;
    void run(input, {
      success: "Oferta criada.",
      silentError: true,
      onError: (msg) => setError(msg),
      onSuccess: (offer) => {
        onOpenChange(false);
        router.push(`/ofertas/${offer.id}`);
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-4xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Nova oferta</DialogTitle>
            <DialogDescription>
              Dê um nome e escolha como a primeira página começa. Depois você adiciona as outras páginas do funil.
            </DialogDescription>
          </DialogHeader>
          <div className="my-5 flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-[1fr_16rem]">
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor="offer-name">Nome da oferta</FieldLabel>
                <Input
                  id="offer-name"
                  value={name}
                  maxLength={120}
                  placeholder="Ex.: Emagrecimento 30D — VSL"
                  aria-invalid={Boolean(error)}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                  autoFocus
                />
                <FieldError>{error}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor="offer-folder">Pasta</FieldLabel>
                <Select value={folderId} onValueChange={setFolderId}>
                  <SelectTrigger id="offer-folder" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_FOLDER}>Sem pasta</SelectItem>
                    {folders.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Primeira página</p>
              <TemplateGallery
                value={templateId}
                onValueChange={setTemplateId}
                templates={OFFER_START_TEMPLATES}
                label="Primeira página"
                className="md:grid-cols-4"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner />}
              Criar oferta
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
