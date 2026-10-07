"use client";

import { CheckIcon, CreditCardIcon, LinkIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { LINK_QUERY_PARAM } from "@/components/offers/offer-link-href";
import {
  type PaymentPageOption,
  PaymentProductForm,
  type PaymentProductValue,
} from "@/components/offers/payment-product-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { plural } from "@/lib/format";
import { linkUrlHint, linkUrlProblem, normalizeLinkUrl } from "@/lib/link-url";
import type { PaymentKeyState } from "@/lib/payments/checks";
import { cn } from "@/lib/utils";
import { createOfferLinkAction, deleteOfferLinkAction, updateOfferLinkAction } from "@/server/actions/offer-links";
import { setOfferLinkTargetAction } from "@/server/actions/payments";

type Kind = "CHECKOUT" | "UPSELL" | "DOWNSELL" | "WHATSAPP" | "OTHER";
const KIND_LABEL: Record<Kind, string> = {
  CHECKOUT: "Checkout",
  UPSELL: "Checkout do upsell",
  DOWNSELL: "Checkout do downsell",
  WHATSAPP: "WhatsApp",
  OTHER: "Outro",
};

type Target = "URL" | "PAYMENT";
/** Tipos que podem ser "Pagamento na página" (os de compra). */
const PAYMENT_KINDS: Kind[] = ["CHECKOUT", "UPSELL", "DOWNSELL"];
const TARGET_LABEL: Record<Target, string> = { URL: "Endereço (link)", PAYMENT: "Pagamento na página" };
const NOT_PAYMENT_KIND =
  "Só links de checkout (checkout, upsell ou downsell) podem ser “Pagamento na página”. Mude o tipo do link antes.";

export interface OfferLinkRow {
  id: string;
  key: string;
  label: string;
  url: string;
  kind: Kind;
  /** Para onde leva: endereço ou pagamento na página (padrão: endereço). */
  target?: Target;
  /** Produto do pagamento na página (guardado mesmo voltando para endereço). */
  payment?: PaymentProductValue | null;
  /** Botões ligados (data-os-link). */
  usage: number;
  /** Fatias da roleta de desconto com este link de prêmio. */
  prizes?: number;
}

/** Texto da confirmação de exclusão para os botões. */
function buttonsDescription(usage: number, url: string, payment = false) {
  const many = usage > 1;
  if (payment) {
    return `${plural(usage, "botão deixa", "botões deixam")} de abrir a janela de pagamento e volta${many ? "m" : ""} para o endereço que tinha${many ? "m" : ""} antes de ser${many ? "em" : ""} ligado${many ? "s" : ""}.`;
  }
  if (url) {
    return `${plural(usage, "botão continua", "botões continuam")} levando para ${url}, mas deixa${many ? "m" : ""} de acompanhar as mudanças deste link.`;
  }
  return `Este link está sem URL: ${plural(usage, "botão ligado a ele volta", "botões ligados a ele voltam")} para o endereço que tinha${many ? "m" : ""} antes de ser${many ? "em" : ""} ligado${many ? "s" : ""}.`;
}

/**
 * Texto da confirmação de exclusão. Ao excluir, a URL atual é gravada em cada
 * botão ligado (deleteOfferLink); sem URL, eles voltam ao endereço de antes. A
 * fatia da roleta com este link de prêmio não muda: fica sem prêmio (sem
 * checkout com desconto) até ganhar outro link no editor.
 */
export function deleteDescription(link: Pick<OfferLinkRow, "usage" | "url" | "prizes" | "target">) {
  const prizes = link.prizes ?? 0;
  if (!link.usage && !prizes) return "Nenhum botão usa este link.";
  const parts = link.usage ? [buttonsDescription(link.usage, link.url, link.target === "PAYMENT")] : [];
  if (prizes) {
    const many = prizes > 1;
    parts.push(
      `É o prêmio de ${plural(prizes, "fatia", "fatias")} da roleta: ${many ? "elas continuam" : "ela continua"} na roda, mas quem ganhar não vai para nenhum checkout com desconto até você ligar outro link ${many ? "a elas" : "a ela"} no editor.`,
    );
  }
  return parts.join(" ");
}

/** Quem usa o link: "2 botões ligados", "Prêmio da roleta", "1 botão · prêmio da roleta"… */
export function usageLabel(link: Pick<OfferLinkRow, "usage" | "prizes">) {
  const prizes = link.prizes ?? 0;
  const prize = prizes > 1 ? `prêmio de ${prizes} fatias da roleta` : "prêmio da roleta";
  if (link.usage && prizes) return `${plural(link.usage, "botão", "botões")} · ${prize}`;
  if (prizes) return prize.charAt(0).toUpperCase() + prize.slice(1);
  return link.usage ? plural(link.usage, "botão ligado", "botões ligados") : "Nenhum botão ligado";
}

/** Exemplo curto de endereço para o tipo do link (cabe no campo sem cortar). */
function urlPlaceholder(kind: Kind) {
  return kind === "WHATSAPP" ? "https://wa.me/5511999999999" : "https://pay.hotmart.com/…";
}

/** Aviso que não bloqueia (checkout sem o código do produto…). */
function UrlHint({ url }: { url: string }) {
  const hint = linkUrlHint(url);
  if (!hint) return null;
  return (
    <p className="flex items-start gap-1.5 text-xs text-warning-foreground dark:text-warning">
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      {hint}
    </p>
  );
}

/** Erro do endereço antes de mandar (o mesmo texto da ação). */
function urlError(url: string) {
  return linkUrlProblem(normalizeLinkUrl(url));
}

/** O que a aba precisa para o pagamento na página. */
interface PaymentContext {
  pages: PaymentPageOption[];
  /** Estado da chave do gateway (Configurações → Pagamentos). */
  gatewayKey: PaymentKeyState;
}

function TargetSelect({
  value,
  kind,
  onChange,
  id,
  label,
  disabled,
  compact = true,
}: {
  value: Target;
  kind: Kind;
  onChange: (t: Target) => void;
  id?: string;
  label: string;
  disabled?: boolean;
  /** Na linha do link (pequeno); no "Novo link", do tamanho dos outros campos. */
  compact?: boolean;
}) {
  const payable = PAYMENT_KINDS.includes(kind);
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Target)} disabled={disabled}>
      <SelectTrigger
        id={id}
        size={compact ? "sm" : "default"}
        className={compact ? "w-52" : "w-full"}
        aria-label={label}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="URL">{TARGET_LABEL.URL}</SelectItem>
        <SelectItem value="PAYMENT" disabled={!payable}>
          {payable ? TARGET_LABEL.PAYMENT : `${TARGET_LABEL.PAYMENT} (só checkout)`}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

/**
 * Link pedido no endereço (?link=<id>, de "Abrir o link" no "Próximos passos" ou
 * num aviso do ZIP): rola até ele, põe o foco nele e destaca por alguns segundos.
 */
function useHighlight(active: boolean) {
  const ref = useRef<HTMLLIElement>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!active) return;
    setFlash(true);
    const frame = requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      ref.current?.focus({ preventScroll: true });
    });
    const timer = setTimeout(() => setFlash(false), 4000);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [active]);
  return { ref, flash };
}

function LinkRow({
  link,
  payments,
  highlight = false,
}: {
  link: OfferLinkRow;
  payments: PaymentContext;
  highlight?: boolean;
}) {
  const { ref, flash } = useHighlight(highlight);
  const [url, setUrl] = useState(link.url);
  const [label, setLabel] = useState(link.label);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const update = useAction(updateOfferLinkAction);
  const remove = useAction(deleteOfferLinkAction);
  const retarget = useAction(setOfferLinkTargetAction);
  // "Pagamento na página" escolhido num link sem produto: o formulário aparece e só liga ao salvar.
  const [paymentDraft, setPaymentDraft] = useState(false);
  const target: Target = link.target ?? "URL";
  const isPayment = target === "PAYMENT" || paymentDraft;

  function changeTarget(next: Target) {
    setError(null);
    if (next === "PAYMENT") {
      if (!PAYMENT_KINDS.includes(link.kind)) {
        setError(NOT_PAYMENT_KIND);
        return;
      }
      if (target === "PAYMENT") return;
      if (link.payment) {
        void retarget.run(
          { linkId: link.id, target: "PAYMENT" },
          { success: "Pronto: os botões ligados a este link abrem a janela de pagamento." },
        );
      } else setPaymentDraft(true);
      return;
    }
    setPaymentDraft(false);
    if (target === "PAYMENT") {
      void retarget.run(
        { linkId: link.id, target: "URL" },
        {
          success: link.url
            ? "Pronto: os botões ligados a este link voltam a levar ao endereço."
            : "Destino trocado para endereço. Cole o endereço do link.",
        },
      );
    }
  }

  useEffect(() => {
    setUrl(link.url);
    setLabel(link.label);
  }, [link.url, link.label]);

  const dirty = url.trim() !== link.url || label.trim() !== link.label;
  useUnsavedChanges(dirty);

  function save() {
    if (!dirty) return;
    const problem = urlError(url);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    void update.run(
      { id: link.id, url: url.trim(), label: label.trim() },
      { success: "Link salvo. Todos os botões ligados a ele foram atualizados.", silentError: true, onError: setError },
    );
  }

  return (
    <li
      ref={ref}
      id={`link-${link.id}`}
      tabIndex={-1}
      data-highlight={flash || undefined}
      className={cn(
        "flex scroll-mt-6 flex-col gap-2 p-4 outline-none transition-shadow first:rounded-t-xl last:rounded-b-xl",
        flash && "ring-2 ring-primary ring-inset",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={save}
          maxLength={60}
          aria-label="Nome do link"
          className="h-8 max-w-xs font-medium"
        />
        <Select
          value={link.kind}
          onValueChange={(v) => void update.run({ id: link.id, kind: v as Kind }, { success: "Tipo atualizado." })}
        >
          <SelectTrigger size="sm" className="w-48" aria-label="Tipo do link">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
              <SelectItem key={k} value={k} disabled={isPayment && !PAYMENT_KINDS.includes(k)}>
                {KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <TargetSelect
          value={isPayment ? "PAYMENT" : "URL"}
          kind={link.kind}
          onChange={changeTarget}
          label={`Destino do link ${link.label}`}
          disabled={retarget.pending}
        />
        {target === "PAYMENT" && link.payment && (
          <Badge variant="secondary" className="gap-1">
            <CreditCardIcon aria-hidden="true" />
            {link.payment.price}
          </Badge>
        )}
        <Badge variant={link.usage || link.prizes ? "secondary" : "outline"}>{usageLabel(link)}</Badge>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label={`Excluir o link ${link.label}`}
          onClick={() => setDeleting(true)}
        >
          <Trash2Icon />
        </Button>
      </div>
      {isPayment ? (
        <>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <PaymentProductForm
            linkId={link.id}
            payment={link.payment ?? null}
            pages={payments.pages}
            gatewayKey={payments.gatewayKey}
            onSaved={() => setPaymentDraft(false)}
            onDiscardNew={() => changeTarget("URL")}
          />
        </>
      ) : (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
            noValidate
          >
            <Input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              placeholder={urlPlaceholder(link.kind)}
              aria-label={`URL do link ${link.label}`}
              aria-invalid={Boolean(error)}
              className="font-mono text-xs"
            />
            <Button type="submit" variant={dirty ? "default" : "outline"} disabled={!dirty || update.pending}>
              {update.pending ? <Spinner /> : <CheckIcon />}
              Salvar
            </Button>
          </form>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!error && !dirty && <UrlHint url={link.url} />}
          {!link.url && !error && (
            <p className="text-xs text-warning-foreground dark:text-warning">
              {link.prizes
                ? "Sem URL ainda: os botões e os prêmios da roleta ligados a este link não levam a lugar nenhum."
                : "Sem URL ainda: os botões ligados a este link não levam a lugar nenhum."}
            </p>
          )}
        </>
      )}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Excluir o link "${link.label}"?`}
        description={deleteDescription(link)}
        confirmLabel="Excluir link"
        destructive
        pending={remove.pending}
        onConfirm={() =>
          void remove.run({ id: link.id }, { success: "Link excluído.", onSuccess: () => setDeleting(false) })
        }
      />
    </li>
  );
}

/** Links da oferta: um lugar só para trocar o checkout de todas as páginas. */
export function OfferLinks({
  offerId,
  links,
  pages = [],
  paymentsKey = "missing",
}: {
  offerId: string;
  links: OfferLinkRow[];
  /** Páginas da oferta (página de obrigado do pagamento na página). */
  pages?: PaymentPageOption[];
  /** Estado da chave do gateway de pagamento (Configurações → Pagamentos). */
  paymentsKey?: PaymentKeyState;
}) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<Kind>("CHECKOUT");
  const [newTarget, setNewTarget] = useState<Target>("URL");
  const payments: PaymentContext = { pages, gatewayKey: paymentsKey };
  const [error, setError] = useState<string | null>(null);
  const create = useAction(createOfferLinkAction);
  const ids = useId();
  // Fora do roteador do Next (testes da tela), não há parâmetros.
  const focusLink = useSearchParams()?.get(LINK_QUERY_PARAM) ?? null;
  // Começou a preencher o link novo e não adicionou: a aba ganha o ponto e sair pergunta.
  useUnsavedChanges(Boolean(label.trim() || url.trim()));

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Cadastre aqui o checkout principal, os checkouts do upsell e do downsell, o WhatsApp… No editor, ligue os botões
        a esses links. Quando você trocar uma URL aqui,{" "}
        <strong className="text-foreground">todos os botões ligados a ela mudam em todas as páginas</strong>.
      </p>

      {links.length === 0 ? (
        <Empty className="border border-dashed py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LinkIcon />
            </EmptyMedia>
            <EmptyTitle>Nenhum link ainda</EmptyTitle>
            <EmptyDescription>
              Cadastre o link do seu checkout aqui embaixo, em “Novo link”. Depois, no editor, clique no botão de compra
              e ligue-o a esse link.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col divide-y rounded-xl border bg-card">
          {links.map((link) => (
            <LinkRow key={link.id} link={link} payments={payments} highlight={focusLink === link.id} />
          ))}
        </ul>
      )}

      <form
        className="flex flex-col gap-3 rounded-xl border border-dashed p-4"
        aria-labelledby={`${ids}-title`}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!label.trim()) {
            setError("Dê um nome para o link, como “Checkout principal”.");
            return;
          }
          const payment = newTarget === "PAYMENT";
          const problem = payment ? null : urlError(url);
          if (problem) {
            setError(problem);
            return;
          }
          void create.run(
            { offerId, label: label.trim(), url: payment ? "" : url.trim(), kind, target: newTarget },
            {
              success: payment
                ? "Link criado. Agora preencha o produto, o valor e as formas de pagamento."
                : "Link criado.",
              silentError: true,
              onError: setError,
              onSuccess: () => {
                setLabel("");
                setUrl("");
                setNewTarget("URL");
                setError(null);
              },
            },
          );
        }}
      >
        <span id={`${ids}-title`} className="text-sm font-medium">
          Novo link
        </span>
        <div className="grid gap-3 sm:grid-cols-2 sm:items-end lg:grid-cols-[minmax(0,12rem)_10rem_12rem_minmax(0,1fr)_auto]">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${ids}-label`} className="text-xs text-muted-foreground">
              Nome
            </Label>
            <Input
              id={`${ids}-label`}
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                setError(null);
              }}
              placeholder="Checkout principal"
              aria-label="Nome do novo link"
              maxLength={60}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${ids}-kind`} className="text-xs text-muted-foreground">
              Tipo
            </Label>
            <Select
              value={kind}
              onValueChange={(v) => {
                setKind(v as Kind);
                if (!PAYMENT_KINDS.includes(v as Kind)) setNewTarget("URL");
              }}
            >
              <SelectTrigger id={`${ids}-kind`} className="w-full" aria-label="Tipo do novo link">
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
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor={`${ids}-target`} className="text-xs text-muted-foreground">
              Destino
            </Label>
            <TargetSelect
              id={`${ids}-target`}
              value={newTarget}
              kind={kind}
              onChange={(t) => {
                setNewTarget(t);
                setError(null);
              }}
              label="Destino do novo link"
              compact={false}
            />
          </div>
          {newTarget === "PAYMENT" ? (
            <p className="text-xs text-muted-foreground sm:pb-2">
              O comprador paga numa janela por cima da página. Depois de adicionar, preencha o produto, o valor e as
              formas de pagamento.
            </p>
          ) : (
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={`${ids}-url`} className="text-xs text-muted-foreground">
                URL <span className="font-normal">(pode preencher depois)</span>
              </Label>
              <Input
                id={`${ids}-url`}
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
                placeholder={urlPlaceholder(kind)}
                aria-label="URL do novo link"
                inputMode="url"
                className="font-mono text-xs"
              />
            </div>
          )}
          <Button type="submit" disabled={create.pending}>
            {create.pending ? <Spinner /> : <PlusIcon />}
            Adicionar
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : (
          <UrlHint url={url} />
        )}
      </form>
    </div>
  );
}
