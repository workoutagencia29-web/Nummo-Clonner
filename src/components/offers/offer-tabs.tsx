"use client";

import { useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { replaceQuery } from "@/hooks/replace-query";

export const OFFER_TABS = [
  { value: "paginas", label: "Páginas do funil" },
  { value: "links", label: "Links e checkouts" },
  { value: "rastreamento", label: "Pixels e rastreamento" },
  { value: "configuracoes", label: "Empresa e SEO" },
  { value: "detalhes", label: "Detalhes" },
] as const;

export type OfferTab = (typeof OFFER_TABS)[number]["value"];
const DEFAULT_TAB: OfferTab = "paginas";

/** Aba pedida no endereço (?aba=links); qualquer outro valor abre "Páginas do funil". */
export function offerTabOf(value: string | string[] | null | undefined): OfferTab {
  const v = Array.isArray(value) ? value[0] : value;
  return OFFER_TABS.find((t) => t.value === v)?.value ?? DEFAULT_TAB;
}

/**
 * Abas da tela da oferta. A aba escolhida vai para o endereço (?aba=…), então
 * recarregar, voltar do "Testar pixels" ou mandar o link abre na mesma aba. No
 * celular, as abas viram uma grade de duas colunas (todas visíveis, sem rolagem
 * escondida).
 */
export function OfferTabs({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const fromUrl = offerTabOf(params.get("aba"));
  const [tab, setTab] = useState<OfferTab>(fromUrl);
  // Um link para outra aba (?aba=detalhes, vindo de um aviso) também troca a aba.
  const [lastUrlTab, setLastUrlTab] = useState(fromUrl);
  if (fromUrl !== lastUrlTab) {
    setLastUrlTab(fromUrl);
    setTab(fromUrl);
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const next = offerTabOf(value);
        // O endereço muda logo depois (o roteador acompanha o replaceState); até lá,
        // fica a aba escolhida.
        setTab(next);
        replaceQuery({
          aba: next === DEFAULT_TAB ? null : next,
          // A parte dos pixels (?secao=) só vale na aba deles.
          ...(next === "rastreamento" ? {} : { secao: null }),
        });
      }}
    >
      <TabsList
        aria-label="Partes da oferta"
        className="grid h-auto w-full grid-cols-2 gap-1 sm:inline-flex sm:h-9 sm:w-fit sm:max-w-full sm:justify-start sm:gap-0 sm:overflow-x-auto [&>*:last-child]:col-span-2"
      >
        {OFFER_TABS.map((t) => (
          <TabsTrigger key={t.value} value={t.value} className="h-8 sm:h-[calc(100%-1px)]">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}
