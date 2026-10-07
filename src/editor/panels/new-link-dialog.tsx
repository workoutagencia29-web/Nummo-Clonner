"use client";

import { LinkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { createOfferLinkAction } from "@/server/actions/offer-links";
import type { EditorPayload } from "@/server/services/documents";
import type { NewLinkRequest } from "../grapes/new-link";
import { bindQuizLink } from "../widgets/quiz";
import { bindWheelLink } from "../widgets/wheel";

type Kind = NewLinkRequest["kind"];

const KIND_LABEL: Record<Kind, string> = {
  CHECKOUT: "Checkout",
  UPSELL: "Checkout do upsell",
  DOWNSELL: "Checkout do downsell",
  WHATSAPP: "WhatsApp",
  OTHER: "Outro",
};

const DEFAULT_NAME: Record<Kind, string> = {
  CHECKOUT: "Checkout principal",
  UPSELL: "Checkout do upsell",
  DOWNSELL: "Checkout do downsell",
  WHATSAPP: "WhatsApp",
  OTHER: "Link",
};

interface Props {
  payload: EditorPayload;
  request: NewLinkRequest | null;
  onClose: () => void;
  /** Chamado depois de criar e ligar (para atualizar as configurações do elemento). */
  onBound: (request: NewLinkRequest) => void;
}

/**
 * Cria um link da oferta sem sair do editor e liga o elemento a ele. O endereço
 * pode ficar vazio e ser preenchido depois (na aba "Links e checkouts" da oferta).
 */
export function NewLinkDialog({ payload, request, onClose, onBound }: Props) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<Kind>("CHECKOUT");
  const [error, setError] = useState<{ message: string; field?: string } | null>(null);
  const create = useAction(createOfferLinkAction);

  useEffect(() => {
    if (!request) return;
    const taken = new Set(payload.links.map((l) => l.label));
    const base = request.name || DEFAULT_NAME[request.kind];
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base} ${i}`;
    setLabel(name);
    setUrl("");
    setKind(request.kind);
    setError(null);
  }, [request, payload.links]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!request) return;
    const res = await create.run(
      { offerId: payload.offer.id, label, url, kind },
      {
        silentError: true,
        success: request.bind ? "Link criado e ligado à fatia da roleta." : "Link criado e ligado ao elemento.",
      },
    );
    if (!res.ok) {
      setError({ message: res.error, field: res.field });
      return;
    }
    payload.links.push(res.data);
    // Fatia da roleta: o prêmio dela. Botão final do quiz ou "Resgatar" da roleta:
    // todos os botões do widget ficam ligados ao link novo e o destino de antes
    // (página do funil ou endereço) sai.
    if (request.bind) request.bind(res.data.key);
    else if (!bindQuizLink(request.component, res.data.key) && !bindWheelLink(request.component, res.data.key)) {
      request.component.addAttributes({ "data-os-link": res.data.key });
    }
    onBound(request);
    onClose();
  }

  return (
    <Dialog open={request !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LinkIcon className="size-4" />
              Novo link da oferta
            </DialogTitle>
            <DialogDescription>
              O elemento fica ligado a este link. Trocar o endereço depois (na aba “Links e checkouts” da oferta)
              atualiza todos os botões ligados a ele, em todas as páginas.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="my-4">
            <Field>
              <FieldLabel htmlFor="novo-link-nome">Nome</FieldLabel>
              <Input
                id="novo-link-nome"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={60}
                autoFocus
                aria-invalid={error?.field === "label"}
              />
              {error?.field === "label" && <FieldError>{error.message}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="novo-link-url">Endereço</FieldLabel>
              <Input
                id="novo-link-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={kind === "WHATSAPP" ? "https://wa.me/5511999999999" : "https://pay.hotmart.com/…"}
                inputMode="url"
                aria-invalid={error?.field === "url"}
              />
              <FieldDescription>Pode deixar em branco e preencher depois.</FieldDescription>
              {error?.field === "url" && <FieldError>{error.message}</FieldError>}
            </Field>
            <Field>
              <FieldLabel>Tipo</FieldLabel>
              <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {error && !error.field && <FieldError>{error.message}</FieldError>}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={create.pending}>
              {create.pending && <Spinner />}
              Criar e ligar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
