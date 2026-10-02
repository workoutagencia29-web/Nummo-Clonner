"use client";

import {
  CopyIcon,
  ExternalLinkIcon,
  FlaskConicalIcon,
  PlayIcon,
  RotateCcwIcon,
  SettingsIcon,
  SquareIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { useAction } from "@/hooks/use-action";
import { summarizePixelTest } from "@/lib/tracking/test-report";
import { cn } from "@/lib/utils";
import { createPixelTestSessionAction, endPixelTestSessionAction } from "@/server/actions/tracking";
import {
  chosenVariantId,
  consentState,
  defaultPageId,
  formatCountdown,
  type PixelTestSetup,
  pageVariants,
  parseChoices,
  pixelSettingsHref,
  pixelTestChoicesUrl,
  pixelTestStartInput,
  readStoredSession,
  reportedVersion,
  rulesForPage,
  type StoredSession,
  sessionStorageKey,
  staleChoiceMessage,
  type TestPage,
  testSteps,
  toStoredSession,
  troubleshootingTips,
  validPageId,
  variantChoiceLabel,
  vendorChecklist,
  vendorsOf,
} from "./logic";
import { ConsentCard, TipsCard, VendorCard, VendorCardSkeleton } from "./parts";
import { usePixelTestPoll } from "./use-pixel-test-poll";

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Navegação privada/armazenamento bloqueado: o teste só não sobrevive a recarregar a tela.
  }
}

/**
 * Tempo que falta, atualizado a cada segundo só aqui (a tela não redesenha
 * inteira a cada segundo). Chama `onExpire` uma vez quando chega a zero.
 */
function Countdown({ expiresAt, onExpire }: { expiresAt: number; onExpire: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const expired = expiresAt <= now;
  useEffect(() => {
    if (expired) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expired]);
  useEffect(() => {
    if (expired) onExpire();
  }, [expired, onExpire]);
  return <span className="tabular-nums">{formatCountdown(expiresAt - now)}</span>;
}

/**
 * Tela "Testar pixels": escolhe a página → "Iniciar teste" → abre a página em
 * modo teste numa aba nova (pixels de verdade precisam de uma página de
 * verdade) → a linha do tempo mostra, ao vivo, cada pixel carregando e cada
 * evento disparando, com a lista de conferência de cada plataforma e dicas.
 */
export function PixelTestScreen({ setup }: { setup: PixelTestSetup }) {
  const storageKey = sessionStorageKey(setup.offerId);
  /**
   * Páginas e versões buscadas de novo depois de um "Iniciar teste" recusado
   * (página/versão excluída em outra aba); até lá, as da tela.
   */
  const [freshPages, setFreshPages] = useState<TestPage[] | null>(null);
  const pages = freshPages ?? setup.pages;
  const pageIds = useMemo(() => setup.pages.map((p) => p.id), [setup.pages]);
  const variantIds = useMemo(() => setup.pages.flatMap((p) => p.variants?.map((v) => v.id) ?? []), [setup.pages]);
  const [pageId, setPageId] = useState<string | null>(() => defaultPageId(setup.pages));
  /** Versão A/B escolhida (só vale para a página escolhida; sem escolha, a de controle). */
  const [pickedVariant, setPickedVariant] = useState<string | null>(null);
  const [session, setSession] = useState<StoredSession | null>(null);
  const [restored, setRestored] = useState(false);
  /** Sessão cujo prazo de 2 horas acabou (pelo relógio da tela). */
  const [timeUpFor, setTimeUpFor] = useState<string | null>(null);
  const start = useAction(createPixelTestSessionAction);
  const end = useAction(endPixelTestSessionAction);
  const poll = usePixelTestPoll(session?.id ?? null);

  // Recarregou a tela: continua o teste desta aba (se ainda vale).
  useEffect(() => {
    const saved = readStoredSession(readStorage(storageKey), Date.now(), pageIds, variantIds);
    if (saved) {
      setSession(saved);
      if (saved.pageId) setPageId(saved.pageId);
      if (saved.variantId) setPickedVariant(saved.variantId);
    }
    setRestored(true);
  }, [storageKey, pageIds, variantIds]);

  useEffect(() => {
    if (!restored) return;
    writeStorage(storageKey, session && !session.ended ? JSON.stringify(session) : null);
  }, [restored, session, storageKey]);

  const sessionId = session?.id ?? null;
  const expiresAt = session ? Date.parse(session.expiresAt) : 0;
  const serverExpired = poll.session?.expired === true;
  const timeUp = sessionId !== null && timeUpFor === sessionId;
  const finished = Boolean(session) && (session?.ended || serverExpired || timeUp || Boolean(poll.fatal));
  const running = Boolean(session) && !finished;
  const onExpire = useCallback(() => setTimeUpFor(sessionId), [sessionId]);

  // Venceu pelo relógio: uma última leitura (o servidor confirma e a leitura para).
  const refreshedAtExpiry = useRef<string | null>(null);
  const { refresh } = poll;
  useEffect(() => {
    if (sessionId && timeUp && !serverExpired && refreshedAtExpiry.current !== sessionId) {
      refreshedAtExpiry.current = sessionId;
      refresh();
    }
  }, [sessionId, timeUp, serverExpired, refresh]);

  /** Página escolhida (se foi excluída em outra aba e a lista já foi atualizada, a inicial). */
  const selectedPageId = validPageId(pages, pageId);
  const testedPageId = session ? session.pageId : selectedPageId;
  const testedPage = pages.find((p) => p.id === testedPageId);
  /** Versões da página escolhida (com mais de uma, aparece o "Versão"). */
  const variants = pageVariants(pages, selectedPageId);
  const variantId = chosenVariantId(variants, pickedVariant);
  const testedVariant = session?.variantId ? testedPage?.variants?.find((v) => v.id === session.variantId) : undefined;
  const sessionVendors = session?.vendors;
  const vendors = useMemo(
    () => (sessionVendors?.length ? sessionVendors : vendorsOf(setup.pixels)),
    [sessionVendors, setup.pixels],
  );
  const rules = useMemo(() => rulesForPage(setup.rules, testedPageId), [setup.rules, testedPageId]);
  const events = poll.events;
  const summaries = useMemo(() => summarizePixelTest(events, vendors), [events, vendors]);
  const consent = useMemo(
    () => consentState(events, { mode: setup.consentMode, acceptLabel: setup.acceptLabel }),
    [events, setup.consentMode, setup.acceptLabel],
  );
  const cards = useMemo(
    () =>
      vendors.map((vendor) => {
        const pixels = setup.pixels.filter((p) => p.vendor === vendor);
        const summary = summaries.find((s) => s.vendor === vendor);
        return {
          vendor,
          pixels,
          summary,
          rows: events.filter((e) => e.vendor === vendor),
          checklist: vendorChecklist({
            vendor,
            pixels,
            rules,
            eventNames: setup.eventNames,
            links: setup.links,
            events,
            summary,
            consent,
            acceptLabel: setup.acceptLabel,
          }),
        };
      }),
    [vendors, setup.pixels, setup.eventNames, setup.links, setup.acceptLabel, summaries, events, rules, consent],
  );
  const pageRows = useMemo(() => events.filter((e) => e.vendor === "CONSENT" || e.vendor === "RUNTIME"), [events]);
  /** Versão A/B testada: a escolhida ou, se ela sumiu da lista, a que a página de teste informou. */
  const testedVersion = testedVariant?.name ?? reportedVersion(pageRows);
  const tips = useMemo(
    () =>
      troubleshootingTips({
        events,
        summaries,
        pixels: setup.pixels,
        rules,
        consent,
        running,
        full: poll.session?.full === true,
        acceptLabel: setup.acceptLabel,
      }),
    [events, summaries, setup.pixels, setup.acceptLabel, rules, consent, running, poll.session?.full],
  );
  const steps = testSteps(setup);

  if (!setup.pixels.length) {
    return (
      <Empty className="border border-dashed py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FlaskConicalIcon />
          </EmptyMedia>
          <EmptyTitle>Nenhum pixel ligado nesta oferta</EmptyTitle>
          <EmptyDescription>
            {setup.disabledPixels
              ? "Os pixels desta oferta estão desligados. Ligue pelo menos um para testar."
              : "Cadastre o pixel da Meta, do TikTok, do Google ou de outra plataforma e volte aqui para ver tudo funcionando."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild>
            <Link href={pixelSettingsHref(setup.offerId)}>
              <SettingsIcon />
              Configurar pixels
            </Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  if (!pages.length) {
    return (
      <Empty className="border border-dashed py-16">
        <EmptyHeader>
          <EmptyTitle>Esta oferta não tem páginas</EmptyTitle>
          <EmptyDescription>Crie uma página no funil para testar os pixels nela.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button asChild variant="outline">
            <Link href={`/ofertas/${setup.offerId}`}>Ver páginas do funil</Link>
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  function begin() {
    void start.run(pixelTestStartInput(setup.offerId, selectedPageId, variants, pickedVariant), {
      silentError: true,
      onSuccess: (view) => setSession(toStoredSession(view)),
      onError: (error, field) => {
        const stale = staleChoiceMessage(field);
        toast.error(stale ?? error);
        if (!stale) return;
        // A página ou a versão foi excluída em outra aba: busca as opções de
        // novo (a escolha volta para a versão de controle / página inicial).
        setPickedVariant(null);
        fetch(pixelTestChoicesUrl(setup.offerId), { cache: "no-store" })
          .then((res) => (res.ok ? res.json() : null))
          .then((json) => {
            const fresh = parseChoices(json);
            if (fresh) setFreshPages(fresh);
          })
          .catch(() => {
            // Sem resposta: a lista fica como está (a mensagem já pediu para conferir).
          });
      },
    });
  }

  function stop() {
    if (!session) return;
    void end.run(
      { sessionId: session.id },
      {
        success: "Teste encerrado. O link da página de teste parou de funcionar.",
        onSuccess: () => {
          setSession((s) => (s ? { ...s, ended: true } : s));
          refresh();
        },
      },
    );
  }

  function copyLink() {
    if (!session) return;
    navigator.clipboard.writeText(session.url).then(
      () => toast.success("Link copiado. Cole em outro navegador para testar lá também."),
      () => toast.error("Não foi possível copiar. Use “Abrir página de teste”."),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="Controle do teste"
        className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-xs sm:p-5"
      >
        {!session && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-56 flex-col gap-1.5">
                <Label htmlFor="pixel-test-page">Página para testar</Label>
                <Select
                  value={selectedPageId ?? undefined}
                  onValueChange={(v) => {
                    setPageId(v);
                    // Outra página: a versão volta para a de controle dela.
                    setPickedVariant(null);
                  }}
                  disabled={!restored || start.pending}
                >
                  <SelectTrigger id="pixel-test-page" className="w-full min-w-56" aria-label="Página para testar">
                    <SelectValue placeholder="Escolha a página" />
                  </SelectTrigger>
                  <SelectContent>
                    {pages.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.isHome ? `${p.name} (inicial)` : p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {variants.length > 1 && (
                <div className="flex min-w-48 flex-col gap-1.5">
                  <Label htmlFor="pixel-test-variant">Versão</Label>
                  <Select
                    value={variantId ?? undefined}
                    onValueChange={(v) => setPickedVariant(v)}
                    disabled={!restored || start.pending}
                  >
                    <SelectTrigger id="pixel-test-variant" className="w-full min-w-48" aria-label="Versão para testar">
                      <SelectValue placeholder="Escolha a versão" />
                    </SelectTrigger>
                    <SelectContent>
                      {variants.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {variantChoiceLabel(v)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button onClick={begin} disabled={!restored || start.pending}>
                {start.pending ? <Spinner /> : <PlayIcon />}
                Iniciar teste
              </Button>
            </div>
            <div className="flex flex-col gap-1 text-sm text-muted-foreground">
              <p>
                {setup.pixels.length === 1
                  ? "1 pixel vai carregar de verdade"
                  : `${setup.pixels.length} pixels vão carregar de verdade`}
                {setup.disabledPixels > 0 &&
                  ` · ${setup.disabledPixels} ${setup.disabledPixels === 1 ? "desligado fica" : "desligados ficam"} de fora`}
                .
              </p>
              <p className="text-xs">
                A página abre numa aba nova e cada teste vale por 2 horas. Os eventos do teste são de verdade e aparecem
                nos relatórios das plataformas: no checkout, não conclua a compra.
              </p>
            </div>
          </>
        )}

        {session && running && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  <span className="relative flex size-2.5" aria-hidden>
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-success" />
                  </span>
                  Teste em andamento
                </p>
                <p className="text-sm text-muted-foreground">
                  {testedPage ? `Página: ${testedPage.name} · ` : ""}
                  {testedVersion ? `Versão ${testedVersion} · ` : ""}vence em{" "}
                  <Countdown expiresAt={expiresAt} onExpire={onExpire} />
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <a href={session.url} target="_blank" rel="noopener noreferrer">
                    <ExternalLinkIcon />
                    Abrir página de teste
                  </a>
                </Button>
                <Button variant="outline" onClick={copyLink}>
                  <CopyIcon />
                  Copiar link
                </Button>
                <Button variant="ghost" onClick={stop} disabled={end.pending}>
                  {end.pending ? <Spinner /> : <SquareIcon />}
                  Encerrar teste
                </Button>
              </div>
            </div>
            <ol
              className={cn(
                "grid gap-1 text-sm text-muted-foreground",
                steps.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2",
              )}
            >
              {steps.map((step, i) => (
                <li key={step}>
                  {i + 1}. {step}
                </li>
              ))}
            </ol>
          </>
        )}

        {session && finished && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {poll.fatal ? "Teste indisponível" : session.ended ? "Teste encerrado" : "Este teste venceu"}
              </p>
              <p className="text-sm text-muted-foreground">
                {poll.fatal ??
                  (session.ended
                    ? "O link da página de teste parou de funcionar. O resultado continua abaixo."
                    : "Cada teste vale por 2 horas. O resultado continua abaixo.")}
              </p>
            </div>
            <Button onClick={() => setSession(null)}>
              <RotateCcwIcon />
              Começar novo teste
            </Button>
          </div>
        )}

        {poll.error && !poll.fatal && (
          <output className="flex items-center gap-2 text-sm text-destructive">
            <TriangleAlertIcon className="size-4 shrink-0" aria-hidden />
            {poll.error}
          </output>
        )}
      </section>

      <p aria-live="polite" className="sr-only">
        {session ? `${events.length} ${events.length === 1 ? "passo recebido" : "passos recebidos"}` : ""}
      </p>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {/* Antes das plataformas no DOM: em telas menores, consentimento e dicas ficam no topo. */}
        <aside
          className="grid min-w-0 gap-4 md:grid-cols-2 xl:col-start-2 xl:row-start-1 xl:grid-cols-1"
          aria-label="Consentimento e dicas"
        >
          <ConsentCard consent={consent} mode={setup.consentMode} rows={pageRows} />
          <TipsCard tips={tips} />
        </aside>
        <div className={cn("grid min-w-0 gap-4 xl:col-start-1 xl:row-start-1", !session && "lg:grid-cols-2")}>
          <h2 className="sr-only">Pixels</h2>
          {session && poll.loading
            ? vendors.map((v) => <VendorCardSkeleton key={v} />)
            : cards.map((card) => <VendorCard key={card.vendor} {...card} idle={!session} />)}
        </div>
      </div>
    </div>
  );
}
