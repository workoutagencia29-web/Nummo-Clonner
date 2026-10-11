"use client";

import { KeyRoundIcon, LockIcon } from "lucide-react";
import { useId, useState } from "react";
import { Callout } from "@/components/offers/tracking/callout";
import { SaveBar } from "@/components/offers/tracking/form-kit";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/hooks/use-action";
import { OFFER_CURRENCY_NAME, offerCurrencyLabel, paymentCurrencyFor } from "@/lib/offer-currency";
import type { PaymentKeyState } from "@/lib/payments/checks";
import {
  CURRENCY_LABEL,
  defaultLocale,
  defaultMethods,
  formatAmount,
  LOCALE_LABEL,
  METHOD_CURRENCIES,
  METHOD_HINT,
  METHOD_LABEL,
  methodAllows,
  PAYMENT_CURRENCIES,
  PAYMENT_LOCALES,
  PAYMENT_METHODS,
  type PaymentCurrencyId,
  type PaymentLocaleId,
  type PaymentMethodId,
  type PaymentProductField,
  type PaymentProductInput,
  parseAmount,
  paymentProductProblems,
  switchPaymentCurrency,
} from "@/lib/payments/rules";
import type { StoreCurrency } from "@/lib/store";
import { cn } from "@/lib/utils";
import { savePaymentProductAction } from "@/server/actions/payments";

/** Produto salvo (o que a tela recebe do servidor). */
export interface PaymentProductValue {
  name: string;
  amount: string;
  price: string;
  currency: PaymentCurrencyId;
  methods: PaymentMethodId[];
  locale: PaymentLocaleId;
  thankYouPageId: string | null;
  accessUrl: string;
}

export interface PaymentPageOption {
  id: string;
  name: string;
  type: string;
}

const NONE = "__nenhuma__";
const FIELDS: PaymentProductField[] = [
  "name",
  "amount",
  "currency",
  "methods",
  "locale",
  "thankYouPageId",
  "accessUrl",
];

/** Moeda do produto novo numa oferta em real (a Kyvo não cobra em real): a de antes da moeda da oferta. */
const FALLBACK_CURRENCY: PaymentCurrencyId = "MXN";

/**
 * Valores do formulário para um link que ainda não tem produto: na moeda da
 * oferta quando a Kyvo cobra nela (com as formas de pagamento e o idioma da
 * janela dessa moeda: peso mexicano → SPEI + cartão, em espanhol); senão (oferta
 * em real ou de antes da pergunta, `offerCurrency` null), na moeda de um produto
 * já salvo na oferta (`productCurrency`) ou em peso mexicano.
 */
export function newProductDraft(
  pages: PaymentPageOption[],
  offerCurrency: StoreCurrency | null = null,
  productCurrency: PaymentCurrencyId | null = null,
): PaymentProductInput {
  const thankYou = pages.filter((p) => p.type === "THANK_YOU");
  const currency = (offerCurrency && paymentCurrencyFor(offerCurrency)) ?? productCurrency ?? FALLBACK_CURRENCY;
  return {
    name: "",
    amount: "",
    currency,
    methods: defaultMethods(currency),
    locale: defaultLocale(currency),
    thankYouPageId: thankYou.length === 1 ? thankYou[0].id : null,
    accessUrl: "",
  };
}

function draftOf(
  payment: PaymentProductValue | null,
  pages: PaymentPageOption[],
  offerCurrency: StoreCurrency | null,
  productCurrency: PaymentCurrencyId | null,
): PaymentProductInput {
  if (!payment) return newProductDraft(pages, offerCurrency, productCurrency);
  return {
    name: payment.name,
    amount: payment.amount,
    currency: payment.currency,
    methods: payment.methods,
    locale: payment.locale,
    thankYouPageId: payment.thankYouPageId,
    accessUrl: payment.accessUrl,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Problemas de valor e de formas de pagamento de um produto já salvo (os que impedem a cobrança). */
function savedPaymentProblems(saved: PaymentProductInput): Partial<Record<PaymentProductField, string>> {
  const { amount, methods } = paymentProductProblems(saved);
  return { ...(amount && { amount }), ...(methods && { methods }) };
}

/** Título do aviso da chave do gateway no formulário do produto. */
const GATEWAY_KEY_TITLE: Record<Exclude<PaymentKeyState, "ok">, string> = {
  missing: "Falta a chave da Kyvo desta oferta",
  unreadable: "Cole de novo a chave da Kyvo",
  rejected: "A Kyvo recusou a chave",
  no_scope: "A chave da Kyvo não tem a permissão transactions:read",
};

/**
 * Produto de um link "Pagamento na página": nome, valor e moeda, formas de
 * pagamento (só as que combinam com a moeda), idioma da janela do comprador,
 * página de obrigado e link de acesso (guardado no servidor, entregue só a
 * quem pagou). Salvar liga o pagamento na página no link.
 */
export function PaymentProductForm({
  linkId,
  payment,
  pages,
  offerCurrency = null,
  productCurrency = null,
  gatewayKey,
  onOpenAccount,
  onSaved,
  onDiscardNew,
}: {
  linkId: string;
  payment: PaymentProductValue | null;
  pages: PaymentPageOption[];
  /**
   * Moeda escolhida para a oferta: o produto novo começa nela (se a Kyvo cobrar
   * nela). null/sem: oferta de antes da pergunta (real só por padrão: sem aviso).
   */
  offerCurrency?: StoreCurrency | null;
  /** Moeda de um produto já salvo na oferta (o novo começa nela quando a oferta não tem moeda da Kyvo). */
  productCurrency?: PaymentCurrencyId | null;
  /** Estado da chave do gateway desta oferta (cartão da conta, na mesma aba). */
  gatewayKey: PaymentKeyState;
  /** Abre o cartão da conta da Kyvo da oferta (rola até ele, com a chave em foco). */
  onOpenAccount?: () => void;
  onSaved?: () => void;
  /** "Descartar" num link que ainda não tem produto (volta o destino para endereço). */
  onDiscardNew?: () => void;
}) {
  const id = useId();
  const initial = draftOf(payment, pages, offerCurrency, productCurrency);
  // Produto novo numa oferta que escolheu o real: a Kyvo não cobra em real (o produto cobra
  // em outra moeda). Sem aviso nos produtos já salvos (a moeda já foi escolhida), nas ofertas
  // de antes da pergunta (o real é só o padrão: muitas já cobram em peso) e quando a oferta já
  // tem um produto (a pessoa já escolheu a moeda da Kyvo: o novo começa nela).
  const noKyvoCurrency = !payment && !productCurrency && !!offerCurrency && !paymentCurrencyFor(offerCurrency);
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState(initial);
  // O produto salvo mudou fora daqui (outra aba): sem nada digitado, mostra o novo.
  const initialKey = JSON.stringify(initial);
  const [seenKey, setSeenKey] = useState(initialKey);
  if (initialKey !== seenKey) {
    setSeenKey(initialKey);
    setBaseline(initial);
    if (same(draft, baseline)) setDraft(initial);
  }
  const [errors, setErrors] = useState<Partial<Record<PaymentProductField, string>>>({});
  // Produto salvo com valor ou forma de pagamento que não servem (ex.: depois de trocar a moeda da
  // oferta, o valor passou do máximo do SPEI): o campo já mostra o problema, sem esperar o "Salvar".
  const savedProblems = payment ? savedPaymentProblems(baseline) : {};
  const priceUntouched =
    draft.amount === baseline.amount && draft.currency === baseline.currency && same(draft.methods, baseline.methods);
  const shownErrors = priceUntouched ? { ...savedProblems, ...errors } : errors;
  const [formError, setFormError] = useState<string | null>(null);
  const save = useAction(savePaymentProductAction);
  // Sem produto ainda: o formulário já conta como "não salvo" (o link só vira pagamento ao salvar).
  const dirty = !payment || !same(draft, baseline);

  function patch(changes: Partial<PaymentProductInput>) {
    setDraft((d) => ({ ...d, ...changes }));
    setErrors((e) => {
      const next = { ...e };
      for (const k of Object.keys(changes)) delete next[k as PaymentProductField];
      return next;
    });
  }

  function changeCurrency(currency: PaymentCurrencyId) {
    // Ficam as formas que a moeda aceita, entram as da moeda nova que a de antes não aceitava (quando o
    // valor cabe) e o idioma ainda no padrão da moeda antiga acompanha a nova (a mesma regra da troca
    // da moeda da oferta).
    patch(switchPaymentCurrency(draft, currency, parseAmount(draft.amount)));
  }

  function toggleMethod(method: PaymentMethodId, on: boolean) {
    const methods = on ? [...draft.methods, method] : draft.methods.filter((m) => m !== method);
    patch({ methods: PAYMENT_METHODS.filter((m) => methods.includes(m)) });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const problems = paymentProductProblems(draft);
    if (Object.keys(problems).length) {
      setErrors(problems);
      const first = Object.keys(problems)[0];
      document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    void save.run(
      { linkId, ...draft, thankYouPageId: draft.thankYouPageId || null },
      {
        success: "Produto salvo. Os botões ligados a este link abrem a janela de pagamento.",
        silentError: true,
        onError: (message, field) => {
          if (field && FIELDS.includes(field as PaymentProductField)) setErrors({ [field]: message });
          else setFormError(message);
        },
        onSuccess: (saved) => {
          const next = draftOf(saved, pages, offerCurrency, productCurrency);
          setBaseline(next);
          setDraft(next);
          setErrors({});
          onSaved?.();
        },
      },
    );
  }

  const cents = parseAmount(draft.amount);
  const preview = cents !== null && cents > 0 ? formatAmount(cents, draft.currency) : null;
  const thankYouName = pages.find((p) => p.id === draft.thankYouPageId)?.name;

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-label="Produto do pagamento na página"
      className="flex flex-col gap-5 rounded-lg border bg-muted/20 p-4"
    >
      {gatewayKey !== "ok" && (
        <Callout
          variant="warning"
          title={GATEWAY_KEY_TITLE[gatewayKey]}
          action={
            onOpenAccount && (
              <Button type="button" variant="outline" size="sm" onClick={onOpenAccount}>
                <KeyRoundIcon />
                {gatewayKey === "missing" ? "Cadastrar a chave desta oferta" : "Abrir a conta da Kyvo desta oferta"}
              </Button>
            )
          }
        >
          {gatewayKey === "rejected"
            ? "A Kyvo recusou a chave desta oferta no último “Testar conexão”. Você já pode montar o produto e testar na prévia, mas para receber de verdade troque a chave."
            : gatewayKey === "no_scope"
              ? "A chave desta oferta não tem a permissão transactions:read: sem ela, o pagamento não é confirmado e o comprador não recebe o acesso. Troque por uma chave com essa permissão."
              : gatewayKey === "unreadable"
                ? "A chave salva nesta oferta não pode mais ser lida neste Mac. Você já pode montar o produto e testar na prévia, mas para receber de verdade cole a chave de novo."
                : "Você já pode montar o produto e testar na prévia, mas para receber de verdade cadastre a chave da API da Kyvo desta oferta (ou use a mesma de outra oferta). Cada oferta pode cobrar numa conta diferente."}
        </Callout>
      )}

      {noKyvoCurrency && (
        <Callout title={`A Kyvo não cobra em ${OFFER_CURRENCY_NAME[offerCurrency]}`}>
          Esta oferta roda em <strong>{offerCurrencyLabel(offerCurrency)}</strong>, mas o pagamento na página só cobra
          em peso mexicano, euro ou dólar. Escolha abaixo, em <strong>Moeda</strong>, a moeda em que o comprador vai
          pagar — e confira se os preços escritos nas páginas estão na mesma moeda.
        </Callout>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={Boolean(errors.name)} className="sm:col-span-2">
          <FieldLabel htmlFor={`${id}-name`}>Nome do produto</FieldLabel>
          <Input
            id={`${id}-name`}
            value={draft.name}
            maxLength={80}
            placeholder="Curso Completo de Repostería"
            aria-invalid={Boolean(errors.name)}
            onChange={(e) => patch({ name: e.target.value })}
          />
          {errors.name ? (
            <FieldError>{errors.name}</FieldError>
          ) : (
            <FieldDescription>O comprador vê esse nome na janela de pagamento.</FieldDescription>
          )}
        </Field>

        <Field data-invalid={Boolean(shownErrors.amount)}>
          <FieldLabel htmlFor={`${id}-amount`}>Valor</FieldLabel>
          <Input
            id={`${id}-amount`}
            value={draft.amount}
            inputMode="decimal"
            placeholder="297,00"
            aria-invalid={Boolean(shownErrors.amount)}
            onChange={(e) => patch({ amount: e.target.value })}
          />
          {shownErrors.amount ? (
            <FieldError>{shownErrors.amount}</FieldError>
          ) : (
            <FieldDescription>
              {preview ? `O comprador paga ${preview}.` : "Com vírgula ou ponto: 297,00."}
            </FieldDescription>
          )}
        </Field>

        <Field data-invalid={Boolean(errors.currency)}>
          <FieldLabel htmlFor={`${id}-currency`}>Moeda</FieldLabel>
          <Select value={draft.currency} onValueChange={(v) => changeCurrency(v as PaymentCurrencyId)}>
            <SelectTrigger id={`${id}-currency`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_CURRENCIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CURRENCY_LABEL[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.currency && <FieldError>{errors.currency}</FieldError>}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2" aria-describedby={`${id}-methods-help`}>
        <legend id={`${id}-methods`} tabIndex={-1} className="mb-1 text-sm font-medium">
          Formas de pagamento
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {PAYMENT_METHODS.map((m) => {
            const allowed = methodAllows(m, draft.currency);
            const checked = draft.methods.includes(m);
            return (
              <label
                key={m}
                htmlFor={`${id}-m-${m}`}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border bg-background p-3",
                  !allowed && "cursor-not-allowed opacity-60",
                  checked && allowed && "border-primary/60",
                )}
              >
                {/* Caixa nativa: a do Radix, dentro de um <form>, cria um campo escondido que não hidrata igual. */}
                <input
                  type="checkbox"
                  id={`${id}-m-${m}`}
                  checked={checked && allowed}
                  disabled={!allowed}
                  onChange={(e) => toggleMethod(m, e.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-primary disabled:cursor-not-allowed"
                />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium">{METHOD_LABEL[m]}</span>
                  <span className="text-xs text-muted-foreground">
                    {allowed
                      ? METHOD_HINT[m]
                      : `Só com ${METHOD_CURRENCIES[m].join(" ou ")}: troque a moeda para usar.`}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {shownErrors.methods ? (
          <p role="alert" className="text-sm text-destructive">
            {shownErrors.methods}
          </p>
        ) : (
          <p id={`${id}-methods-help`} className="text-xs text-muted-foreground">
            O comprador escolhe entre as marcadas. SPEI só existe em peso mexicano; Bizum e MB WAY, só em euro.
          </p>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor={`${id}-locale`}>Idioma da janela de pagamento</FieldLabel>
          <Select value={draft.locale} onValueChange={(v) => patch({ locale: v as PaymentLocaleId })}>
            <SelectTrigger id={`${id}-locale`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_LOCALES.map((l) => (
                <SelectItem key={l} value={l}>
                  {LOCALE_LABEL[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>Todos os textos da janela, para o comprador, saem neste idioma.</FieldDescription>
        </Field>

        <Field data-invalid={Boolean(errors.thankYouPageId)}>
          <FieldLabel htmlFor={`${id}-thankYouPageId`}>Página de obrigado</FieldLabel>
          <Select
            value={draft.thankYouPageId ?? NONE}
            onValueChange={(v) => patch({ thankYouPageId: v === NONE ? null : v })}
          >
            <SelectTrigger id={`${id}-thankYouPageId`} className="w-full">
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
                ? `Depois do pagamento confirmado, o comprador vai para “${thankYouName}”.`
                : "Para onde o comprador vai depois do pagamento confirmado."}
            </FieldDescription>
          )}
        </Field>
      </div>

      <Field data-invalid={Boolean(errors.accessUrl)}>
        <FieldLabel htmlFor={`${id}-accessUrl`}>Link de acesso ao produto</FieldLabel>
        <Input
          id={`${id}-accessUrl`}
          value={draft.accessUrl}
          inputMode="url"
          placeholder="https://area-de-membros.com/curso"
          className="font-mono text-xs"
          aria-invalid={Boolean(errors.accessUrl)}
          onChange={(e) => patch({ accessUrl: e.target.value })}
        />
        {errors.accessUrl ? (
          <FieldError>{errors.accessUrl}</FieldError>
        ) : (
          <FieldDescription className="flex items-start gap-1.5">
            <LockIcon className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
            Área de membros, arquivo ou grupo. Fica guardado no servidor e só é entregue a quem pagou: não aparece no
            HTML das páginas.
          </FieldDescription>
        )}
      </Field>

      {(!draft.thankYouPageId || !draft.accessUrl.trim()) && (
        <Callout variant="info">
          {!draft.thankYouPageId && !draft.accessUrl.trim()
            ? "Falta escolher a página de obrigado e colar o link de acesso. Dá para salvar agora e completar depois."
            : !draft.thankYouPageId
              ? "Falta escolher a página de obrigado. Dá para salvar agora e completar depois."
              : "Falta o link de acesso ao produto. Dá para salvar agora e completar depois."}
        </Callout>
      )}

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      <SaveBar
        dirty={dirty}
        pending={save.pending}
        saveLabel={payment ? "Salvar produto" : "Salvar e ligar o pagamento"}
        onReset={() => {
          if (!payment && onDiscardNew) {
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
