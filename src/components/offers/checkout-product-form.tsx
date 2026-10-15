"use client";

/**
 * Produto de um link "Checkout do Offer Studio" (aba "Links e checkouts"): a
 * página de checkout própria do produto, em seções — Produto, Dados do
 * comprador, Endereço e frete, Order bumps, Aparência e Pagamento. Salvar liga
 * o destino no link. Regras em src/lib/checkout (as mesmas da ação, que
 * confere de novo no servidor).
 *
 * A moeda é a da oferta (não é escolhida aqui): em real, PIX pela FlevoPay ou
 * pela BlackCat; nas outras moedas, a Kyvo. Os campos que o gateway exige de
 * quem compra ficam travados, com a explicação.
 */
import {
  ChevronRightIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LockIcon,
  PlusIcon,
  ShoppingCartIcon,
  Trash2Icon,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { ImageUploadField } from "@/components/offers/settings/image-upload-field";
import { Callout } from "@/components/offers/tracking/callout";
import { SaveBar } from "@/components/offers/tracking/form-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { colorReadable } from "@/lib/checkout/colors";
import {
  type CheckoutConfigDraft,
  type CheckoutDraftErrors,
  checkoutConfigDraft,
  checkoutConfigFromDraft,
  DEFAULT_CHECKOUT_COLOR,
  newItemId,
  parseCheckoutConfig,
  staleCheckoutTexts,
} from "@/lib/checkout/config";
import {
  addressAllowed,
  BUYER_FIELDS,
  type BuyerField,
  buyerFieldLabel,
  buyerFieldLock,
  CHECKOUT_LIMITS,
  CHECKOUT_LOCALES,
  CHECKOUT_METHOD_LABEL,
  CHECKOUT_PAGE_NOTE,
  CHECKOUT_PROVIDER_HINT,
  CHECKOUT_PROVIDERS,
  type CheckoutCurrencyId,
  type CheckoutMethodId,
  type CheckoutProductBase,
  type CheckoutProviderId,
  checkoutAmountProblem,
  checkoutBaseProblems,
  checkoutMethodAllows,
  checkoutMethodsFor,
  defaultCheckoutLocale,
  isPixProvider,
  newBuyerFields,
  PROVIDER_CURRENCIES,
  providerAllows,
  providerForCurrency,
} from "@/lib/checkout/rules";
import {
  CHECKOUT_EDITABLE_TEXTS,
  checkoutLang,
  defaultEditableText,
  EDITABLE_TEXT_LABEL,
  editableTextMax,
} from "@/lib/checkout/texts";
import { OFFER_CURRENCY_NAME, offerCurrencyLabel } from "@/lib/offer-currency";
import type { PaymentKeyState } from "@/lib/payments/checks";
import {
  formatAmount,
  LOCALE_LABEL,
  METHOD_HINT,
  PAYMENT_METHODS,
  type PaymentLocaleId,
  PROVIDER_LABEL,
  parseAmount,
} from "@/lib/payments/rules";
import { cn } from "@/lib/utils";
import { checkoutPreviewUrlAction, saveCheckoutProductAction } from "@/server/actions/checkout";

/** Produto do checkout salvo (o que a tela recebe do servidor). */
export interface CheckoutProductValue {
  provider: CheckoutProviderId;
  name: string;
  amount: string;
  price: string;
  currency: CheckoutCurrencyId;
  methods: CheckoutMethodId[];
  locale: PaymentLocaleId;
  thankYouPageId: string | null;
  accessUrl: string;
  config: CheckoutConfigDraft;
}

export interface CheckoutPageOption {
  id: string;
  name: string;
  type: string;
}

type Draft = CheckoutProductBase & { config: CheckoutConfigDraft };

type SectionId = "produto" | "comprador" | "entrega" | "bumps" | "aparencia" | "pagamento";

const NONE = "__nenhuma__";

/** Em que seção fica cada campo (para abrir a seção do erro). */
function sectionOf(path: string): SectionId {
  const head = path.split(".")[0];
  if (["provider", "methods", "locale"].includes(head)) return "pagamento";
  if (head === "fields") return "comprador";
  if (head === "shipping" || head === "address") return "entrega";
  if (head === "bumps") return "bumps";
  if (["bannerDesktop", "bannerMobile", "logo", "color", "timer", "testimonials", "texts", "badges"].includes(head)) {
    return "aparencia";
  }
  return "produto";
}

/** Gateways de PIX com chave salva (o produto novo em real começa num deles). */
function keyedProviders(keys: Partial<Record<CheckoutProviderId, PaymentKeyState>>): CheckoutProviderId[] {
  return CHECKOUT_PROVIDERS.filter((p) => keys[p] === "ok");
}

/** Valores do formulário para um link que ainda não tem produto do checkout. */
export function newCheckoutDraft(
  pages: CheckoutPageOption[],
  currency: CheckoutCurrencyId,
  keys: Partial<Record<CheckoutProviderId, PaymentKeyState>> = {},
): Draft {
  const thankYou = pages.filter((p) => p.type === "THANK_YOU");
  const provider = providerForCurrency(currency, null, keyedProviders(keys));
  return {
    name: "",
    amount: "",
    provider,
    methods: checkoutMethodsFor(provider, currency),
    locale: defaultCheckoutLocale(currency),
    thankYouPageId: thankYou.length === 1 ? thankYou[0].id : null,
    accessUrl: "",
    // Fora do real (Kyvo), só nome e e-mail: telefone e documento começam desligados.
    config: checkoutConfigDraft(parseCheckoutConfig({ fields: newBuyerFields(provider) })),
  };
}

function draftOf(
  value: CheckoutProductValue | null,
  pages: CheckoutPageOption[],
  currency: CheckoutCurrencyId,
  keys: Partial<Record<CheckoutProviderId, PaymentKeyState>>,
): Draft {
  if (!value) return newCheckoutDraft(pages, currency, keys);
  return {
    name: value.name,
    amount: value.amount,
    provider: value.provider,
    methods: value.methods,
    locale: value.locale,
    thankYouPageId: value.thankYouPageId,
    accessUrl: value.accessUrl,
    config: value.config,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Todos os problemas do formulário (colunas + configuração), por caminho do campo. */
function draftProblems(draft: Draft, currency: CheckoutCurrencyId): CheckoutDraftErrors {
  const base = checkoutBaseProblems(draft, currency) as CheckoutDraftErrors;
  const { errors } = checkoutConfigFromDraft(draft.config, currency, parseAmount(draft.amount));
  return { ...base, ...errors };
}

const fieldId = (base: string, path: string) => `${base}-${path.replace(/\./g, "-")}`;

/** "peso mexicano, euro ou dólar". */
const orList = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ou ${items.at(-1)}`;

/** Nome do campo no resumo da seção fechada ("nome, e-mail, WhatsApp e CPF"). */
function buyerSummaryLabel(field: BuyerField, currency: CheckoutCurrencyId): string {
  if (field === "name") return "nome";
  if (field === "email") return "e-mail";
  if (field === "phone") return "WhatsApp";
  return currency === "BRL" ? "CPF" : "documento";
}

/** "a, b e c". */
const andList = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;

/** Título do aviso da chave do gateway no formulário. */
function keyTitle(provider: CheckoutProviderId, state: Exclude<PaymentKeyState, "ok">) {
  const label = PROVIDER_LABEL[provider];
  if (state === "missing") return `Falta a chave da ${label} desta oferta`;
  if (state === "unreadable") return `Cole de novo a chave da ${label}`;
  if (state === "rejected") return `A ${label} recusou a chave`;
  return provider === "KYVO"
    ? "A chave da Kyvo não tem a permissão transactions:read"
    : `A ${label} não liberou a conta`;
}

/** Seção que abre e fecha (o título é um botão dentro de um h4, como num acordeão). */
function FormSection({
  title,
  summary,
  open,
  onOpenChange,
  errors,
  children,
}: {
  title: string;
  summary: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  errors: number;
  children: ReactNode;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-lg border bg-background">
      <h4 className="m-0">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg p-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <ChevronRightIcon
              className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
              aria-hidden="true"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium text-sm">{title}</span>
              {!open && <span className="truncate font-normal text-muted-foreground text-xs">{summary}</span>}
            </span>
            {errors > 0 && (
              <Badge variant="destructive" className="shrink-0">
                {errors === 1 ? "1 ajuste" : `${errors} ajustes`}
              </Badge>
            )}
          </button>
        </CollapsibleTrigger>
      </h4>
      <CollapsibleContent className="flex flex-col gap-5 border-t p-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** Campo de texto com rótulo, ajuda e erro (o id segue o caminho do campo, para o foco do erro). */
function TextField({
  id,
  label,
  value,
  onChange,
  error,
  help,
  placeholder,
  maxLength,
  inputMode,
  className,
  mono,
  multiline,
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  help?: ReactNode;
  placeholder?: string;
  maxLength?: number;
  inputMode?: "decimal" | "url" | "numeric" | "text";
  className?: string;
  mono?: boolean;
  multiline?: boolean;
}) {
  return (
    <Field data-invalid={Boolean(error)} className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {multiline ? (
        <Textarea
          id={id}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          aria-invalid={Boolean(error)}
          rows={2}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          inputMode={inputMode}
          className={cn(mono && "font-mono text-xs")}
          aria-invalid={Boolean(error)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {error ? <FieldError>{error}</FieldError> : help ? <FieldDescription>{help}</FieldDescription> : null}
    </Field>
  );
}

/** Ajuda do campo de acesso privado (fica no servidor, só para quem pagou). */
const PRIVATE_ACCESS_HELP = (
  <span className="flex items-start gap-1.5">
    <LockIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
    Área de membros, arquivo ou grupo. Fica guardado no servidor e só é entregue a quem pagou: não aparece no HTML.
  </span>
);

export function CheckoutProductForm({
  offerId,
  linkId,
  checkout,
  pages,
  currency,
  keys,
  onOpenAccount,
  onProviderChange,
  onSaved,
  onDiscardNew,
  pendingTarget = false,
}: {
  offerId: string;
  linkId: string;
  checkout: CheckoutProductValue | null;
  pages: CheckoutPageOption[];
  /** Moeda em que a oferta roda (a do checkout). */
  currency: CheckoutCurrencyId;
  /** Estado da chave de cada gateway desta oferta (cartões da conta, na mesma aba). */
  keys: Partial<Record<CheckoutProviderId, PaymentKeyState>>;
  /** Abre o cartão da conta do gateway (rola até ele, com a chave em foco). */
  onOpenAccount?: (provider: CheckoutProviderId) => void;
  /** O gateway escolhido mudou (o cartão da conta dele aparece na aba). */
  onProviderChange?: (provider: CheckoutProviderId) => void;
  onSaved?: () => void;
  /** "Descartar" num link que ainda não tem produto (volta o destino para endereço). */
  onDiscardNew?: () => void;
  /**
   * O destino "Checkout do Offer Studio" foi escolhido agora e só vale ao
   * salvar (sair pergunta antes). Link já gravado como checkout e ainda sem
   * produto: sair não pergunta (nada foi mudado; o aviso no topo diz o que
   * falta), mas a barra de salvar fica ligada.
   */
  pendingTarget?: boolean;
}) {
  const id = useId();
  const initial = draftOf(checkout, pages, currency, keys);
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  // O produto salvo mudou fora daqui (outra aba, troca da moeda): sem nada digitado, mostra o novo.
  const initialKey = JSON.stringify(initial);
  const [seenKey, setSeenKey] = useState(initialKey);
  if (initialKey !== seenKey) {
    setSeenKey(initialKey);
    setBaseline(initial);
    if (same(draft, baseline)) setDraft(initial);
  }
  const [errors, setErrors] = useState<CheckoutDraftErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<SectionId, boolean>>({
    produto: !checkout,
    comprador: false,
    entrega: false,
    bumps: false,
    aparencia: false,
    pagamento: !checkout,
  });
  const save = useAction(saveCheckoutProductAction);
  const preview = useAction(checkoutPreviewUrlAction);
  /** "Ver checkout": a página de checkout salva, numa aba nova (prévia em simulação). */
  async function openPreview() {
    const res = await preview.run({ linkId });
    if (res.ok) window.open(res.data.url, "_blank", "noopener");
  }
  // Sem produto ainda, a barra fica ligada (o link só vira checkout ao salvar), mas só pergunta
  // antes de sair quando algo mudou de verdade: o destino escolhido agora ou o formulário.
  const changed = pendingTarget || !same(draft, baseline);
  const dirty = !checkout || changed;
  const config = draft.config;
  const pix = isPixProvider(draft.provider);
  const lang = checkoutLang(draft.locale);

  /** Tira os erros do campo (e, sem `exact`, os dos itens dentro dele: "bumps" leva "bumps.0.price"). */
  function clearErrors(prefix: string, exact = false) {
    setErrors((e) => {
      const next: CheckoutDraftErrors = {};
      for (const [k, v] of Object.entries(e)) {
        if (k !== prefix && (exact || !k.startsWith(`${prefix}.`))) next[k] = v;
      }
      return next;
    });
  }

  function patch(changes: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...changes }));
    for (const k of Object.keys(changes)) clearErrors(k);
    // O erro do maior total (o servidor põe em "bumps" ou "shipping") depende do valor e do pagamento.
    if ("amount" in changes || "provider" in changes || "methods" in changes) {
      clearErrors("bumps", true);
      clearErrors("shipping", true);
    }
  }

  /**
   * Muda a configuração. `exact`: só o erro do próprio campo sai (editar um item
   * de uma lista não apaga os erros dos outros itens; quem edita limpa o dele).
   */
  function patchConfig(changes: Partial<CheckoutConfigDraft>, exact = false) {
    setDraft((d) => ({ ...d, config: { ...d.config, ...changes } }));
    for (const k of Object.keys(changes)) {
      clearErrors(k === "imageSrc" ? "image" : k.replace(/Src$/, ""), exact);
    }
  }

  function changeProvider(provider: CheckoutProviderId) {
    patch({ provider, methods: checkoutMethodsFor(provider, currency, draft.methods) });
    onProviderChange?.(provider);
  }

  function toggleMethod(method: CheckoutMethodId, on: boolean) {
    const methods = on ? [...draft.methods, method] : draft.methods.filter((m) => m !== method);
    patch({ methods: (["PIX", ...PAYMENT_METHODS] as CheckoutMethodId[]).filter((m) => methods.includes(m)) });
  }

  function focusFirst(problems: CheckoutDraftErrors) {
    const first = Object.keys(problems)[0];
    if (!first) return;
    const section = sectionOf(first);
    setOpen((o) => ({ ...o, [section]: true }));
    // A seção abre no próximo quadro: só então o campo existe.
    requestAnimationFrame(() => {
      const el =
        document.getElementById(fieldId(id, first)) ?? document.getElementById(fieldId(id, first.split(".")[0]));
      el?.focus();
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const problems = draftProblems(draft, currency);
    if (Object.keys(problems).length) {
      setErrors(problems);
      setOpen((o) => {
        const next = { ...o };
        for (const k of Object.keys(problems)) next[sectionOf(k)] = true;
        return next;
      });
      focusFirst(problems);
      return;
    }
    void save.run(
      { linkId, ...draft, thankYouPageId: draft.thankYouPageId || null },
      {
        success: "Checkout salvo.",
        silentError: true,
        onError: (message, field) => {
          if (field) {
            const problems = { [field]: message };
            setErrors(problems);
            focusFirst(problems);
          } else setFormError(message);
        },
        onSuccess: (saved) => {
          const next = draftOf(saved, pages, currency, keys);
          setBaseline(next);
          setDraft(next);
          setErrors({});
          onSaved?.();
        },
      },
    );
  }

  const errorsIn = (section: SectionId) => Object.keys(errors).filter((k) => sectionOf(k) === section).length;
  const cents = parseAmount(draft.amount);
  const shippingMax = Math.max(0, ...config.shipping.map((s) => parseAmount(s.price) ?? 0));
  const bumpsTotal = config.bumps.reduce((n, b) => n + (parseAmount(b.price) ?? 0), 0);
  const maxTotal = cents !== null ? cents + bumpsTotal + (config.address ? shippingMax : 0) : null;
  const maxProblem =
    maxTotal !== null && maxTotal !== cents
      ? checkoutAmountProblem(maxTotal, draft.provider, currency, draft.methods)
      : null;
  const keyState = keys[draft.provider] ?? "missing";
  const providerProblem = errors.provider;
  const thankYouName = pages.find((p) => p.id === draft.thankYouPageId)?.name;
  // Endereço e frete só no real (o CEP é do Brasil).
  const addressOk = addressAllowed(currency);
  const paidShippingOff = addressOk && !config.address && config.shipping.some((s) => (parseAmount(s.price) ?? 0) > 0);
  // O frete marcado: o escolhido, se ainda existe; senão o primeiro (como o servidor salva).
  const shippingDefault = config.shipping.some((s) => s.id === config.shippingDefault)
    ? config.shippingDefault
    : (config.shipping[0]?.id ?? null);
  const bumpsWithoutAccess = config.bumps.filter((b) => !b.accessUrl.trim());
  // Os textos trocados foram escritos para outro idioma ou pagamento (a moeda da oferta mudou depois).
  const staleTexts = staleCheckoutTexts(config, draft.locale, draft.provider);
  const f = (path: string) => fieldId(id, path);

  // Resumos das seções fechadas.
  const asked = BUYER_FIELDS.filter((x) => config.fields[x] || buyerFieldLock(draft.provider, x)).map((x) =>
    buyerSummaryLabel(x, currency),
  );
  const summaries: Record<SectionId, string> = {
    produto: [draft.name || "Sem nome", cents !== null ? formatAmount(cents, currency) : "sem valor"].join(" · "),
    comprador: `Pede ${andList(asked)}`,
    entrega: !addressOk
      ? config.address
        ? "Endereço ligado (só existe no checkout em real)"
        : "Sem endereço (só existe no checkout em real)"
      : config.address
        ? `Endereço ligado · ${config.shipping.length} ${config.shipping.length === 1 ? "opção de frete" : "opções de frete"}`
        : "Sem endereço (produto digital)",
    bumps: config.bumps.length
      ? [
          `${config.bumps.length} ${config.bumps.length === 1 ? "order bump" : "order bumps"}`,
          bumpsWithoutAccess.length
            ? `${bumpsWithoutAccess.length === 1 ? "1 sem" : `${bumpsWithoutAccess.length} sem`} link de acesso`
            : "",
        ]
          .filter(Boolean)
          .join(" · ")
      : "Nenhum order bump",
    aparencia: [
      config.bannerDesktopSrc || config.bannerMobileSrc ? "com banner" : "sem banner",
      config.timer.trim() ? `cronômetro de ${config.timer.trim()} min` : "sem cronômetro",
      config.testimonials.length
        ? `${config.testimonials.length} ${config.testimonials.length === 1 ? "depoimento" : "depoimentos"}`
        : "",
    ]
      .filter(Boolean)
      .join(" · "),
    pagamento: `${PROVIDER_LABEL[draft.provider]} · ${draft.methods.map((m) => CHECKOUT_METHOD_LABEL[m]).join(", ")}`,
  };
  const sectionProps = (s: SectionId) => ({
    open: open[s],
    onOpenChange: (v: boolean) => setOpen((o) => ({ ...o, [s]: v })),
    errors: errorsIn(s),
    summary: summaries[s],
  });

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Produto do checkout do Offer Studio"
      className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4"
    >
      <div className="flex items-start gap-2 text-muted-foreground text-sm">
        <ShoppingCartIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          Aqui você monta a página de checkout do Offer Studio deste link: quem comprar preenche os dados, escolhe os
          extras e paga {pix ? "com PIX" : `com a ${PROVIDER_LABEL[draft.provider]}`}. O valor é sempre calculado no
          servidor (produto + order bumps + frete).
        </p>
      </div>

      <Callout
        variant="info"
        title="Página de checkout"
        action={
          checkout && !pendingTarget ? (
            <Button type="button" variant="outline" size="sm" onClick={openPreview} disabled={preview.pending}>
              <ExternalLinkIcon />
              Ver checkout
            </Button>
          ) : undefined
        }
      >
        {CHECKOUT_PAGE_NOTE}{" "}
        {checkout && !pendingTarget
          ? changed
            ? "“Ver checkout” mostra o que já está salvo: salve antes para ver as mudanças."
            : "Use “Ver checkout” para ver e testar a página."
          : "Salve o checkout para ver a página."}
      </Callout>

      {!checkout && !pendingTarget && (
        <Callout variant="warning" title="Este link ainda não tem o checkout salvo">
          Preencha o produto e clique em “Salvar e ligar o checkout”. Até lá, o link não leva a lugar nenhum.
        </Callout>
      )}

      {staleTexts && (
        <Callout variant="warning" title="Revise os textos trocados">
          Os textos que você trocou em “Aparência → Textos” foram escritos para o checkout{" "}
          {config.textsFor
            ? `em ${LOCALE_LABEL[config.textsFor.locale]}${config.textsFor.pix ? " com PIX" : ""}`
            : "de antes"}
          , e agora ele está em {LOCALE_LABEL[draft.locale]}
          {pix ? " com PIX" : ` pela ${PROVIDER_LABEL[draft.provider]}`} (a moeda da oferta mudou). Revise-os (ou apague
          para usar os padrões) e salve.
        </Callout>
      )}

      {keyState !== "ok" && !providerProblem && providerAllows(draft.provider, currency) && (
        <Callout
          variant="warning"
          title={keyTitle(draft.provider, keyState)}
          action={
            onOpenAccount && (
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenAccount(draft.provider)}>
                <KeyRoundIcon />
                {keyState === "missing"
                  ? "Cadastrar a chave desta oferta"
                  : `Abrir a conta da ${PROVIDER_LABEL[draft.provider]} desta oferta`}
              </Button>
            )
          }
        >
          Você já pode montar o checkout, mas para receber de verdade{" "}
          {keyState === "missing"
            ? `cadastre a chave da API da ${PROVIDER_LABEL[draft.provider]} desta oferta (ou use a mesma de outra oferta).`
            : keyState === "unreadable"
              ? "cole a chave de novo (ela não pode mais ser lida neste Mac)."
              : keyState === "no_scope" && pix
                ? `espere a ${PROVIDER_LABEL[draft.provider]} liberar a conta (a chave é válida) e clique em “Testar conexão” de novo.`
                : "troque a chave e teste a conexão de novo."}
        </Callout>
      )}

      <FormSection title="Produto" {...sectionProps("produto")}>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id={f("name")}
            className="sm:col-span-2"
            label="Nome do produto"
            value={draft.name}
            maxLength={CHECKOUT_LIMITS.name}
            placeholder="Curso Completo de Confeitaria"
            error={errors.name}
            help="Aparece no resumo do pedido."
            onChange={(v) => patch({ name: v })}
          />
          <TextField
            id={f("amount")}
            label="Valor"
            value={draft.amount}
            inputMode="decimal"
            placeholder="97,00"
            error={errors.amount}
            help={
              cents !== null && cents > 0 ? `O comprador paga ${formatAmount(cents, currency)}.` : "Com vírgula: 97,00."
            }
            onChange={(v) => patch({ amount: v })}
          />
          <TextField
            id={f("compareAt")}
            label={
              <>
                Preço “de” <span className="font-normal text-muted-foreground">(opcional)</span>
              </>
            }
            value={config.compareAt}
            inputMode="decimal"
            placeholder="197,00"
            error={errors.compareAt}
            help="Aparece riscado ao lado do preço."
            onChange={(v) => patchConfig({ compareAt: v })}
          />
          <p className="text-muted-foreground text-xs sm:col-span-2">
            Moeda: <strong className="text-foreground">{offerCurrencyLabel(currency)}</strong>, a da oferta. Para cobrar
            em outra moeda, troque a moeda da oferta em “Moeda, empresa e SEO”.
          </p>
          <TextField
            id={f("description")}
            className="sm:col-span-2"
            label={
              <>
                Descrição curta <span className="font-normal text-muted-foreground">(opcional)</span>
              </>
            }
            value={config.description}
            maxLength={CHECKOUT_LIMITS.description}
            placeholder="Acesso vitalício a 40 aulas e aos materiais."
            error={errors.description}
            multiline
            onChange={(v) => patchConfig({ description: v })}
          />
        </div>
        <ImageUploadField
          offerId={offerId}
          label="Foto do produto"
          description="Quadrada fica melhor (aparece no resumo do pedido)."
          value={config.imageSrc}
          onChange={(src) => patchConfig({ imageSrc: src })}
          error={errors.image}
          shape="square"
        />
        <Field className="sm:max-w-xs">
          <FieldLabel htmlFor={f("maxQuantity")}>Quantidade máxima por compra</FieldLabel>
          <Input
            id={f("maxQuantity")}
            type="number"
            inputMode="numeric"
            min={1}
            max={CHECKOUT_LIMITS.quantityMax}
            value={config.maxQuantity}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              patchConfig({
                maxQuantity: Number.isFinite(n) ? Math.min(Math.max(n, 1), CHECKOUT_LIMITS.quantityMax) : 1,
              });
            }}
          />
          <FieldDescription>
            O comprador escolhe de 1 até esse número (com um seletor “− 1 +” no resumo). Deixe em 1 para não mostrar o
            seletor.
          </FieldDescription>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.thankYouPageId)}>
            <FieldLabel htmlFor={f("thankYouPageId")}>Página de obrigado</FieldLabel>
            <Select
              value={draft.thankYouPageId ?? NONE}
              onValueChange={(v) => patch({ thankYouPageId: v === NONE ? null : v })}
            >
              <SelectTrigger id={f("thankYouPageId")} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— escolha a página —</SelectItem>
                {pages.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.thankYouPageId ? (
              <FieldError>{errors.thankYouPageId}</FieldError>
            ) : (
              <FieldDescription>
                {thankYouName
                  ? `Depois do pagamento aprovado, o comprador vai para “${thankYouName}”.`
                  : "Para onde o comprador vai depois do pagamento aprovado."}
              </FieldDescription>
            )}
          </Field>
          <TextField
            id={f("accessUrl")}
            label="Link de acesso ao produto"
            value={draft.accessUrl}
            inputMode="url"
            placeholder="https://area-de-membros.com/curso"
            mono
            error={errors.accessUrl}
            help={PRIVATE_ACCESS_HELP}
            onChange={(v) => patch({ accessUrl: v })}
          />
        </div>
      </FormSection>

      <FormSection title="Dados do comprador" {...sectionProps("comprador")}>
        <p className="text-muted-foreground text-sm">
          Escolha o que o checkout pede de quem compra.
          {buyerFieldLock(draft.provider, "name") && (
            <>
              {" "}
              <span className="inline-flex items-center gap-1 text-foreground">
                <LockIcon className="size-3" aria-hidden="true" />
                {buyerFieldLock(draft.provider, "name")}
              </span>
            </>
          )}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {BUYER_FIELDS.map((field: BuyerField) => {
            const lock = buyerFieldLock(draft.provider, field);
            const checked = Boolean(lock) || config.fields[field];
            return (
              <label
                key={field}
                htmlFor={f(`fields.${field}`)}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border bg-card p-3",
                  lock && "cursor-not-allowed",
                  checked && "border-primary/60",
                )}
              >
                {/* Caixa nativa: a do Radix, dentro de um <form>, cria um campo escondido que não hidrata igual. */}
                <input
                  type="checkbox"
                  id={f(`fields.${field}`)}
                  checked={checked}
                  disabled={Boolean(lock)}
                  onChange={(e) => patchConfig({ fields: { ...config.fields, [field]: e.target.checked } })}
                  className="mt-0.5 size-4 shrink-0 accent-primary disabled:cursor-not-allowed"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 font-medium text-sm">
                    {buyerFieldLabel(field, currency)}
                    {lock && <LockIcon className="size-3 text-muted-foreground" aria-hidden="true" />}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {lock
                      ? `Sempre pedido: a ${PROVIDER_LABEL[draft.provider]} exige.`
                      : field === "document" && currency === "BRL"
                        ? "Conferido pelos dígitos verificadores."
                        : field === "phone" && currency === "BRL"
                          ? "Com DDD; a página põe a máscara."
                          : "Pode ligar ou desligar."}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </FormSection>

      <FormSection title="Endereço e frete" {...sectionProps("entrega")}>
        {!addressOk && (
          <p className="text-muted-foreground text-sm">
            O endereço de entrega (com a busca do CEP) e o frete só existem no checkout em real: em{" "}
            {OFFER_CURRENCY_NAME[currency]}, o checkout não pede endereço.
            {config.shipping.length > 0 &&
              ` ${config.shipping.length === 1 ? "A opção de frete cadastrada fica guardada" : "As opções de frete cadastradas ficam guardadas"} para quando a oferta voltar ao real.`}
          </p>
        )}
        {/* Fora do real o liga/desliga só aparece ligado (veio de um backup): para desligar. */}
        {(addressOk || config.address) && (
          <Field data-invalid={Boolean(errors.address)}>
            <label htmlFor={f("address")} className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                id={f("address")}
                checked={config.address}
                onChange={(e) => {
                  const on = e.target.checked;
                  patchConfig({
                    address: on,
                    ...(on && !config.shipping.length
                      ? {
                          shipping: [{ id: newItemId(), name: "Frete grátis", eta: "", price: "" }],
                          shippingDefault: null,
                        }
                      : {}),
                  });
                }}
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium text-sm">Pedir o endereço de entrega</span>
                <span className="text-muted-foreground text-xs">
                  Para produto físico. Quem compra digita o CEP e a rua, o bairro, a cidade e o estado se preenchem
                  sozinhos; se a busca do CEP falhar, dá para digitar tudo.
                </span>
              </span>
            </label>
            {errors.address && <FieldError>{errors.address}</FieldError>}
          </Field>
        )}
        {paidShippingOff && (
          <Callout variant="warning">
            O endereço está desligado: as opções de frete abaixo não aparecem nem são cobradas. Ligue o endereço ou
            apague o frete pago.
          </Callout>
        )}
        {addressOk && (config.address || config.shipping.length > 0) && (
          <fieldset className="flex flex-col gap-3" aria-describedby={f("shipping")}>
            <legend className="mb-1 font-medium text-sm">Opções de frete</legend>
            <p id={f("shipping")} tabIndex={-1} className="text-muted-foreground text-xs outline-none">
              Quem compra escolhe uma. A marcada em “Já vem escolhida” abre selecionada. Preço vazio = grátis.
            </p>
            {errors.shipping && (
              <p role="alert" className="text-destructive text-sm">
                {errors.shipping}
              </p>
            )}
            {config.shipping.map((s, i) => {
              const update = (changes: Partial<typeof s>) => {
                patchConfig({ shipping: config.shipping.map((x, j) => (j === i ? { ...x, ...changes } : x)) }, true);
                for (const k of Object.keys(changes)) clearErrors(`shipping.${i}.${k}`);
              };
              const isDefault = shippingDefault === s.id;
              return (
                <div key={s.id} className="grid gap-3 rounded-md border bg-card p-3 sm:grid-cols-[1fr_1fr_8rem_auto]">
                  <TextField
                    id={f(`shipping.${i}.name`)}
                    label="Nome"
                    value={s.name}
                    maxLength={CHECKOUT_LIMITS.shippingName}
                    placeholder="Correios PAC"
                    error={errors[`shipping.${i}.name`]}
                    onChange={(v) => update({ name: v })}
                  />
                  <TextField
                    id={f(`shipping.${i}.eta`)}
                    label="Prazo"
                    value={s.eta}
                    maxLength={CHECKOUT_LIMITS.shippingEta}
                    placeholder="5 a 9 dias úteis"
                    error={errors[`shipping.${i}.eta`]}
                    onChange={(v) => update({ eta: v })}
                  />
                  <TextField
                    id={f(`shipping.${i}.price`)}
                    label="Preço"
                    value={s.price}
                    inputMode="decimal"
                    placeholder="Grátis"
                    error={errors[`shipping.${i}.price`]}
                    onChange={(v) => update({ price: v })}
                  />
                  <div className="flex items-end gap-2 sm:flex-col sm:items-start sm:justify-end">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name={f("shippingDefault")}
                        checked={isDefault}
                        onChange={() => patchConfig({ shippingDefault: s.id }, true)}
                        className="size-4 accent-primary"
                      />
                      Já vem escolhida
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Apagar o frete ${s.name || i + 1}`}
                      onClick={() =>
                        patchConfig({
                          shipping: config.shipping.filter((_, j) => j !== i),
                          // Apagou a marcada: a primeira que sobra passa a vir escolhida.
                          ...(isDefault ? { shippingDefault: null } : {}),
                        })
                      }
                    >
                      <Trash2Icon />
                      Apagar
                    </Button>
                  </div>
                </div>
              );
            })}
            {config.shipping.length < CHECKOUT_LIMITS.shipping && (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    patchConfig({ shipping: [...config.shipping, { id: newItemId(), name: "", eta: "", price: "" }] })
                  }
                >
                  <PlusIcon />
                  Adicionar opção de frete
                </Button>
              </div>
            )}
          </fieldset>
        )}
      </FormSection>

      <FormSection title="Order bumps" {...sectionProps("bumps")}>
        <p id={f("bumps")} tabIndex={-1} className="text-muted-foreground text-sm outline-none">
          Ofertas extras com uma caixa “Sim, quero adicionar” logo antes do pagamento (até {CHECKOUT_LIMITS.bumps}). O
          valor entra no total na hora.
        </p>
        {errors.bumps && (
          <p role="alert" className="text-destructive text-sm">
            {errors.bumps}
          </p>
        )}
        {config.bumps.map((b, i) => {
          const update = (changes: Partial<typeof b>) => {
            patchConfig({ bumps: config.bumps.map((x, j) => (j === i ? { ...x, ...changes } : x)) }, true);
            for (const k of Object.keys(changes)) clearErrors(`bumps.${i}.${k === "imageSrc" ? "image" : k}`);
          };
          return (
            <div key={b.id} className="flex flex-col gap-4 rounded-md border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">Order bump {i + 1}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Apagar o order bump ${b.title || i + 1}`}
                  onClick={() => patchConfig({ bumps: config.bumps.filter((_, j) => j !== i) })}
                >
                  <Trash2Icon />
                  Apagar
                </Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  id={f(`bumps.${i}.title`)}
                  className="sm:col-span-2"
                  label="Título"
                  value={b.title}
                  maxLength={CHECKOUT_LIMITS.bumpTitle}
                  placeholder="Apostila com 50 receitas"
                  error={errors[`bumps.${i}.title`]}
                  onChange={(v) => update({ title: v })}
                />
                <TextField
                  id={f(`bumps.${i}.description`)}
                  className="sm:col-span-2"
                  label={
                    <>
                      Descrição curta <span className="font-normal text-muted-foreground">(opcional)</span>
                    </>
                  }
                  value={b.description}
                  maxLength={CHECKOUT_LIMITS.bumpDescription}
                  error={errors[`bumps.${i}.description`]}
                  multiline
                  onChange={(v) => update({ description: v })}
                />
                <TextField
                  id={f(`bumps.${i}.price`)}
                  label="Preço"
                  value={b.price}
                  inputMode="decimal"
                  placeholder="27,00"
                  error={errors[`bumps.${i}.price`]}
                  onChange={(v) => update({ price: v })}
                />
                <TextField
                  id={f(`bumps.${i}.compareAt`)}
                  label={
                    <>
                      Preço “de” <span className="font-normal text-muted-foreground">(opcional)</span>
                    </>
                  }
                  value={b.compareAt}
                  inputMode="decimal"
                  placeholder="47,00"
                  error={errors[`bumps.${i}.compareAt`]}
                  onChange={(v) => update({ compareAt: v })}
                />
                <TextField
                  id={f(`bumps.${i}.accessUrl`)}
                  className="sm:col-span-2"
                  label="Link de acesso do bump"
                  value={b.accessUrl}
                  inputMode="url"
                  placeholder="https://drive.google.com/…"
                  mono
                  error={errors[`bumps.${i}.accessUrl`]}
                  help={PRIVATE_ACCESS_HELP}
                  onChange={(v) => update({ accessUrl: v })}
                />
              </div>
              <ImageUploadField
                offerId={offerId}
                label={`Imagem do order bump ${i + 1}`}
                value={b.imageSrc}
                onChange={(src) => update({ imageSrc: src })}
                error={errors[`bumps.${i}.image`]}
                shape="square"
              />
            </div>
          );
        })}
        {config.bumps.length < CHECKOUT_LIMITS.bumps && (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                patchConfig({
                  bumps: [
                    ...config.bumps,
                    {
                      id: newItemId(),
                      title: "",
                      description: "",
                      price: "",
                      compareAt: "",
                      imageSrc: null,
                      accessUrl: "",
                    },
                  ],
                })
              }
            >
              <PlusIcon />
              Adicionar order bump
            </Button>
          </div>
        )}
        {maxTotal !== null && maxTotal !== cents && (
          <p className={cn("text-xs", maxProblem ? "font-medium text-destructive" : "text-muted-foreground")}>
            Com todos os order bumps{config.address && shippingMax > 0 ? " e o frete mais caro" : ""}, o total fica em{" "}
            {formatAmount(maxTotal, currency)}.{maxProblem ? ` ${maxProblem}` : ""}
          </p>
        )}
      </FormSection>

      <FormSection title="Aparência" {...sectionProps("aparencia")}>
        <div className="grid gap-5 lg:grid-cols-2">
          <ImageUploadField
            offerId={offerId}
            label="Banner do computador"
            description="Faixa larga no topo (ex.: 1200 × 300). Opcional."
            value={config.bannerDesktopSrc}
            onChange={(src) => patchConfig({ bannerDesktopSrc: src })}
            error={errors.bannerDesktop}
            shape="wide"
          />
          <ImageUploadField
            offerId={offerId}
            label="Banner do celular"
            description="Menos larga, para a tela estreita (ex.: 800 × 400). Sem ele, vale o do computador."
            value={config.bannerMobileSrc}
            onChange={(src) => patchConfig({ bannerMobileSrc: src })}
            error={errors.bannerMobile}
            shape="wide"
          />
        </div>
        <ImageUploadField
          offerId={offerId}
          label="Logo"
          description="No topo da página. Opcional."
          value={config.logoSrc}
          onChange={(src) => patchConfig({ logoSrc: src })}
          error={errors.logo}
          shape="square"
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={Boolean(errors.color)}>
            <FieldLabel htmlFor={f("color")}>Cor principal</FieldLabel>
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label="Escolher a cor principal"
                value={/^#[0-9a-f]{6}$/i.test(config.color) ? config.color : DEFAULT_CHECKOUT_COLOR}
                onChange={(e) => patchConfig({ color: e.target.value })}
                className="h-9 w-12 shrink-0 cursor-pointer rounded-md border bg-transparent p-1"
              />
              <Input
                id={f("color")}
                value={config.color}
                maxLength={7}
                className="font-mono"
                aria-invalid={Boolean(errors.color)}
                onChange={(e) => patchConfig({ color: e.target.value })}
              />
            </div>
            {errors.color ? (
              <FieldError>{errors.color}</FieldError>
            ) : !colorReadable(config.color) ? (
              <FieldDescription className="text-amber-700 dark:text-amber-400">
                Com esta cor, o texto do botão de pagar fica difícil de ler (pouco contraste, principalmente no celular
                ao sol). Escolha um tom mais escuro ou mais claro.
              </FieldDescription>
            ) : (
              <FieldDescription>
                Botão de pagar e destaques (o texto fica branco ou escuro, o que ler melhor).
              </FieldDescription>
            )}
          </Field>
          <TextField
            id={f("timer")}
            label={
              <>
                Cronômetro no topo <span className="font-normal text-muted-foreground">(minutos)</span>
              </>
            }
            value={config.timer}
            inputMode="numeric"
            placeholder="Desligado"
            error={errors.timer}
            help={
              config.timer.trim()
                ? `“${defaultEditableText(lang, "timerText")} ${config.timer.trim().padStart(2, "0")}:00”, contando a partir de quando a pessoa abre. Ao zerar, a faixa some.`
                : "Vazio = sem cronômetro. Ex.: 10."
            }
            onChange={(v) => patchConfig({ timer: v.replace(/\D+/g, "").slice(0, 3) })}
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium text-sm">Selos</legend>
          {(["secure", "guarantee"] as const).map((badge) => (
            <label key={badge} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={config.badges[badge]}
                onChange={(e) => patchConfig({ badges: { ...config.badges, [badge]: e.target.checked } })}
                className="size-4 accent-primary"
              />
              Mostrar “
              {config.texts[badge === "secure" ? "badgeSecure" : "badgeGuarantee"]?.trim() ||
                defaultEditableText(lang, badge === "secure" ? "badgeSecure" : "badgeGuarantee")}
              ”
            </label>
          ))}
          <p className="text-muted-foreground text-xs">O texto dos selos se troca em “Textos”, abaixo.</p>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-medium text-sm">Depoimentos</legend>
          <p className="text-muted-foreground text-xs">Até {CHECKOUT_LIMITS.testimonials}, abaixo do pagamento.</p>
          {config.testimonials.map((t, i) => {
            const update = (changes: Partial<typeof t>) => {
              patchConfig(
                { testimonials: config.testimonials.map((x, j) => (j === i ? { ...x, ...changes } : x)) },
                true,
              );
              for (const k of Object.keys(changes)) clearErrors(`testimonials.${i}.${k === "photoSrc" ? "photo" : k}`);
            };
            return (
              <div key={t.id} className="flex flex-col gap-3 rounded-md border bg-card p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm">Depoimento {i + 1}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Apagar o depoimento ${i + 1}`}
                    onClick={() => patchConfig({ testimonials: config.testimonials.filter((_, j) => j !== i) })}
                  >
                    <Trash2Icon />
                    Apagar
                  </Button>
                </div>
                <TextField
                  id={f(`testimonials.${i}.text`)}
                  label="Texto"
                  value={t.text}
                  maxLength={CHECKOUT_LIMITS.testimonialText}
                  multiline
                  error={errors[`testimonials.${i}.text`]}
                  onChange={(v) => update({ text: v })}
                />
                <TextField
                  id={f(`testimonials.${i}.name`)}
                  label="Nome"
                  value={t.name}
                  maxLength={CHECKOUT_LIMITS.testimonialName}
                  placeholder="Ana, de Curitiba"
                  error={errors[`testimonials.${i}.name`]}
                  onChange={(v) => update({ name: v })}
                />
                <ImageUploadField
                  offerId={offerId}
                  label={`Foto do depoimento ${i + 1}`}
                  value={t.photoSrc}
                  onChange={(src) => update({ photoSrc: src })}
                  error={errors[`testimonials.${i}.photo`]}
                  shape="square"
                />
              </div>
            );
          })}
          {config.testimonials.length < CHECKOUT_LIMITS.testimonials && (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patchConfig({
                    testimonials: [...config.testimonials, { id: newItemId(), text: "", name: "", photoSrc: null }],
                  })
                }
              >
                <PlusIcon />
                Adicionar depoimento
              </Button>
            </div>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 font-medium text-sm">Textos</legend>
          <p className="text-muted-foreground text-xs">
            Vazio = o texto padrão em {LOCALE_LABEL[draft.locale]} (o que aparece em cinza).
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {CHECKOUT_EDITABLE_TEXTS.map((k) => (
              <TextField
                key={k}
                id={f(`texts.${k}`)}
                label={EDITABLE_TEXT_LABEL[k]}
                value={config.texts[k] ?? ""}
                maxLength={editableTextMax(k)}
                placeholder={defaultEditableText(lang, k, pix)}
                error={errors[`texts.${k}`]}
                onChange={(v) => {
                  patchConfig({ texts: { ...config.texts, [k]: v } }, true);
                  clearErrors(`texts.${k}`);
                }}
              />
            ))}
          </div>
        </fieldset>
      </FormSection>

      <FormSection title="Pagamento" {...sectionProps("pagamento")}>
        <fieldset className="flex flex-col gap-2">
          <legend id={f("provider")} tabIndex={-1} className="mb-1 font-medium text-sm outline-none">
            Gateway
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {CHECKOUT_PROVIDERS.map((p) => {
              const allowed = providerAllows(p, currency);
              const checked = draft.provider === p;
              return (
                <label
                  key={p}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border bg-card p-3",
                    !allowed && "cursor-not-allowed opacity-60",
                    checked && "border-primary/60",
                  )}
                >
                  <input
                    type="radio"
                    name={f("provider-radio")}
                    checked={checked}
                    disabled={!allowed && !checked}
                    onChange={() => changeProvider(p)}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium text-sm">{PROVIDER_LABEL[p]}</span>
                    <span className="text-muted-foreground text-xs">
                      {allowed
                        ? CHECKOUT_PROVIDER_HINT[p]
                        : `Só com ${orList(PROVIDER_CURRENCIES[p].map((c) => OFFER_CURRENCY_NAME[c]))}.`}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          {errors.provider && (
            <p role="alert" className="text-destructive text-sm">
              {errors.provider}
            </p>
          )}
          {!errors.provider && pix && (
            <p className="text-muted-foreground text-xs">
              O PIX mostra o QR Code e o “copia e cola” na própria página e confirma o pagamento sozinho. Cartão só pela
              Kyvo (nas outras moedas).
            </p>
          )}
        </fieldset>

        {draft.provider === "KYVO" && currency !== "BRL" && (
          <fieldset className="flex flex-col gap-2">
            <legend id={f("methods")} tabIndex={-1} className="mb-1 font-medium text-sm outline-none">
              Formas de pagamento
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {PAYMENT_METHODS.map((m) => {
                const allowed = checkoutMethodAllows(m, "KYVO", currency);
                if (!allowed) return null;
                return (
                  <label key={m} className="flex cursor-pointer items-start gap-3 rounded-md border bg-card p-3">
                    <input
                      type="checkbox"
                      checked={draft.methods.includes(m)}
                      onChange={(e) => toggleMethod(m, e.target.checked)}
                      className="mt-0.5 size-4 shrink-0 accent-primary"
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium text-sm">{CHECKOUT_METHOD_LABEL[m]}</span>
                      <span className="text-muted-foreground text-xs">{METHOD_HINT[m]}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            {errors.methods && (
              <p role="alert" className="text-destructive text-sm">
                {errors.methods}
              </p>
            )}
          </fieldset>
        )}

        {CHECKOUT_LOCALES[currency].length > 1 ? (
          <Field data-invalid={Boolean(errors.locale)}>
            <FieldLabel htmlFor={f("locale")}>Idioma do checkout</FieldLabel>
            <Select value={draft.locale} onValueChange={(v) => patch({ locale: v as PaymentLocaleId })}>
              <SelectTrigger id={f("locale")} className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHECKOUT_LOCALES[currency].map((l) => (
                  <SelectItem key={l} value={l}>
                    {LOCALE_LABEL[l]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.locale ? (
              <FieldError>{errors.locale}</FieldError>
            ) : (
              <FieldDescription>Em euro, escolha entre português (Portugal) e espanhol (Espanha).</FieldDescription>
            )}
          </Field>
        ) : (
          <p className="text-muted-foreground text-xs">
            Textos do checkout em {LOCALE_LABEL[defaultCheckoutLocale(currency)]} (o idioma de quem paga em{" "}
            {OFFER_CURRENCY_NAME[currency]}).
          </p>
        )}
      </FormSection>

      {(!draft.thankYouPageId || !draft.accessUrl.trim() || bumpsWithoutAccess.length > 0) && (
        <Callout variant="info">
          {`Falta ${andList(
            [
              !draft.thankYouPageId ? "escolher a página de obrigado" : "",
              !draft.accessUrl.trim() ? "colar o link de acesso ao produto" : "",
              bumpsWithoutAccess.length === 1
                ? `colar o link de acesso do order bump “${bumpsWithoutAccess[0].title.trim() || "sem título"}”`
                : bumpsWithoutAccess.length > 1
                  ? `colar o link de acesso de ${bumpsWithoutAccess.length} order bumps`
                  : "",
            ].filter(Boolean),
          )}. Dá para salvar agora e completar depois.`}
        </Callout>
      )}

      {formError && (
        <p role="alert" className="text-destructive text-sm">
          {formError}
        </p>
      )}

      <SaveBar
        dirty={dirty}
        pending={save.pending}
        saveLabel={checkout ? "Salvar checkout" : "Salvar e ligar o checkout"}
        guard={changed}
        onReset={() => {
          if (!checkout && onDiscardNew) {
            onDiscardNew();
            return;
          }
          setDraft(baseline);
          setErrors({});
          setFormError(null);
        }}
        className="-mx-0 px-0 sm:-mx-0 sm:px-0"
      />
    </form>
  );
}
