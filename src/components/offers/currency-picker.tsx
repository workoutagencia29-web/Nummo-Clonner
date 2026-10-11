"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useId } from "react";
import { templateSummary } from "@/editor/templates/catalog";
import { OFFER_CURRENCIES, OFFER_CURRENCY_NAME, OFFER_CURRENCY_QUESTION } from "@/lib/offer-currency";
import { STORE_CURRENCIES, type StoreCurrency } from "@/lib/store";
import { cn } from "@/lib/utils";

/** Nome da moeda no botão (o símbolo vai ao lado, entre parênteses). */
const NAME: Record<StoreCurrency, string> = {
  BRL: "Real",
  MXN: "Peso mexicano",
  EUR: "Euro",
  USD: "Dólar",
};

/**
 * "Em qual moeda essa oferta vai rodar?": real, peso mexicano, euro e dólar em
 * botões de rádio (nativos: funcionam dentro de <form> e com as setas do
 * teclado). Usado na "Nova oferta", no "Salvar como oferta" da clonagem e na
 * aba "Moeda, empresa e SEO" da oferta.
 */
export function CurrencyPicker({
  value,
  onChange,
  label = OFFER_CURRENCY_QUESTION,
  columns = 4,
  disabled,
  describedBy,
  children,
  className,
}: {
  value: StoreCurrency;
  onChange: (currency: StoreCurrency) => void;
  label?: string;
  /** 4 = uma linha (2 no celular); 2 = duas linhas (coluna estreita). */
  columns?: 2 | 4;
  disabled?: boolean;
  /** Id do texto que explica a escolha (lido junto pelos leitores de tela). */
  describedBy?: string;
  /** Explicação logo abaixo das moedas. */
  children?: React.ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-2", className)} aria-describedby={describedBy}>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className={cn("grid grid-cols-2 gap-2", columns === 4 && "sm:grid-cols-4")}>
        {OFFER_CURRENCIES.map((currency) => (
          <label
            key={currency}
            htmlFor={`${id}-${currency}`}
            className={cn(
              "flex cursor-pointer items-center gap-2.5 rounded-md border bg-background px-3 py-2.5 text-sm transition-colors hover:bg-muted/50",
              "has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="radio"
              id={`${id}-${currency}`}
              name={`${id}-moeda`}
              value={currency}
              checked={value === currency}
              disabled={disabled}
              onChange={() => onChange(currency)}
              className="size-4 shrink-0 accent-primary outline-none disabled:cursor-not-allowed"
            />
            <span className="min-w-0 leading-snug">
              <span className="font-medium">{NAME[currency]}</span>{" "}
              <span className="whitespace-nowrap text-muted-foreground">({STORE_CURRENCIES[currency].symbol})</span>
            </span>
          </label>
        ))}
      </div>
      {children}
    </fieldset>
  );
}

/**
 * Aviso de uma linha: o modelo escolhido tem preço escrito como texto, em R$
 * (`textPrices` no catálogo: vendas longa, upsell, downsell), e a oferta não
 * roda em real — o texto não acompanha a moeda. Na "Nova oferta" (logo abaixo
 * da pergunta da moeda), na "Nova página" e na versão A/B a partir de modelo
 * (`withCurrency`: lá a moeda não está na tela, então o aviso diz qual é).
 */
export function TextPricesNote({
  currency,
  templateId,
  withCurrency = false,
  className,
}: {
  currency: StoreCurrency;
  templateId: string;
  withCurrency?: boolean;
  className?: string;
}) {
  if (currency === "BRL" || !templateSummary(templateId)?.textPrices) return null;
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-warning-foreground dark:text-warning", className)}>
      <TriangleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>
        {withCurrency && `Esta oferta roda em ${OFFER_CURRENCY_NAME[currency]}. `}
        Os preços escritos neste modelo estão em R$ (são texto): troque-os no editor.
      </span>
    </p>
  );
}

/** Onde a oferta vende, pela moeda (para o aviso das páginas legais). */
const LEGAL_WHERE: Record<Exclude<StoreCurrency, "BRL">, string> = {
  MXN: "no México",
  EUR: "na Europa",
  USD: "fora do Brasil",
};

/**
 * Aviso de uma linha: os modelos de Política de privacidade e Termos de uso
 * (páginas legais) foram escritos para a lei brasileira (LGPD) e a oferta não
 * roda em real. Só avisa: o texto jurídico não é traduzido nem trocado. Nos
 * mesmos lugares do TextPricesNote (com `withCurrency` onde a moeda não está na
 * tela).
 */
export function LegalTemplateNote({
  currency,
  templateId,
  withCurrency = false,
  className,
}: {
  currency: StoreCurrency;
  templateId: string;
  withCurrency?: boolean;
  className?: string;
}) {
  if (currency === "BRL" || templateSummary(templateId)?.pageType !== "LEGAL") return null;
  return (
    <p className={cn("flex items-start gap-1.5 text-xs text-warning-foreground dark:text-warning", className)}>
      <TriangleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>
        {withCurrency && `Esta oferta roda em ${OFFER_CURRENCY_NAME[currency]}. `}
        Texto pensado para a lei brasileira (LGPD). Para vender {LEGAL_WHERE[currency]}, peça a um advogado a versão
        local.
      </span>
    </p>
  );
}
