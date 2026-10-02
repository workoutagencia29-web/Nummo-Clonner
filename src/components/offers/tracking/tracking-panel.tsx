"use client";

/**
 * Aba "Pixels e rastreamento" da oferta: resumo + "Testar pixels" no topo e,
 * ao lado, as partes (Pixels, Eventos, Privacidade, UTMs, Código livre).
 * Os dados vêm de getTrackingPanel (src/server/services/tracking.ts); cada
 * formulário salva só a parte dele.
 */
import {
  CodeXmlIcon,
  FlaskConicalIcon,
  Link2Icon,
  type LucideIcon,
  MousePointerClickIcon,
  RadarIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { replaceQuery } from "@/hooks/replace-query";
import { plural } from "@/lib/format";
import type { ConsentModeId } from "@/lib/tracking/schema";
import { cn } from "@/lib/utils";
import type { TrackingPanel as TrackingPanelData } from "@/server/services/tracking";
import { CodeSection, trackerRisk } from "./code-section";
import { ConsentSection } from "./consent-section";
import { EventNamesForm } from "./event-names-form";
import { ForwardingSection } from "./forwarding-section";
import { type TrackingSectionId, testPixelsHref } from "./helpers";
import { PixelsSection } from "./pixels-section";
import { RulesSection } from "./rules-section";
import { ValueForm } from "./value-form";
import { VendorIcon } from "./vendor-icon";

const CONSENT_SHORT: Record<ConsentModeId, string> = {
  OPT_IN: "Pede permissão (LGPD)",
  NOTICE: "Só avisa sobre cookies",
  OFF: "Sem aviso de cookies",
};

/** Tela larga (lg): a lista de partes fica na vertical, ao lado; abaixo disso, em grade no topo. */
const WIDE = "(min-width: 1024px)";
function subscribeWide(onChange: () => void) {
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function useWide() {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

/** As partes continuam montadas (escondidas): trocar de parte não perde o que não foi salvo. */
const KEEP = { forceMount: true, className: "data-[state=inactive]:hidden" } as const;

function StatusItem({ tone, children }: { tone: "on" | "off" | "warn"; children: React.ReactNode }) {
  return (
    <li className={cn("flex items-center gap-2", tone === "off" && "text-muted-foreground")}>
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          tone === "on" && "bg-success",
          tone === "off" && "bg-muted-foreground/40",
          tone === "warn" && "bg-warning",
        )}
      />
      {children}
    </li>
  );
}

function NavItem({
  value,
  icon: Icon,
  label,
  hint,
  alert,
}: {
  value: TrackingSectionId;
  icon: LucideIcon;
  label: string;
  hint?: string;
  alert?: boolean;
}) {
  return (
    <TabsTrigger
      value={value}
      className="h-auto min-w-0 flex-none justify-start gap-3 rounded-lg px-3 py-2 text-left data-[state=active]:bg-card data-[state=active]:shadow-sm lg:w-full"
    >
      <Icon className="size-4 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col">
        {/* Na grade do celular o nome quebra linha (nunca some cortado); na lista lateral, uma linha. */}
        <span className="whitespace-normal break-words lg:truncate lg:whitespace-nowrap">{label}</span>
        {hint && <span className="hidden truncate font-normal text-muted-foreground text-xs lg:block">{hint}</span>}
      </span>
      {alert && <TriangleAlertIcon className="size-3.5 text-warning" aria-label="Precisa de atenção" />}
    </TabsTrigger>
  );
}

export function TrackingPanel({
  data,
  initialSection = "pixels",
}: {
  data: TrackingPanelData;
  initialSection?: TrackingSectionId;
}) {
  const { offer, pixels, settings, rules, pages, links } = data;
  const activePixels = pixels.filter((p) => p.enabled);
  const activeRules = rules.filter((r) => r.enabled).length;
  const vendors = [...new Set(activePixels.map((p) => p.vendor))];
  // Pixel desligado não carrega nem recebe evento: só os ativos contam.
  const consentRisk = settings.consent.mode === "OFF" && activePixels.length > 0;
  // Código "Essencial" com pixel colado: carrega antes do "Aceitar".
  const codeRisk =
    trackerRisk(settings.customCode.category, data.offerCodeTrackers, settings.consent.mode) ||
    pages.some((p) => p.hasCode && trackerRisk(p.codeCategory, p.codeTrackers, settings.consent.mode));
  // Pixel no HTML da página (fora dos códigos da página): também carrega antes do "Aceitar".
  const htmlRisk = settings.consent.mode === "OPT_IN" && pages.some((p) => p.htmlTrackers.length > 0);
  // O aviso do "Pedir permissão" aparece para todos com pixel ativo ou código de
  // estatística/marketing (da oferta ou de alguma página); sem nada disso, só
  // para quem chega de um anúncio (ver optInNoPixelsNote).
  const offerCode = settings.customCode;
  const asksEveryone =
    activePixels.length > 0 ||
    (offerCode.category !== "NECESSARY" &&
      [offerCode.head, offerCode.bodyStart, offerCode.bodyEnd].some((c) => c.trim())) ||
    pages.some((p) => p.hasCode && p.codeCategory !== "NECESSARY");
  const wide = useWide();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-lg tracking-tight">Pixels e rastreamento</h2>
            {vendors.length > 0 && (
              <span className="flex -space-x-1.5" aria-hidden="true">
                {vendors.map((v) => (
                  <VendorIcon key={v} vendor={v} size="sm" className="size-6 ring-2 ring-card [&_svg]:size-3" />
                ))}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Tudo aqui vale só para esta oferta — pixels, eventos, aviso de cookies e repasse de UTMs — na prévia e no
            ZIP.
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm" aria-label="Resumo">
            <StatusItem tone={activePixels.length === 0 ? "off" : "on"}>
              {pixels.length === 0
                ? "Nenhum pixel"
                : activePixels.length === 0
                  ? `Nenhum pixel ativo (${plural(pixels.length, "desligado", "desligados")})`
                  : activePixels.length === pixels.length
                    ? plural(pixels.length, "pixel ativo", "pixels ativos")
                    : `${activePixels.length} de ${plural(pixels.length, "pixel ativo", "pixels ativos")}`}
            </StatusItem>
            {/* Sem pixel ativo, nenhum evento sai: as regras ficam em cinza. */}
            <StatusItem tone={activeRules === 0 || activePixels.length === 0 ? "off" : "on"}>
              {activeRules === 0
                ? "Só PageView"
                : `PageView + ${plural(activeRules, "regra", "regras")}${activePixels.length === 0 ? " (sem pixel ativo)" : ""}`}
            </StatusItem>
            <StatusItem
              tone={consentRisk || codeRisk || htmlRisk ? "warn" : settings.consent.mode === "OPT_IN" ? "on" : "off"}
            >
              {CONSENT_SHORT[settings.consent.mode]}
            </StatusItem>
            {codeRisk && (
              <StatusItem tone="warn">
                Código livre com pixel carrega antes do “{settings.consent.acceptLabel}”
              </StatusItem>
            )}
            {htmlRisk && (
              <StatusItem tone="warn">
                Pixel no HTML de uma página carrega antes do “{settings.consent.acceptLabel}”
              </StatusItem>
            )}
            <StatusItem tone={settings.forwarding.enabled ? "on" : "off"}>
              {settings.forwarding.enabled ? "Repassa UTMs" : "Não repassa UTMs"}
            </StatusItem>
          </ul>
        </div>
        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <Button asChild size="lg">
            <Link href={testPixelsHref(offer.id)}>
              <FlaskConicalIcon />
              Testar pixels
            </Link>
          </Button>
          <span className="text-center text-xs text-muted-foreground sm:text-right">
            Abre a página com os pixels de verdade
            <br className="hidden sm:block" /> e mostra cada evento aqui no painel.
          </span>
        </div>
      </div>

      <Tabs
        defaultValue={initialSection}
        // A parte escolhida vai para o endereço (?secao=): recarregar ou voltar do "Testar pixels" volta nela.
        onValueChange={(v) => replaceQuery({ aba: "rastreamento", secao: v === "pixels" ? null : v })}
        orientation={wide ? "vertical" : "horizontal"}
        className="gap-6 lg:flex-row lg:items-start"
      >
        <TabsList
          aria-label="Partes do rastreamento"
          className="grid h-auto w-full grid-cols-2 gap-1 bg-muted/60 p-1 sm:grid-cols-3 lg:sticky lg:top-4 lg:flex lg:w-60 lg:shrink-0 lg:flex-col lg:items-stretch"
        >
          <NavItem
            value="pixels"
            icon={RadarIcon}
            label={pixels.length ? `Pixels (${pixels.length})` : "Pixels"}
            hint="Meta, TikTok, Google…"
            alert={data.pixelsNeedingToken > 0}
          />
          <NavItem
            value="eventos"
            icon={MousePointerClickIcon}
            label={rules.length ? `Eventos (${rules.length})` : "Eventos"}
            hint="Quando cada evento dispara"
          />
          <NavItem
            value="privacidade"
            icon={ShieldCheckIcon}
            label="Privacidade (LGPD)"
            hint="Aviso de cookies"
            alert={consentRisk}
          />
          <NavItem value="utms" icon={Link2Icon} label="UTMs e checkout" hint="Repasse de UTMs e IDs de clique" />
          <NavItem
            value="codigo"
            icon={CodeXmlIcon}
            label="Código livre"
            hint="Scripts de outras ferramentas"
            alert={codeRisk || htmlRisk}
          />
        </TabsList>

        <div className="min-w-0 flex-1">
          <TabsContent value="pixels" {...KEEP}>
            <PixelsSection offerId={offer.id} pixels={pixels} />
          </TabsContent>
          <TabsContent value="eventos" {...KEEP} className="flex flex-col gap-6 data-[state=inactive]:hidden">
            <RulesSection
              offerId={offer.id}
              rules={rules}
              links={links}
              pages={pages}
              missingRecommended={data.missingRecommended}
            />
            <ValueForm key={JSON.stringify(settings.value)} offerId={offer.id} value={settings.value} />
            <EventNamesForm
              key={JSON.stringify(settings.eventNames)}
              offerId={offer.id}
              eventNames={settings.eventNames}
            />
          </TabsContent>
          <TabsContent value="privacidade" {...KEEP}>
            <ConsentSection
              key={JSON.stringify(settings.consent)}
              offerId={offer.id}
              consent={settings.consent}
              pages={pages}
              pixelCount={activePixels.length}
              forwarding={settings.forwarding}
            />
          </TabsContent>
          <TabsContent value="utms" {...KEEP}>
            <ForwardingSection
              key={JSON.stringify(settings.forwarding)}
              offerId={offer.id}
              forwarding={settings.forwarding}
              consentMode={settings.consent.mode}
              acceptLabel={settings.consent.acceptLabel}
              adsOnly={asksEveryone ? null : { hasPixels: pixels.length > 0 }}
            />
          </TabsContent>
          <TabsContent value="codigo" {...KEEP}>
            <CodeSection
              key={JSON.stringify(settings.customCode)}
              offerId={offer.id}
              code={settings.customCode}
              pages={pages}
              consentMode={settings.consent.mode}
              acceptLabel={settings.consent.acceptLabel}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
