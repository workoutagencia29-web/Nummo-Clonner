"use client";

/**
 * Confirmação de "trocar a moeda da oferta": antes de trocar, mostra
 * exatamente o que muda (o plano vem do servidor, sem gravar nada:
 * getCurrencySwitchPlanAction) — vitrines e caixas de compra de cada página,
 * os produtos com o preço já na moeda nova (os números iguais), os produtos do
 * pagamento na página (Kyvo) e como ficam, o "Valor da oferta" dos pixels (só
 * quando a oferta tem pixel ligado ou valor salvo) e o aviso de que preço
 * escrito como texto não muda. Todos os valores no formato do painel
 * ("MX$ 297,00": o "$297.00" da página pareceria dólar). "Trocar a moeda de tudo"
 * chama switchOfferCurrencyAction (src/server/services/offer-currency.ts).
 *
 * Com a moeda que a oferta já tem ("Passar tudo para …" do cartão, quando uma
 * página voltou para a moeda de antes), mostra só o que está fora dela.
 */
import { CoinsIcon, CreditCardIcon, ShoppingBagIcon, ShoppingCartIcon, TypeIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { SCROLL_DIALOG } from "@/components/app/scroll-dialog";
import { Callout } from "@/components/offers/tracking/callout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { currencyVersionLabel, OFFER_CURRENCY_NAME, offerCurrencyLabel } from "@/lib/offer-currency";
import type {
  CurrencyPlanPayment,
  CurrencyPlanPaymentState,
  CurrencySwitchPlan,
  CurrencySwitchResult,
} from "@/lib/offer-currency-switch";
import { CURRENCY_LABEL, formatAmount, LOCALE_LABEL, METHOD_LABEL } from "@/lib/payments/rules";
import type { StoreCurrency } from "@/lib/store";
import { cn } from "@/lib/utils";
import { getCurrencySwitchPlanAction, switchOfferCurrencyAction } from "@/server/actions/offer-settings";
import { currencySwitchToast, storeChangeText } from "./helpers";

/** "SPEI e Cartão". */
const methodsText = (methods: CurrencyPlanPaymentState["methods"]) => {
  const names = methods.map((m) => METHOD_LABEL[m]);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`;
};

/** "Peso mexicano (MXN) · SPEI e Cartão · janela em Español · MX$ 297,00". */
const paymentState = (s: CurrencyPlanPaymentState) =>
  `${CURRENCY_LABEL[s.currency]} · ${methodsText(s.methods)} · janela em ${LOCALE_LABEL[s.locale]} · ${s.price}`;

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="flex items-center gap-2 font-medium text-sm">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function PaymentRow({ p, to }: { p: CurrencyPlanPayment; to: StoreCurrency }) {
  return (
    <li className="flex flex-col gap-1 rounded-md border bg-background p-3 text-sm">
      <p className="font-medium">
        {p.label} <span className="font-normal text-muted-foreground">· {p.productName}</span>
        {!p.active && (
          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-normal text-muted-foreground text-xs">
            guardado (o link leva ao endereço)
          </span>
        )}
      </p>
      {p.after ? (
        <>
          <p className="text-muted-foreground">Hoje: {paymentState(p.before)}</p>
          <p>Depois: {paymentState(p.after)}</p>
        </>
      ) : (
        <p className="text-muted-foreground">
          {paymentState(p.before)} —{" "}
          {p.before.currency === to ? "já cobra nessa moeda: fica como está." : "fica como está."}
        </p>
      )}
      {p.problem && (
        <p className="font-medium text-destructive">
          {p.problem} Depois da troca, ajuste o valor ou as formas de pagamento em “Links e checkouts”: até lá, a Kyvo
          recusa a cobrança.
        </p>
      )}
    </li>
  );
}

function PlanBody({ plan }: { plan: CurrencySwitchPlan }) {
  const toName = OFFER_CURRENCY_NAME[plan.to];
  // "Passar tudo para …": a oferta já está nessa moeda; só o que ficou fora dela muda.
  const reapply = plan.from === plan.to;
  const showcases = plan.pages.reduce((n, p) => n + p.showcases, 0);
  const buyBoxes = plan.pages.reduce((n, p) => n + p.buyBoxes, 0);
  const sample = plan.products.find((p) => p.before && p.after && p.before !== p.after);
  return (
    <div className="flex flex-col gap-6">
      <Section
        icon={<ShoppingBagIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
        title="Vitrines e caixas de compra"
      >
        {plan.pages.length ? (
          <>
            <p className="text-sm">
              Passam para {toName}:{" "}
              <strong>{storeChangeText({ showcases, buyBoxes, pages: plan.pages.length })}</strong>.
            </p>
            <ul className="flex flex-col gap-1 text-sm">
              {plan.pages.map((p) => (
                <li key={p.pageId}>
                  <strong>{p.pageName}</strong>
                  <span className="text-muted-foreground">
                    {" "}
                    —{" "}
                    {[
                      p.showcases ? `${p.showcases} ${p.showcases === 1 ? "vitrine" : "vitrines"}` : "",
                      p.buyBoxes ? `${p.buyBoxes} ${p.buyBoxes === 1 ? "caixa de compra" : "caixas de compra"}` : "",
                    ]
                      .filter(Boolean)
                      .join(" e ") || "vitrine ou caixa de compra"}
                    {p.alsoIn ? ` (também ${p.alsoIn})` : ""}
                  </span>
                </li>
              ))}
            </ul>
            {plan.products.length > 0 && (
              <div className="overflow-x-auto rounded-md border">
                {/* Um formato só no diálogo inteiro (o do painel, "MX$ 129,90"), como os valores da Kyvo e dos pixels. */}
                <table className="w-full text-sm">
                  <caption className="sr-only">Preço de cada produto hoje e depois da troca</caption>
                  <thead className="bg-muted/50 text-left text-muted-foreground text-xs">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Produto
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Hoje
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Depois
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.products.map((p, i) => (
                      <tr key={`${p.pageName}-${p.name}-${i}`} className="border-t">
                        <td className="px-3 py-1.5">
                          {p.name || "Produto sem nome"}
                          {plan.pages.length > 1 && (
                            <span className="block text-muted-foreground text-xs">{p.pageName}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{p.before ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 font-medium">{p.after ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {plan.moreProducts > 0 && (
                  <p className="border-t px-3 py-2 text-muted-foreground text-xs">
                    e mais {plan.moreProducts} {plan.moreProducts === 1 ? "produto" : "produtos"}
                  </p>
                )}
              </div>
            )}
            <Callout title={`Confira se os valores fazem sentido em ${toName}`}>
              Os números continuam os mesmos — não há conversão pela cotação
              {sample ? (
                <>
                  : <strong className="whitespace-nowrap">{sample.before}</strong> vira{" "}
                  <strong className="whitespace-nowrap">{sample.after}</strong>
                </>
              ) : null}
              . O preço antigo riscado e as parcelas acompanham. Para mudar um valor, abra a página no editor e clique
              no produto.
            </Callout>
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            {reapply
              ? `Todas as vitrines e caixas de compra já estão em ${toName}.`
              : "Nenhuma página tem vitrine ou caixa de compra."}
          </p>
        )}
      </Section>

      {plan.payments.length > 0 && (
        <Section
          icon={<CreditCardIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
          title="Pagamento na página (Kyvo)"
        >
          {plan.paymentsKept && (
            <Callout variant="warning" title={`A Kyvo não cobra em ${toName}`}>
              {plan.payments.length === 1 ? "O produto do pagamento na página fica" : "Os produtos ficam"} como{" "}
              {plan.payments.length === 1 ? "está" : "estão"}, cobrando na moeda de hoje. Para vender em {toName}, use
              nesses links um checkout em {toName} (Hotmart, Kiwify…) na aba “Links e checkouts”.
            </Callout>
          )}
          <ul className="flex flex-col gap-2">
            {plan.payments.map((p) => (
              <PaymentRow key={p.linkId} p={p} to={plan.to} />
            ))}
          </ul>
          {!plan.paymentsKept && plan.payments.some((p) => p.after) && (
            <p className="text-muted-foreground text-xs">
              O valor de cada produto fica com o mesmo número. Ficam as formas de pagamento que a moeda nova aceita, e o
              idioma da janela acompanha a moeda quando estava no padrão da moeda de antes.
            </p>
          )}
        </Section>
      )}

      {plan.checkouts.length > 0 && (
        <Section
          icon={<ShoppingCartIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
          title="Checkout do Offer Studio"
        >
          <ul className="flex flex-col gap-2">
            {plan.checkouts.map((c) => (
              <li key={c.linkId} className="flex flex-col gap-1 rounded-md border bg-background p-3 text-sm">
                <p className="font-medium">
                  {c.label} <span className="font-normal text-muted-foreground">· {c.productName}</span>
                  {!c.active && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-normal text-muted-foreground text-xs">
                      guardado (o link leva a outro destino)
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground">
                  Hoje: {c.before.gateway} · {c.before.price}
                </p>
                <p>
                  Depois: {c.after.gateway} · {c.after.price}
                  {c.locale && ` · textos em ${c.locale.to}`}
                </p>
                {c.gatewayChanged && (
                  <p className="text-muted-foreground text-xs">
                    O gateway muda porque o de hoje não cobra em {toName}. Confira a chave dele em “Links e checkouts”.
                  </p>
                )}
                {c.locale && (
                  <p className="text-muted-foreground text-xs">
                    Os textos do checkout passam de {c.locale.from} para {c.locale.to}, o idioma de quem paga em{" "}
                    {toName}.
                  </p>
                )}
                {c.addressOff && (
                  <p className="text-muted-foreground text-xs">
                    O endereço de entrega e o frete deixam de ser pedidos: só existem no checkout em real (o CEP é do
                    Brasil). As opções de frete ficam guardadas.
                  </p>
                )}
                {c.textsToReview && (
                  <p className="font-medium text-xs">
                    Os textos que você trocou em “Aparência → Textos” ficam como estão, escritos para o checkout de
                    hoje: revise-os depois da troca.
                  </p>
                )}
                {c.problem && (
                  <p className="font-medium text-destructive">
                    {c.problem} Depois da troca, ajuste o valor, os bumps ou o frete em “Links e checkouts”.
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">
            O produto, os order bumps e o frete ficam com os mesmos números.
          </p>
        </Section>
      )}

      {plan.pixel && (
        <Section
          icon={<CoinsIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
          title="Pixels (valor da oferta)"
        >
          <p className="text-sm">
            {plan.pixel.amount !== null ? (
              <>
                {/* No formato do painel, como os produtos e a Kyvo acima (MX$ 297,00 — não "$297.00", que parece dólar). */}
                O valor enviado aos pixels nas compras passa de{" "}
                <strong>{formatAmount(Math.round(plan.pixel.amount * 100), plan.pixel.from)}</strong> para{" "}
                <strong>{formatAmount(Math.round(plan.pixel.amount * 100), plan.pixel.to)}</strong>.
              </>
            ) : (
              <>A moeda enviada aos pixels nas compras passa a ser {OFFER_CURRENCY_NAME[plan.pixel.to]}.</>
            )}
          </p>
        </Section>
      )}

      {!reapply && (
        <Section
          icon={<TypeIcon className="size-4 text-muted-foreground" aria-hidden="true" />}
          title="Preços escritos como texto"
        >
          <Callout
            variant={plan.textPrices.length ? "warning" : "info"}
            title="Preço escrito no texto das páginas não muda"
          >
            Num título, num parágrafo ou numa página clonada, o preço é texto: troque no editor ou com o Localizar e
            substituir.
            {plan.textPrices.length > 0 && (
              <ul className="mt-2 flex flex-col gap-0.5">
                {plan.textPrices.map((t) => (
                  <li key={t.pageId}>
                    <strong>{t.pageName}</strong>: {t.examples.map((e) => `“${e}”`).join(", ")}
                  </li>
                ))}
              </ul>
            )}
          </Callout>
        </Section>
      )}

      {plan.documents > 0 && (
        <p className="text-muted-foreground text-xs">
          Cada página que muda ganha antes um ponto no Histórico do editor (“{currencyVersionLabel(plan.to)}”), com a
          página como estava.
          {!reapply &&
            " Para desfazer a troca, troque a moeda de volta aqui: restaurar esse ponto volta só aquela página."}
        </p>
      )}
    </div>
  );
}

export function CurrencySwitchDialog({
  offerId,
  currency,
  open,
  onOpenChange,
  onSwitched,
  reapply: reapplyHint = false,
}: {
  offerId: string;
  /** Moeda nova (a que a oferta já tem = "Passar tudo para …"). */
  currency: StoreCurrency;
  /** É o "Passar tudo para …" (a moeda que a oferta já tem): o título certo antes de o plano chegar. */
  reapply?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitched: (result: CurrencySwitchResult) => void;
}) {
  const [plan, setPlan] = useState<CurrencySwitchPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const load = useAction(getCurrencySwitchPlanAction);
  const swap = useAction(switchOfferCurrencyAction);
  const { run: runLoad } = load;
  const label = offerCurrencyLabel(currency);
  const name = OFFER_CURRENCY_NAME[currency];
  // O plano diz se a oferta já está nessa moeda (até ele chegar, vale o que o cartão disse).
  const reapply = plan ? plan.from === plan.to : reapplyHint;

  const fetchPlan = useCallback(() => {
    setPlan(null);
    setError(null);
    void runLoad(
      { offerId, currency },
      { silentError: true, onSuccess: setPlan, onError: (message) => setError(message) },
    );
  }, [offerId, currency, runLoad]);

  useEffect(() => {
    if (open) fetchPlan();
  }, [open, fetchPlan]);

  function confirm() {
    setError(null);
    void swap.run(
      { offerId, currency },
      {
        silentError: true,
        onError: (message) => {
          setError(message);
          // O aviso fica no alto do miolo (a pessoa pode ter rolado até o fim do plano).
          body.current?.scrollTo({ top: 0 });
        },
        onSuccess: (r) => {
          // Com algo a conferir, o aviso fica até a pessoa fechar (o padrão some antes de dar para ler).
          const { message, persistent } = currencySwitchToast(r, label);
          toast.success(message, persistent ? { duration: Number.POSITIVE_INFINITY, closeButton: true } : undefined);
          onOpenChange(false);
          onSwitched(r);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !swap.pending && onOpenChange(next)}>
      <DialogContent className={cn(SCROLL_DIALOG.content, "sm:max-w-2xl")}>
        <div className={SCROLL_DIALOG.form}>
          <DialogHeader className={SCROLL_DIALOG.header}>
            {reapply ? (
              <>
                <DialogTitle>Passar tudo para {label}?</DialogTitle>
                <DialogDescription>
                  A oferta já roda em {name}, mas algumas páginas ficaram com preços em outra moeda. Elas passam para{" "}
                  {name}. Os números continuam os mesmos: não há conversão pela cotação.
                </DialogDescription>
              </>
            ) : (
              <>
                <DialogTitle>Trocar a moeda da oferta para {label}?</DialogTitle>
                <DialogDescription>
                  Tudo o que tem preço nesta oferta passa para {name}. Os números continuam os mesmos: não há conversão
                  pela cotação.
                </DialogDescription>
              </>
            )}
          </DialogHeader>
          <div ref={body} className={cn(SCROLL_DIALOG.body, "flex flex-col gap-4")} aria-busy={!plan && !error}>
            {error && (
              <Callout
                variant="warning"
                title={
                  plan
                    ? reapply
                      ? `Não deu para passar tudo para ${name}`
                      : "Não deu para trocar a moeda"
                    : "Não deu para conferir o que muda"
                }
                action={
                  !plan && (
                    <Button type="button" variant="outline" size="sm" onClick={fetchPlan}>
                      Tentar de novo
                    </Button>
                  )
                }
              >
                {error}
              </Callout>
            )}
            {plan ? (
              <PlanBody plan={plan} />
            ) : error ? null : (
              <output className="flex items-center gap-2 text-muted-foreground text-sm">
                <Spinner />
                Conferindo o que muda nas páginas…
              </output>
            )}
          </div>
          <DialogFooter className={SCROLL_DIALOG.footer}>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={swap.pending}>
              Cancelar
            </Button>
            <Button type="button" onClick={confirm} disabled={!plan || swap.pending}>
              {swap.pending && <Spinner />}
              {reapply ? `Passar tudo para ${name}` : "Trocar a moeda de tudo"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
