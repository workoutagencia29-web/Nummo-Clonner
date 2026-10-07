"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { OPEN_EXPORT_EVENT } from "@/components/offers/export/logic";
import { offerLinkHref } from "@/components/offers/offer-link-href";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { Readiness, ReadinessItem } from "@/lib/readiness";
import { cn } from "@/lib/utils";

const COLLAPSED_KEY = "os:proximos-passos-recolhido";

/** Ofertas com o cartão recolhido (só neste navegador: é uma preferência de tela). */
function readCollapsed(offerId: string) {
  try {
    const list = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    return Array.isArray(list) && list.includes(offerId);
  } catch {
    return false;
  }
}

function writeCollapsed(offerId: string, collapsed: boolean) {
  try {
    const raw = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? "[]");
    const list: string[] = Array.isArray(raw) ? raw.filter((v) => typeof v === "string" && v !== offerId) : [];
    if (collapsed) list.push(offerId);
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(list.slice(-200)));
  } catch {
    // Sem armazenamento (janela privada): o cartão só não lembra.
  }
}

function ItemAction({ offerId, item }: { offerId: string; item: ReadinessItem }) {
  const variant = item.done ? "ghost" : "outline";
  // "Informar: Informar onde está no ar" seria lido repetido: o título já diz a ação.
  const aria = item.title.toLowerCase().startsWith(item.cta.toLowerCase()) ? item.title : `${item.cta}: ${item.title}`;
  if ("export" in item.target) {
    return (
      <Button
        size="sm"
        variant={variant}
        aria-label={aria}
        onClick={() => window.dispatchEvent(new Event(OPEN_EXPORT_EVENT))}
      >
        {item.cta}
      </Button>
    );
  }
  if ("settings" in item.target) {
    return (
      <Button size="sm" variant={variant} asChild>
        <Link href={`/configuracoes#${item.target.settings}`} aria-label={aria}>
          {item.cta}
        </Link>
      </Button>
    );
  }
  if ("link" in item.target) {
    return (
      <Button size="sm" variant={variant} asChild>
        <Link href={offerLinkHref(offerId, item.target.link)} scroll={false} aria-label={aria}>
          {item.cta}
        </Link>
      </Button>
    );
  }
  if ("editor" in item.target) {
    return (
      <Button size="sm" variant={variant} asChild>
        <Link href={`/editor/${item.target.editor}`} aria-label={aria}>
          {item.cta}
        </Link>
      </Button>
    );
  }
  return (
    <Button size="sm" variant={variant} asChild>
      <Link href={`/ofertas/${offerId}?aba=${item.target.tab}`} scroll={false} aria-label={aria}>
        {item.cta}
      </Link>
    </Button>
  );
}

/**
 * "Próximos passos": o que falta para a oferta sair pronta no ZIP, cada passo com
 * o atalho para onde se resolve. Some quando os passos obrigatórios estão prontos;
 * dá para recolher (fica lembrado neste navegador).
 */
export function ReadinessCard({ offerId, readiness }: { offerId: string; readiness: Readiness }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(readCollapsed(offerId)), [offerId]);

  if (readiness.complete) return null;
  const percent = readiness.total ? Math.round((readiness.done / readiness.total) * 100) : 0;
  const listId = `readiness-list-${offerId}`;
  return (
    <section aria-labelledby="readiness-title" className="rounded-xl border bg-card text-card-foreground shadow-xs">
      <div className={cn("flex items-center gap-3 p-4", !collapsed && "border-b")}>
        <div className="min-w-0 flex-1">
          <h2 id="readiness-title" className="font-semibold">
            Próximos passos
          </h2>
          <p className="text-sm text-muted-foreground">O que falta para a oferta sair pronta no ZIP.</p>
        </div>
        <Progress value={percent} aria-label="Passos concluídos" className="hidden h-1.5 w-40 sm:block" />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {readiness.done} de {readiness.total}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-expanded={!collapsed}
          aria-controls={listId}
          aria-label={collapsed ? "Mostrar os próximos passos" : "Recolher os próximos passos"}
          onClick={() => {
            setCollapsed(!collapsed);
            writeCollapsed(offerId, !collapsed);
          }}
        >
          <ChevronDownIcon className={cn("transition-transform", !collapsed && "rotate-180")} />
        </Button>
      </div>
      <ol id={listId} hidden={collapsed} className="divide-y">
        {readiness.items.map((item) => (
          <li
            key={item.id}
            data-done={item.done || undefined}
            className="flex items-start gap-3 px-4 py-3 sm:items-center"
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border sm:mt-0",
                item.done ? "border-success bg-success text-success-foreground" : "border-muted-foreground/40",
              )}
            >
              {item.done && <CheckIcon className="size-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium",
                  item.done && "text-muted-foreground",
                )}
              >
                <span>{item.title}</span>
                <span className="sr-only">{item.done ? "(feito)" : "(pendente)"}</span>
                {item.optional && !item.done && <Badge variant="secondary">Opcional</Badge>}
              </p>
              <p className="text-sm text-muted-foreground">{item.detail}</p>
            </div>
            <div className="shrink-0">
              <ItemAction offerId={offerId} item={item} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
