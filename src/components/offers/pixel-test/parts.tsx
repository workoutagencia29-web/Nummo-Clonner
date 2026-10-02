"use client";

import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  ExternalLinkIcon,
  InfoIcon,
  LightbulbIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PIXEL_VENDOR_LABEL, type PixelVendorId } from "@/lib/tracking/schema";
import type { PixelTestEventRow, PixelTestVendorSummary } from "@/lib/tracking/test-report";
import { cn } from "@/lib/utils";
import {
  type CheckItem,
  CONSENT_MODE_TEXT,
  type ConsentView,
  describeRow,
  rowTime,
  STATUS_BADGE,
  type TestPixel,
  type Tip,
  type Tone,
  VENDOR_STATE_BADGE,
  type VendorChecklist,
  vendorHelpers,
} from "./logic";

const TONE_VARIANT = {
  success: "success",
  warning: "warning",
  destructive: "destructive",
  muted: "outline",
  info: "secondary",
} as const satisfies Record<Tone, string>;

export function ToneBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <Badge variant={TONE_VARIANT[tone]}>{children}</Badge>;
}

// ─── Conferência ─────────────────────────────────────────────────────────────

const CHECK_TEXT = { done: "Feito", pending: "Pendente", failed: "Falhou" } as const;

function CheckIcon({ state }: { state: CheckItem["state"] }) {
  if (state === "done") return <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />;
  if (state === "failed") return <CircleXIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />;
  return <CircleDashedIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}

export function Checklist({
  vendor,
  checklist,
  hints = true,
}: {
  vendor: PixelVendorId;
  checklist: VendorChecklist;
  /** Mostra o que fazer em cada item pendente (antes do teste, só a lista). */
  hints?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <ul aria-label={`Conferência — ${PIXEL_VENDOR_LABEL[vendor]}`} className="flex flex-col gap-2">
        {checklist.items.map((item) => (
          <li key={item.id} data-state={item.state} className="flex gap-2 text-sm">
            <CheckIcon state={item.state} />
            <div className="min-w-0">
              <span className={cn(item.state === "done" && "font-medium")}>{item.label}</span>
              <span className="sr-only"> — {CHECK_TEXT[item.state]}</span>
              {hints && item.hint && item.state !== "done" && (
                <p className={cn("text-xs", item.state === "failed" ? "text-destructive" : "text-muted-foreground")}>
                  {item.hint}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      {checklist.note && <p className="text-xs text-muted-foreground">{checklist.note}</p>}
    </div>
  );
}

// ─── Linha do tempo ──────────────────────────────────────────────────────────

/** Quantos passos cada plataforma mostra (os mais novos). */
const VISIBLE_ROWS = 40;

export function EventRow({ row }: { row: PixelTestEventRow }) {
  const text = describeRow(row);
  const badge = STATUS_BADGE[row.status];
  return (
    <li className="flex gap-3 py-2 text-sm" data-status={row.status}>
      <time className="w-16 shrink-0 font-mono text-xs text-muted-foreground tabular-nums" dateTime={String(row.at)}>
        {rowTime(row)}
      </time>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-all">{text.title}</span>
          <ToneBadge tone={badge.tone}>{badge.label}</ToneBadge>
        </div>
        {text.subtitle && <p className="text-xs text-muted-foreground break-all">{text.subtitle}</p>}
        {text.hint && row.status !== "FIRED" && row.status !== "LOADED" && (
          // Consentimento: explicação (esperando/recusado), não um erro.
          <p className={cn("text-xs", row.vendor === "CONSENT" ? "text-muted-foreground" : "text-destructive")}>
            {text.hint}
          </p>
        )}
      </div>
    </li>
  );
}

export function EventTimeline({ label, rows, empty }: { label: string; rows: PixelTestEventRow[]; empty: string }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  const newest = rows.slice(-VISIBLE_ROWS).reverse();
  const hidden = rows.length - newest.length;
  return (
    <div>
      <ol aria-label={label} className="divide-y">
        {newest.map((row) => (
          <EventRow key={row.id} row={row} />
        ))}
      </ol>
      {hidden > 0 && (
        <p className="pt-2 text-xs text-muted-foreground">
          + {hidden} {hidden === 1 ? "passo anterior" : "passos anteriores"}
        </p>
      )}
    </div>
  );
}

// ─── Plataforma ──────────────────────────────────────────────────────────────

export function VendorCard({
  vendor,
  pixels,
  summary,
  checklist,
  rows,
  idle = false,
}: {
  vendor: PixelVendorId;
  pixels: TestPixel[];
  summary: PixelTestVendorSummary | undefined;
  checklist: VendorChecklist;
  rows: PixelTestEventRow[];
  /** Antes de começar: só o que vai ser conferido (sem linha do tempo). */
  idle?: boolean;
}) {
  const name = PIXEL_VENDOR_LABEL[vendor];
  const badge = VENDOR_STATE_BADGE[summary?.state ?? "WAITING"];
  const helpers = vendorHelpers(
    vendor,
    pixels.map((p) => p.pixelId),
  );
  const headingId = `pixel-test-${vendor.toLowerCase()}`;
  return (
    <section aria-labelledby={headingId} data-vendor={vendor} className="rounded-xl border bg-card shadow-xs">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
        <h3 id={headingId} className="font-semibold">
          {name}
        </h3>
        {!idle && <ToneBadge tone={badge.tone}>{badge.label}</ToneBadge>}
        <span className="ml-auto font-mono text-xs text-muted-foreground break-all">
          {pixels.map((p) => p.pixelId).join(" · ")}
        </span>
      </header>
      {idle ? (
        <div className="flex flex-col gap-2 p-4">
          <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">O que vai ser conferido</h4>
          <Checklist vendor={vendor} checklist={checklist} hints={false} />
        </div>
      ) : (
        <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Conferência</h4>
            <Checklist vendor={vendor} checklist={checklist} />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Linha do tempo</h4>
            <EventTimeline
              label={`Linha do tempo — ${name}`}
              rows={rows}
              empty="Nada ainda. Os passos deste pixel aparecem aqui assim que a página de teste abrir."
            />
          </div>
        </div>
      )}
      {!idle && (helpers.links.length > 0 || helpers.text) && (
        <footer className="flex flex-col gap-1 border-t px-4 py-3 text-xs text-muted-foreground">
          {helpers.text && <p>{helpers.text}</p>}
          {helpers.links.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {helpers.links.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  {link.label}
                  <ExternalLinkIcon aria-hidden className="size-3" />
                  <span className="sr-only">(abre em outra aba)</span>
                </a>
              ))}
            </div>
          )}
        </footer>
      )}
    </section>
  );
}

export function VendorCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4" aria-hidden>
      <div className="flex items-center gap-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-20" />
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
    </div>
  );
}

// ─── Consentimento e página ──────────────────────────────────────────────────

export function ConsentCard({
  consent,
  mode,
  rows,
}: {
  consent: ConsentView;
  mode: keyof typeof CONSENT_MODE_TEXT;
  rows: PixelTestEventRow[];
}) {
  return (
    <section aria-labelledby="pixel-test-consent" className="rounded-xl border bg-card shadow-xs">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        <ShieldCheckIcon aria-hidden className="size-4 text-muted-foreground" />
        <h3 id="pixel-test-consent" className="font-semibold">
          Consentimento (LGPD)
        </h3>
        <ToneBadge tone={consent.tone}>{consent.label}</ToneBadge>
      </header>
      <div className="flex flex-col gap-3 p-4">
        <p className="text-xs text-muted-foreground">Nesta oferta: {CONSENT_MODE_TEXT[mode]}.</p>
        {consent.hint && <p className="text-sm">{consent.hint}</p>}
        <EventTimeline
          label="Linha do tempo — página e consentimento"
          rows={rows}
          empty="A página de teste ainda não foi aberta."
        />
      </div>
    </section>
  );
}

// ─── Dicas ───────────────────────────────────────────────────────────────────

const TIP_ICON = {
  error: <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />,
  warning: <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />,
  info: <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />,
} as const;

export function TipsCard({ tips }: { tips: Tip[] }) {
  return (
    <section aria-labelledby="pixel-test-tips" className="rounded-xl border bg-card shadow-xs">
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <LightbulbIcon aria-hidden className="size-4 text-muted-foreground" />
        <h3 id="pixel-test-tips" className="font-semibold">
          Dicas
        </h3>
      </header>
      {tips.length ? (
        <ul className="flex flex-col gap-3 p-4">
          {tips.map((tip) => (
            <li key={tip.id} data-tip={tip.id} className="flex gap-2 text-sm">
              {TIP_ICON[tip.tone]}
              <div className="min-w-0">
                <p className="font-medium">{tip.title}</p>
                <p className="text-muted-foreground">{tip.text}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">Nenhum problema encontrado até agora.</p>
      )}
    </section>
  );
}
