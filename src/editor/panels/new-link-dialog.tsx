"use client";

import { LinkIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { offerLinkHref } from "@/components/offers/offer-link-href";
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
import { CHECKOUT_LINK_BADGE } from "../grapes/components";
import type { NewLinkRequest, NewLinkTarget } from "../grapes/new-link";
import { bindQuizLink } from "../widgets/quiz";
import { bindWheelLink } from "../widgets/wheel";

type Kind = NewLinkRequest["kind"];
type Target = NewLinkTarget;

/**
 * Tipos que podem ser "Checkout do Offer Studio" (os de compra, como na aba
 * "Links e checkouts"). Também no "Criar link da oferta" do diálogo "Links e
 * checkouts" do editor (links-dialog.tsx).
 */
export const CHECKOUT_KINDS: Kind[] = ["CHECKOUT", "UPSELL", "DOWNSELL"];

export const TARGET_LABEL: Record<Target, string> = {
  URL: "Endereço (link)",
  CHECKOUT: CHECKOUT_LINK_BADGE,
};

/** Detalhe do aviso de link "Checkout do Offer Studio" criado (o que se monta depois). */
export const OWN_CHECKOUT_TODO = "Produto, valor, dados pedidos, frete, order bumps e aparência.";

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
  /**
   * Sai do editor para outra tela do painel, salvando antes (o "Montar o
   * checkout" do aviso depois de criar um link "Checkout do Offer Studio").
   */
  navigate?: (href: string) => void;
}

/**
 * Cria um link da oferta sem sair do editor e liga o elemento a ele. O endereço
 * pode ficar vazio e ser preenchido depois (na aba "Links e checkouts" da
 * oferta). Links de compra podem nascer com o destino "Checkout do Offer
 * Studio": o checkout (produto, valor…) se monta depois, na aba "Links e
 * checkouts" (o aviso de sucesso leva até ele).
 */
export function NewLinkDialog({ payload, request, onClose, onBound, navigate }: Props) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<Kind>("CHECKOUT");
  const [target, setTarget] = useState<Target>("URL");
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
    setTarget(request.target === "CHECKOUT" && CHECKOUT_KINDS.includes(request.kind) ? "CHECKOUT" : "URL");
    setError(null);
  }, [request, payload.links]);

  const checkoutAllowed = CHECKOUT_KINDS.includes(kind);
  const ownCheckout = checkoutAllowed && target === "CHECKOUT";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!request) return;
    const where = request.bind ? "à fatia da roleta" : "ao elemento";
    const res = await create.run(
      ownCheckout
        ? { offerId: payload.offer.id, label, url: "", kind, target: "CHECKOUT" as const }
        : { offerId: payload.offer.id, label, url, kind },
      {
        silentError: true,
        // O checkout do link novo ainda não existe: o aviso (abaixo) leva até ele.
        ...(!ownCheckout && { success: `Link criado e ligado ${where}.` }),
      },
    );
    if (!res.ok) {
      setError({ message: res.error, field: res.field });
      return;
    }
    // Como o getEditorPayload: link "Checkout do Offer Studio" sem produto salvo = checkout "" (sem endereço).
    payload.links.push(ownCheckout ? { ...res.data, url: "", checkout: "" } : res.data);
    if (ownCheckout) {
      const href = offerLinkHref(payload.offer.id, res.data.id);
      toast.success(`Link criado e ligado ${where}. Agora monte o checkout dele em “Links e checkouts”.`, {
        description: OWN_CHECKOUT_TODO,
        ...(navigate && { action: { label: "Montar o checkout", onClick: () => navigate(href) } }),
      });
    }
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
              {ownCheckout
                ? "O elemento fica ligado a este link. O checkout que você montar nele (na aba “Links e checkouts” da oferta) vale para todos os botões ligados a ele, em todas as páginas."
                : "O elemento fica ligado a este link. Trocar o endereço depois (na aba “Links e checkouts” da oferta) atualiza todos os botões ligados a ele, em todas as páginas."}
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
              <FieldLabel>Tipo</FieldLabel>
              <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                <SelectTrigger className="w-full" aria-label="Tipo">
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
              {error?.field === "kind" && <FieldError>{error.message}</FieldError>}
            </Field>
            {checkoutAllowed && (
              <Field>
                <FieldLabel>Destino</FieldLabel>
                <Select value={target} onValueChange={(v) => setTarget(v as Target)}>
                  <SelectTrigger className="w-full" aria-label="Destino">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TARGET_LABEL) as Target[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {TARGET_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {ownCheckout && (
                  <FieldDescription>
                    Página de checkout do Offer Studio (PIX em real; Kyvo nas outras moedas). Depois de criar, monte o
                    checkout em “Links e checkouts”: produto, valor, dados pedidos, frete, order bumps e aparência. A
                    página abre na prévia (em simulação) e vai no ZIP.
                  </FieldDescription>
                )}
              </Field>
            )}
            {!ownCheckout && (
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
            )}
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
