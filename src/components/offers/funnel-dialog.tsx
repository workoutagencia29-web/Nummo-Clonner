"use client";

import {
  ArrowRightIcon,
  CircleCheckIcon,
  ExternalLinkIcon,
  HomeIcon,
  LinkIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { plural } from "@/lib/format";
import {
  defaultSalesPage,
  existingFunnelWarning,
  FUNNEL_MAX_PRIZES,
  FUNNEL_MIN_PRIZES,
  FUNNEL_PRIZES,
  type FunnelPrize,
  nextPrize,
  PRIZE_COUPON_MAX,
  PRIZE_TEXT_MAX,
  type PrizeProblems,
  prizeProblems,
  quotedList,
} from "@/lib/funnel";
import { linkUrlHint } from "@/lib/link-url";
import { clampChance, realChances } from "@/lib/wheel";
import { offerPreviewUrlAction } from "@/server/actions/editor";
import { createQuizWheelFunnelAction } from "@/server/actions/funnel";

/** Página da oferta que pode ser a de vendas (destino do "Resgatar"). */
export interface FunnelDialogPage {
  id: string;
  name: string;
  slug: string;
  isHome: boolean;
  /** Tipo da página (a sugestão de página de vendas prefere SALES/VSL). */
  type: string;
  /** Abre no editor (aviso de botões de compra sem checkout). */
  documentId: string | null;
}

export interface ExistingFunnelPages {
  quiz: { id: string; name: string }[];
  wheel: { id: string; name: string }[];
}

type CreatedFunnel = Extract<Awaited<ReturnType<typeof createQuizWheelFunnelAction>>, { ok: true }>["data"];

interface Row extends FunnelPrize {
  key: number;
  /** A chance digitada (texto), para poder apagar e digitar de novo. */
  chanceText: string;
  /** Digitou menos que 1%: a chance voltou para 1% (aviso na linha). */
  raised?: boolean;
}

let nextKey = 1;
const toRow = (p: FunnelPrize): Row => ({ ...p, key: nextKey++, chanceText: String(p.chance) });

/**
 * "Adicionar funil Quiz → Roleta": escolhe a página de vendas e os prêmios
 * (com o checkout de cada um) e cria as páginas Quiz e Roleta já ligadas.
 * Depois, mostra o resultado com "Abrir o quiz no editor" e "Ver o funil".
 */
export function FunnelDialog({
  open,
  onOpenChange,
  offerId,
  pages,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  offerId: string;
  pages: FunnelDialogPage[];
  /** Páginas que já têm quiz / roleta (aviso antes de criar outro; não são sugeridas como página de vendas). */
  existing: ExistingFunnelPages;
}) {
  const [salesPageId, setSalesPageId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [errors, setErrors] = useState<Record<number, PrizeProblems>>({});
  const [salesError, setSalesError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedFunnel | null>(null);
  const create = useAction(createQuizWheelFunnelAction);
  const preview = useAction(offerPreviewUrlAction);
  const listRef = useRef<HTMLOListElement>(null);
  const focusNew = useRef(false);
  // Aviso calculado ao abrir (depois de criar, a lista de páginas muda e o aviso não deve aparecer no resultado).
  const [warning, setWarning] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: só ao abrir (as páginas mudam depois de criar).
  useEffect(() => {
    if (!open) return;
    setSalesPageId(
      defaultSalesPage(
        pages,
        [...existing.quiz, ...existing.wheel].map((p) => p.id),
      ),
    );
    setRows(FUNNEL_PRIZES.map(toRow));
    setErrors({});
    setSalesError(null);
    setFormError(null);
    setCreated(null);
    setWarning(
      existingFunnelWarning({ quiz: existing.quiz.map((p) => p.name), wheel: existing.wheel.map((p) => p.name) }),
    );
  }, [open]);

  const sales = pages.find((p) => p.id === salesPageId);
  const chances = rows.map((r) => r.chance);
  const total = chances.reduce((s, c) => s + c, 0);
  const real = realChances(chances);

  function update(key: number, patch: Partial<Row>) {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    if ("text" in patch || "url" in patch) {
      setErrors((e) => ({
        ...e,
        [key]: { ...e[key], ...("text" in patch && { text: undefined }), ...("url" in patch && { url: undefined }) },
      }));
    }
    setFormError(null);
  }

  function addRow() {
    focusNew.current = true;
    setRows((list) => [...list, toRow(nextPrize(list))]);
  }

  // O campo do prêmio novo ganha o foco (aparece embaixo da lista).
  useEffect(() => {
    if (!focusNew.current) return;
    focusNew.current = false;
    listRef.current?.querySelectorAll<HTMLInputElement>("input[data-prize-text]")[rows.length - 1]?.focus();
  }, [rows.length]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const found: Record<number, PrizeProblems> = {};
    for (const r of rows) {
      const p = prizeProblems(r);
      if (p.text || p.url) found[r.key] = p;
    }
    setErrors(found);
    const missingSales = !sales;
    setSalesError(missingSales ? "Escolha a página de vendas." : null);
    if (Object.keys(found).length || missingSales) {
      setFormError("Confira os campos marcados.");
      return;
    }
    setFormError(null);
    void create.run(
      {
        offerId,
        salesPageId,
        prizes: rows.map(({ text, chance, url, coupon }) => ({ text, chance, url, coupon })),
        allowExisting: Boolean(warning),
      },
      {
        silentError: true,
        onSuccess: setCreated,
        onError: (msg, field) => {
          const m = field?.match(/^prizes\.(\d+)\.(text|url)$/);
          const row = m ? rows[Number(m[1])] : undefined;
          if (row && m) setErrors((er) => ({ ...er, [row.key]: { ...er[row.key], [m[2]]: msg } }));
          else if (field === "salesPageId") setSalesError(msg);
          setFormError(msg);
        },
      },
    );
  }

  async function viewFunnel() {
    if (!created) return;
    const res = await preview.run({ offerId, pageId: created.quiz.id });
    if (res.ok) window.open(res.data.url, "_blank", "noopener");
  }

  const pending = create.pending;

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[94vh] overflow-y-auto sm:max-w-3xl">
        {created ? (
          <CreatedView
            offerId={offerId}
            created={created}
            salesDocumentId={pages.find((p) => p.id === created.sales.id)?.documentId ?? null}
            onClose={() => onOpenChange(false)}
            onView={() => void viewFunnel()}
            viewing={preview.pending}
          />
        ) : (
          <form
            onSubmit={submit}
            noValidate
            onKeyDown={(e) => {
              // Enter num campo (gesto comum depois de colar o link) não cria o funil: só o botão "Criar funil" cria.
              if (e.key === "Enter" && e.target instanceof HTMLInputElement) e.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>Adicionar funil Quiz → Roleta</DialogTitle>
              <DialogDescription>
                Cria a página do quiz e a da roleta de desconto, já ligadas: quem vem do anúncio responde o quiz, gira a
                roleta e chega à página de vendas com o desconto que ganhou.
              </DialogDescription>
            </DialogHeader>

            <FlowSteps salesName={sales?.name ?? "Página de vendas"} className="mt-5" />

            {warning && (
              <Callout variant="warning" title="Já existe um funil nesta oferta" className="mt-4">
                {warning}
              </Callout>
            )}

            <div className="mt-5 flex flex-col gap-6">
              <Field data-invalid={Boolean(salesError)}>
                <FieldLabel htmlFor="funnel-sales">Página de vendas (depois da roleta)</FieldLabel>
                <Select
                  value={salesPageId}
                  onValueChange={(v) => {
                    setSalesPageId(v);
                    setSalesError(null);
                  }}
                >
                  <SelectTrigger id="funnel-sales" className="w-full sm:w-96" aria-invalid={Boolean(salesError)}>
                    <SelectValue placeholder="Escolha a página" />
                  </SelectTrigger>
                  <SelectContent>
                    {pages.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.isHome ? `${p.name} (página inicial)` : p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  O botão “Resgatar” da roleta leva para ela, com a faixa do desconto no topo.
                  {sales?.isHome && (
                    <>
                      {" "}
                      O quiz passa a ser a página inicial (o link do anúncio abre nele) e “{sales.name}” continua na
                      oferta, em <span className="font-mono">/{sales.slug}/</span>.
                    </>
                  )}
                </FieldDescription>
                <FieldError>{salesError}</FieldError>
              </Field>

              <fieldset className="flex min-w-0 flex-col gap-3">
                <legend className="mb-1 text-sm font-medium">Prêmios da roleta</legend>
                <p className="-mt-1 text-sm text-muted-foreground">
                  Cole o link do checkout com o desconto de cada prêmio (ele vira um link da oferta). Pode deixar em
                  branco para preencher depois: o app avisa até estar tudo ligado.
                </p>
                <div
                  aria-hidden="true"
                  className="hidden gap-2 px-3 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[7.5rem_5.5rem_minmax(0,1fr)_8.5rem_2rem]"
                >
                  <span>Prêmio</span>
                  <span>Chance</span>
                  <span>Link do checkout com desconto</span>
                  <span>Cupom (opcional)</span>
                  <span />
                </div>
                <ol ref={listRef} aria-label="Prêmios da roleta" className="flex flex-col gap-2">
                  {rows.map((row, i) => (
                    <PrizeRow
                      key={row.key}
                      row={row}
                      index={i}
                      realChance={total !== 100 ? real[i] : null}
                      errors={errors[row.key]}
                      canRemove={rows.length > FUNNEL_MIN_PRIZES}
                      onChange={(patch) => update(row.key, patch)}
                      onRemove={() => {
                        setRows((list) => list.filter((r) => r.key !== row.key));
                        setFormError(null);
                      }}
                    />
                  ))}
                </ol>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addRow}
                    disabled={rows.length >= FUNNEL_MAX_PRIZES}
                  >
                    <PlusIcon />
                    {rows.length >= FUNNEL_MAX_PRIZES ? `Máximo de ${FUNNEL_MAX_PRIZES} prêmios` : "Adicionar prêmio"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {total === 100
                      ? "As chances somam 100%."
                      : `As chances somam ${total}: cada prêmio sai na proporção do número dele (a chance real aparece ao lado).`}
                  </p>
                </div>
              </fieldset>
            </div>

            {formError && (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {formError}
              </p>
            )}

            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Spinner />}
                {warning ? "Criar outro funil" : "Criar funil"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Quiz → Roleta → página de vendas, em etiquetas. */
function FlowSteps({ salesName, className }: { salesName: string; className?: string }) {
  const steps = ["Anúncio", "Quiz", "Roleta", salesName];
  return (
    <ol aria-label="Caminho do visitante" className={`flex flex-wrap items-center gap-1.5 text-sm ${className ?? ""}`}>
      {steps.map((s, i) => (
        <li key={`${i}-${s}`} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <span
            className={
              i === 1 || i === 2
                ? "rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary"
                : "max-w-56 truncate rounded-md border px-2 py-0.5 text-muted-foreground"
            }
          >
            {s}
          </span>
        </li>
      ))}
    </ol>
  );
}

function PrizeRow({
  row,
  index,
  realChance,
  errors,
  canRemove,
  onChange,
  onRemove,
}: {
  row: Row;
  index: number;
  /** Chance real em % (só quando as chances não somam 100). */
  realChance: number | null;
  errors?: PrizeProblems;
  canRemove: boolean;
  onChange: (patch: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  const name = row.text.trim() || `prêmio ${n}`;
  const hint = !errors?.url ? linkUrlHint(row.url) : null;
  const mobileLabel = "text-xs font-medium text-muted-foreground sm:hidden";
  const id = useId();
  return (
    <li className="rounded-lg border bg-card p-3">
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-x-2 gap-y-2 sm:grid-cols-[7.5rem_5.5rem_minmax(0,1fr)_8.5rem_2rem] sm:items-start">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-text`} className={mobileLabel}>
            Prêmio
          </label>
          <Input
            id={`${id}-text`}
            data-prize-text=""
            value={row.text}
            maxLength={PRIZE_TEXT_MAX}
            placeholder="30% OFF"
            aria-label={`Prêmio ${n}`}
            aria-invalid={Boolean(errors?.text)}
            onChange={(e) => onChange({ text: e.target.value })}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-chance`} className={mobileLabel}>
            Chance
          </label>
          <div className="relative">
            <Input
              id={`${id}-chance`}
              type="number"
              inputMode="numeric"
              min={1}
              max={100}
              value={row.chanceText}
              aria-label={`Chance do prêmio ${n} (%)`}
              className="pr-7 tabular-nums"
              onChange={(e) => {
                const text = e.target.value;
                onChange({ chanceText: text, raised: false, ...(text.trim() !== "" && { chance: clampChance(text) }) });
              }}
              onBlur={() => {
                const typed = Number(row.chanceText.replace(",", "."));
                const chance = clampChance(row.chanceText);
                onChange({ chance, chanceText: String(chance), raised: !Number.isFinite(typed) || typed < 1 });
              }}
            />
            <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">
              %
            </span>
          </div>
          {realChance !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              real {realChance.toLocaleString("pt-BR")}%
            </span>
          )}
        </div>
        <div className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
          <label htmlFor={`${id}-url`} className={mobileLabel}>
            Link do checkout com desconto
          </label>
          <Input
            id={`${id}-url`}
            type="url"
            inputMode="url"
            value={row.url}
            placeholder="https://pay.hotmart.com/…"
            aria-label={`Link do checkout com desconto — ${name}`}
            aria-invalid={Boolean(errors?.url)}
            onChange={(e) => onChange({ url: e.target.value })}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor={`${id}-coupon`} className={mobileLabel}>
            Cupom (opcional)
          </label>
          <Input
            id={`${id}-coupon`}
            value={row.coupon}
            maxLength={PRIZE_COUPON_MAX}
            placeholder="Sem cupom"
            aria-label={`Cupom do prêmio ${n} (opcional)`}
            onChange={(e) => onChange({ coupon: e.target.value })}
          />
        </div>
        <div className="flex items-end justify-end sm:items-start">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="sm:mt-0.5"
            onClick={onRemove}
            disabled={!canRemove}
            aria-label={
              canRemove ? `Tirar o prêmio ${name}` : `A roleta precisa de pelo menos ${FUNNEL_MIN_PRIZES} prêmios`
            }
            title={canRemove ? "Tirar este prêmio" : `A roleta precisa de pelo menos ${FUNNEL_MIN_PRIZES} prêmios`}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
      {(errors?.text || errors?.url || hint || row.raised) && (
        <div className="mt-2 flex flex-col gap-1">
          {errors?.text && (
            <p role="alert" className="text-xs text-destructive">
              {errors.text}
            </p>
          )}
          {errors?.url && (
            <p role="alert" className="text-xs text-destructive">
              {errors.url}
            </p>
          )}
          {hint && (
            <p className="flex items-start gap-1.5 text-xs text-warning-foreground dark:text-warning">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {hint}
            </p>
          )}
          {row.raised && (
            <p className="text-xs text-muted-foreground">
              Todo prêmio precisa ter chance de sair (mínimo 1%): um prêmio que aparece na roleta mas nunca sai pode ser
              considerado propaganda enganosa.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

/** Depois de criar: o caminho montado, o que falta e os botões para seguir. */
function CreatedView({
  offerId,
  created,
  salesDocumentId,
  onClose,
  onView,
  viewing,
}: {
  offerId: string;
  created: CreatedFunnel;
  salesDocumentId: string | null;
  onClose: () => void;
  onView: () => void;
  viewing: boolean;
}) {
  const missing = created.missingUrls;
  const steps = [
    { name: created.quiz.name, where: "Página inicial (o link do anúncio abre nela)", home: true },
    { name: created.wheel.name, where: `/${created.wheel.slug}/` },
    { name: created.sales.name, where: `/${created.sales.slug}/ · recebe o desconto ganho` },
  ];
  return (
    <div>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CircleCheckIcon className="size-5 text-success" aria-hidden="true" />
          Funil criado
        </DialogTitle>
        <DialogDescription>
          As páginas já estão ligadas. Troque os textos do quiz e da roleta no editor quando quiser.
        </DialogDescription>
      </DialogHeader>

      <ol aria-label="Funil criado" className="mt-5 flex flex-col divide-y rounded-lg border">
        {steps.map((s, i) => (
          <li key={s.name + s.where} className="flex items-center gap-3 px-3 py-2.5">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary tabular-nums">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 font-medium">
                <span className="truncate">{s.name}</span>
                {s.home && <HomeIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Página inicial" />}
              </p>
              <p className="truncate text-xs text-muted-foreground">{s.where}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex flex-col gap-3">
        {missing.length > 0 && (
          <Callout
            variant="warning"
            title={`${plural(missing.length, "prêmio ficou", "prêmios ficaram")} sem o link do checkout`}
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href={`/ofertas/${offerId}?aba=links`} scroll={false} onClick={onClose}>
                  <LinkIcon />
                  Preencher os links
                </Link>
              </Button>
            }
          >
            Quem ganhar {quotedList(missing)} ainda não recebe o desconto. Os links “Checkout …” já foram criados: cole
            o endereço de cada um em Links e checkouts.
          </Callout>
        )}
        {!created.salesHasCheckoutButtons && (
          <Callout
            variant="warning"
            title="Botões de compra sem link de checkout"
            action={
              salesDocumentId ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/editor/${salesDocumentId}`}>
                    <PencilIcon />
                    Abrir no editor
                  </Link>
                </Button>
              ) : undefined
            }
          >
            Nenhum botão de compra de “{created.sales.name}” está ligado a um link de checkout da oferta. Quem ganhar vê
            a faixa do desconto, mas os botões continuam levando ao endereço de sempre. No editor, ligue os botões de
            compra a um link de checkout da oferta.
          </Callout>
        )}
      </div>

      <DialogFooter className="mt-6">
        <Button type="button" variant="outline" onClick={onClose}>
          Fechar
        </Button>
        <Button type="button" variant="outline" onClick={onView} disabled={viewing}>
          {viewing ? <Spinner /> : <ExternalLinkIcon />}
          Ver o funil
        </Button>
        <Button asChild>
          <Link href={`/editor/${created.quiz.documentId}`}>
            <PencilIcon />
            Abrir o quiz no editor
          </Link>
        </Button>
      </DialogFooter>
    </div>
  );
}
