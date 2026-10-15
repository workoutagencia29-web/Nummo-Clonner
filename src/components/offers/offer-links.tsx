"use client";

import {
  CheckIcon,
  CreditCardIcon,
  LinkIcon,
  PlusIcon,
  ShoppingCartIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { CheckoutProductForm, type CheckoutProductValue } from "@/components/offers/checkout-product-form";
import {
  accountQueryProvider,
  LINK_QUERY_PARAM,
  PAYMENT_ACCOUNT_QUERY_PARAM,
} from "@/components/offers/offer-link-href";
import { PaymentAccountCard } from "@/components/offers/payment-account-card";
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
import { replaceQuery } from "@/hooks/replace-query";
import { useAction } from "@/hooks/use-action";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { type CheckoutProviderId, PIX_PROVIDERS } from "@/lib/checkout/rules";
import { plural } from "@/lib/format";
import { linkUrlHint, linkUrlProblem, normalizeLinkUrl } from "@/lib/link-url";
import { gatewayKeyState, type PaymentKeyState } from "@/lib/payments/checks";
import type { PaymentAccountView, PaymentKeySource } from "@/lib/payments/gateway";
import { type PaymentCurrencyId, type PaymentProviderId, PROVIDER_LABEL } from "@/lib/payments/rules";
import type { StoreCurrency } from "@/lib/store";
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

type Target = "URL" | "PAYMENT" | "CHECKOUT";
/** Tipos que podem ser "Pagamento na página" ou "Checkout do Offer Studio" (os de compra). */
const PAYMENT_KINDS: Kind[] = ["CHECKOUT", "UPSELL", "DOWNSELL"];
const TARGET_LABEL: Record<Target, string> = {
  URL: "Endereço (link)",
  PAYMENT: "Pagamento na página",
  CHECKOUT: "Checkout do Offer Studio",
};
const NOT_PAYMENT_KIND =
  "Só links de checkout (checkout, upsell ou downsell) podem ser “Pagamento na página”. Mude o tipo do link antes.";
const NOT_CHECKOUT_KIND =
  "Só links de checkout (checkout, upsell ou downsell) podem ser “Checkout do Offer Studio”. Mude o tipo do link antes.";

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
  /** Produto do checkout do Offer Studio (guardado mesmo trocando o destino). */
  checkout?: CheckoutProductValue | null;
  /** Botões ligados (data-os-link). */
  usage: number;
  /** Fatias da roleta de desconto com este link de prêmio. */
  prizes?: number;
  /** Ainda leva ao checkout da página clonada (o dono dela recebe a venda): selo "troque pelo seu". */
  fromClone?: boolean;
}

/** Texto da confirmação de exclusão para os botões. */
function buttonsDescription(usage: number, url: string, target: Target = "URL") {
  const many = usage > 1;
  if (target !== "URL") {
    const what = target === "PAYMENT" ? "abrir a janela de pagamento" : "levar à página de checkout";
    return `${plural(usage, "botão deixa", "botões deixam")} de ${what} e volta${many ? "m" : ""} para o endereço que tinha${many ? "m" : ""} antes de ser${many ? "em" : ""} ligado${many ? "s" : ""}.`;
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
export function deleteDescription(
  link: Pick<OfferLinkRow, "usage" | "url" | "prizes" | "target"> & {
    checkout?: unknown | null;
    payment?: unknown | null;
  },
) {
  const prizes = link.prizes ?? 0;
  const parts = link.usage
    ? [buttonsDescription(link.usage, link.url, link.target ?? "URL")]
    : prizes
      ? []
      : ["Nenhum botão usa este link."];
  if (prizes) {
    const many = prizes > 1;
    parts.push(
      `É o prêmio de ${plural(prizes, "fatia", "fatias")} da roleta: ${many ? "elas continuam" : "ela continua"} na roda, mas quem ganhar não vai para nenhum checkout com desconto até você ligar outro link ${many ? "a elas" : "a ela"} no editor.`,
    );
  }
  // O produto é apagado junto com o link (cascata), mesmo guardado com o destino em "Endereço".
  const products = [
    link.checkout ? "o checkout do Offer Studio dele (produto, order bumps, frete, aparência e textos)" : "",
    link.payment ? "o produto do pagamento na página" : "",
  ].filter(Boolean);
  if (products.length) {
    parts.push(
      `Excluir o link apaga também ${products.join(" e ")}, e não dá para desfazer.${
        (link.target ?? "URL") !== "URL" ? " Para guardar, troque o destino para “Endereço” em vez de excluir." : ""
      }`,
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

/** O que a aba precisa para o pagamento na página e o checkout do Offer Studio. */
interface PaymentContext {
  offerId: string;
  /** Moeda em que a oferta roda (a do checkout do Offer Studio). */
  checkoutCurrency: StoreCurrency;
  /** Estado da chave de cada gateway desta oferta. */
  keys: Partial<Record<CheckoutProviderId, PaymentKeyState>>;
  /** Mostra o cartão da conta do gateway, rola até ele e põe o foco na chave. */
  openProviderAccount: (provider: PaymentProviderId) => void;
  /** O formulário do checkout escolheu um gateway: o cartão da conta dele aparece. */
  onCheckoutProvider: (provider: PaymentProviderId) => void;
  pages: PaymentPageOption[];
  /** Moeda escolhida para a oferta (null: oferta de antes da pergunta). O produto novo começa nela (se a Kyvo cobrar nela). */
  offerCurrency: StoreCurrency | null;
  /** Moeda de um produto já salvo na oferta (o produto novo começa nela quando a oferta não tem uma moeda da Kyvo). */
  productCurrency: PaymentCurrencyId | null;
  /** Estado da chave do gateway desta oferta (cartão da conta, nesta aba). */
  gatewayKey: PaymentKeyState;
  /** Mostra o cartão da conta da Kyvo da oferta, rola até ele e põe o foco na chave. */
  openAccount: () => void;
  /** Um link começou a virar "Pagamento na página": o cartão da conta aparece. */
  onPaymentDraft: () => void;
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
        className={compact ? "w-60 max-w-full" : "w-full"}
        aria-label={label}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="URL">{TARGET_LABEL.URL}</SelectItem>
        <SelectItem value="CHECKOUT" disabled={!payable}>
          {payable ? TARGET_LABEL.CHECKOUT : `${TARGET_LABEL.CHECKOUT} (só checkout)`}
        </SelectItem>
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
 * `signal` muda a cada pedido (0 = nenhum), então o mesmo link pedido de novo rola de novo.
 */
function useHighlight(signal: number) {
  const ref = useRef<HTMLLIElement>(null);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!signal) return;
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
  }, [signal]);
  return { ref, flash };
}

function LinkRow({
  link,
  payments,
  highlight = 0,
}: {
  link: OfferLinkRow;
  payments: PaymentContext;
  /** Sinal de "rolar até este link e destacar" (0 = nenhum). */
  highlight?: number;
}) {
  const { ref, flash } = useHighlight(highlight);
  const [url, setUrl] = useState(link.url);
  const [label, setLabel] = useState(link.label);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const update = useAction(updateOfferLinkAction);
  const remove = useAction(deleteOfferLinkAction);
  const retarget = useAction(setOfferLinkTargetAction);
  // "Pagamento na página"/"Checkout do Offer Studio" escolhido num link sem o produto: o
  // formulário aparece e só liga ao salvar.
  const [draftTarget, setDraftTarget] = useState<"PAYMENT" | "CHECKOUT" | null>(null);
  const target: Target = link.target ?? "URL";
  const shown: Target = draftTarget ?? target;
  const isPayment = shown === "PAYMENT";
  const isCheckout = shown === "CHECKOUT";

  function changeTarget(next: Target) {
    setError(null);
    if (next === "CHECKOUT") {
      if (!PAYMENT_KINDS.includes(link.kind)) {
        setError(NOT_CHECKOUT_KIND);
        return;
      }
      if (target === "CHECKOUT") {
        setDraftTarget(null);
        return;
      }
      if (link.checkout) {
        setDraftTarget(null);
        void retarget.run(
          { linkId: link.id, target: "CHECKOUT" },
          { success: "Destino trocado para “Checkout do Offer Studio”." },
        );
      } else setDraftTarget("CHECKOUT");
      return;
    }
    if (next === "PAYMENT") {
      if (!PAYMENT_KINDS.includes(link.kind)) {
        setError(NOT_PAYMENT_KIND);
        return;
      }
      if (target === "PAYMENT") {
        setDraftTarget(null);
        return;
      }
      payments.onPaymentDraft();
      if (link.payment) {
        setDraftTarget(null);
        void retarget.run(
          { linkId: link.id, target: "PAYMENT" },
          { success: "Pronto: os botões ligados a este link abrem a janela de pagamento." },
        );
      } else setDraftTarget("PAYMENT");
      return;
    }
    setDraftTarget(null);
    if (target !== "URL") {
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
        "flex scroll-mt-20 flex-col gap-2 p-4 md:scroll-mt-6 outline-none transition-shadow first:rounded-t-xl last:rounded-b-xl",
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
              <SelectItem key={k} value={k} disabled={(isPayment || isCheckout) && !PAYMENT_KINDS.includes(k)}>
                {KIND_LABEL[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <TargetSelect
          value={shown}
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
        {target === "CHECKOUT" && link.checkout && (
          <Badge variant="secondary" className="gap-1">
            <ShoppingCartIcon aria-hidden="true" />
            {link.checkout.price} · {PROVIDER_LABEL[link.checkout.provider]}
          </Badge>
        )}
        <Badge variant={link.usage || link.prizes ? "secondary" : "outline"}>{usageLabel(link)}</Badge>
        {link.fromClone && !isPayment && !isCheckout && (
          <Badge variant="warning" className="whitespace-normal text-left">
            <TriangleAlertIcon aria-hidden="true" />
            Checkout da página clonada — troque pelo seu
          </Badge>
        )}
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
            offerCurrency={payments.offerCurrency}
            productCurrency={payments.productCurrency}
            gatewayKey={payments.gatewayKey}
            onOpenAccount={payments.openAccount}
            onSaved={() => setDraftTarget(null)}
            onDiscardNew={() => changeTarget("URL")}
          />
        </>
      ) : isCheckout ? (
        <>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <CheckoutProductForm
            offerId={payments.offerId}
            linkId={link.id}
            checkout={link.checkout ?? null}
            pages={payments.pages}
            currency={payments.checkoutCurrency}
            keys={payments.keys}
            onOpenAccount={payments.openProviderAccount}
            onProviderChange={payments.onCheckoutProvider}
            onSaved={() => setDraftTarget(null)}
            onDiscardNew={() => changeTarget("URL")}
            pendingTarget={draftTarget === "CHECKOUT"}
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

/** Conta da Kyvo de uma oferta sem chave (padrão). */
export const NO_PAYMENT_ACCOUNT: PaymentAccountView = {
  provider: "KYVO",
  label: "Kyvo",
  configured: false,
  keyHint: null,
  keyUnreadable: false,
  checkedAt: null,
  checkStatus: null,
};

/** Conta sem chave de um gateway (padrão). */
const noAccount = (provider: PaymentProviderId): PaymentAccountView => ({
  ...NO_PAYMENT_ACCOUNT,
  provider,
  label: PROVIDER_LABEL[provider],
});

/** Links da oferta: um lugar só para trocar o checkout de todas as páginas. */
export function OfferLinks({
  offerId,
  links,
  pages = [],
  offerCurrency = null,
  checkoutCurrency,
  paymentAccount = NO_PAYMENT_ACCOUNT,
  paymentKeySources = [],
  checkoutAccounts = [],
  checkoutKeySources = {},
}: {
  offerId: string;
  links: OfferLinkRow[];
  /** Páginas da oferta (página de obrigado do pagamento na página). */
  pages?: PaymentPageOption[];
  /**
   * Moeda escolhida para a oferta (o produto novo do pagamento na página começa
   * nela). null/sem: oferta de antes da pergunta (real só por padrão).
   */
  offerCurrency?: StoreCurrency | null;
  /** Conta do gateway de pagamento desta oferta (só o final mascarado da chave). */
  paymentAccount?: PaymentAccountView;
  /** Outras ofertas com chave da Kyvo ("Usar a mesma chave de outra oferta"). */
  paymentKeySources?: PaymentKeySource[];
  /**
   * Moeda em que a oferta roda (a do checkout do Offer Studio); sem ela, a
   * escolhida, ou o real (as ofertas de antes da pergunta).
   */
  checkoutCurrency?: StoreCurrency;
  /** Contas da FlevoPay e da BlackCat desta oferta (só o final mascarado da chave). */
  checkoutAccounts?: PaymentAccountView[];
  /** Outras ofertas com chave de cada gateway de PIX. */
  checkoutKeySources?: Partial<Record<PaymentProviderId, PaymentKeySource[]>>;
}) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<Kind>("CHECKOUT");
  const [newTarget, setNewTarget] = useState<Target>("URL");
  // Cartões das contas: abertos por quem pediu (aviso do link, ?conta=…, gateway escolhido no
  // checkout) e o sinal para rolar até cada um.
  const [accountOpen, setAccountOpen] = useState<Partial<Record<PaymentProviderId, boolean>>>({});
  const [accountFocus, setAccountFocus] = useState<Partial<Record<PaymentProviderId, number>>>({});
  const accountOf = (provider: PaymentProviderId): PaymentAccountView =>
    provider === "KYVO"
      ? paymentAccount
      : (checkoutAccounts.find((a) => a.provider === provider) ?? noAccount(provider));
  const openProviderAccount = (provider: PaymentProviderId) => {
    setAccountOpen((o) => ({ ...o, [provider]: true }));
    setAccountFocus((f) => ({ ...f, [provider]: (f[provider] ?? 0) + 1 }));
  };
  const keys: Partial<Record<CheckoutProviderId, PaymentKeyState>> = {
    KYVO: gatewayKeyState(paymentAccount),
    FLEVOPAY: gatewayKeyState(accountOf("FLEVOPAY")),
    BLACKCAT: gatewayKeyState(accountOf("BLACKCAT")),
    CLOWNPAY: gatewayKeyState(accountOf("CLOWNPAY")),
  };
  const payments: PaymentContext = {
    offerId,
    checkoutCurrency: checkoutCurrency ?? offerCurrency ?? "BRL",
    keys,
    openProviderAccount,
    onCheckoutProvider: (provider) => setAccountOpen((o) => ({ ...o, [provider]: true })),
    pages,
    offerCurrency,
    productCurrency: links.find((l) => l.payment)?.payment?.currency ?? null,
    gatewayKey: gatewayKeyState(paymentAccount),
    openAccount: () => openProviderAccount("KYVO"),
    onPaymentDraft: () => setAccountOpen((o) => ({ ...o, KYVO: true })),
  };
  const [error, setError] = useState<string | null>(null);
  const create = useAction(createOfferLinkAction);
  const ids = useId();
  // Fora do roteador do Next (testes da tela), não há parâmetros.
  const params = useSearchParams();
  const focusLink = params?.get(LINK_QUERY_PARAM) ?? null;
  const focusAccount = accountQueryProvider(params?.get(PAYMENT_ACCOUNT_QUERY_PARAM));
  // Pedidos vindos do endereço (?link=, ?conta=) valem uma vez: depois de usados saem do endereço.
  // Assim o mesmo "Abrir o link"/"Abrir a conta da Kyvo" clicado de novo rola de novo, e voltar
  // para a aba mais tarde (outra aba, editor) não pula sozinho para o link ou para o cartão.
  const [linkFocus, setLinkFocus] = useState<{ id: string; n: number } | null>(null);
  useEffect(() => {
    if (!focusLink) return;
    setLinkFocus((prev) => ({ id: focusLink, n: (prev?.n ?? 0) + 1 }));
    replaceQuery({ [LINK_QUERY_PARAM]: null });
  }, [focusLink]);
  useEffect(() => {
    if (!focusAccount) return;
    setAccountOpen((o) => ({ ...o, [focusAccount]: true }));
    setAccountFocus((f) => ({ ...f, [focusAccount]: (f[focusAccount] ?? 0) + 1 }));
    replaceQuery({ [PAYMENT_ACCOUNT_QUERY_PARAM]: null });
  }, [focusAccount]);
  // Quem usa pagamento na página (ou já tem chave) vê o cartão; os outros, só um atalho discreto.
  const usesProvider = (provider: PaymentProviderId) =>
    links.some((l) => l.target === "CHECKOUT" && l.checkout?.provider === provider);
  const showAccount =
    Boolean(accountOpen.KYVO) ||
    paymentAccount.configured ||
    newTarget === "PAYMENT" ||
    links.some((l) => l.target === "PAYMENT" || l.payment) ||
    usesProvider("KYVO");
  // A conta da Kyvo serve ao pagamento na página e ao checkout do Offer Studio em peso, euro ou dólar:
  // o título diz para que ela é usada nesta oferta (sem nada ainda, o do pagamento na página).
  const kyvoCheckout = links.some(
    (l) =>
      l.target === "CHECKOUT" && (l.checkout ? l.checkout.provider === "KYVO" : payments.checkoutCurrency !== "BRL"),
  );
  const kyvoPayment = newTarget === "PAYMENT" || links.some((l) => l.target === "PAYMENT");
  const kyvoTitle = kyvoCheckout
    ? kyvoPayment
      ? "Pagamento na página e checkout do Offer Studio — conta da Kyvo desta oferta"
      : "Checkout do Offer Studio — conta da Kyvo desta oferta"
    : undefined;
  // Contas de PIX do checkout: aparecem para quem usa o gateway, já tem chave ou pediu.
  const pixAccounts = PIX_PROVIDERS.filter((p) => accountOpen[p] || accountOf(p).configured || usesProvider(p));
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
            <LinkRow
              key={link.id}
              link={link}
              payments={payments}
              highlight={linkFocus?.id === link.id ? linkFocus.n : 0}
            />
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
          const payment = newTarget !== "URL";
          const problem = payment ? null : urlError(url);
          if (problem) {
            setError(problem);
            return;
          }
          void create.run(
            { offerId, label: label.trim(), url: payment ? "" : url.trim(), kind, target: newTarget },
            {
              success:
                newTarget === "CHECKOUT"
                  ? "Link criado. Agora monte o checkout: produto, valor e pagamento."
                  : payment
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
          ) : newTarget === "CHECKOUT" ? (
            <p className="text-xs text-muted-foreground sm:pb-2">
              Página de checkout do Offer Studio (PIX em real; Kyvo nas outras moedas). Depois de adicionar, monte o
              checkout: produto, dados pedidos, frete, order bumps e aparência. A página abre na prévia (“Ver checkout”,
              em simulação) e vai no ZIP.
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

      {pixAccounts.map((provider) => (
        <PaymentAccountCard
          key={provider}
          offerId={offerId}
          account={accountOf(provider)}
          sources={checkoutKeySources[provider] ?? []}
          focusSignal={accountFocus[provider] ?? 0}
        />
      ))}

      {showAccount ? (
        <PaymentAccountCard
          offerId={offerId}
          account={paymentAccount}
          sources={paymentKeySources}
          focusSignal={accountFocus.KYVO ?? 0}
          title={kyvoTitle}
        />
      ) : (
        <div>
          {/* Quebra a linha em telas estreitas (sem passar da tela no celular). */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left text-muted-foreground"
            onClick={payments.openAccount}
          >
            <CreditCardIcon />
            Pagamento na página: conta da Kyvo desta oferta
          </Button>
        </div>
      )}
    </div>
  );
}
