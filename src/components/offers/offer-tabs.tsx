"use client";

import { useSearchParams } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { replaceQuery } from "@/hooks/replace-query";

export const OFFER_TABS = [
  { value: "paginas", label: "Páginas do funil" },
  { value: "links", label: "Links e checkouts" },
  { value: "upsell", label: "Upsell" },
  { value: "rastreamento", label: "Pixels e rastreamento" },
  { value: "configuracoes", label: "Moeda, empresa e SEO" },
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
 * celular e em janelas até o lg (de 768 px a ~1000 px o menu lateral ocupa 256
 * px), as abas viram uma grade de duas colunas (todas visíveis, sem rolagem
 * escondida); o nome que não cabe na coluna (telas estreitas, ou com o ponto de
 * "não salvo" ao lado) quebra em duas linhas, e as duas abas da linha ficam da
 * mesma altura. Do lg em diante ficam numa linha; se ainda assim faltar espaço
 * (ponto de "não salvo" em várias), a última desce para a linha de baixo em vez
 * de sumir numa rolagem para o lado.
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
        // Grade de 2 colunas abaixo do lg; a última aba ocupa as 2 colunas SÓ quando
        // o total é ímpar (com número par, todas as linhas ficam cheias — nada de célula vazia).
        className="grid h-auto w-full grid-cols-2 items-stretch gap-1 lg:flex lg:min-h-9 lg:w-fit lg:max-w-full lg:flex-wrap lg:items-center lg:justify-start lg:gap-0 [&>*:last-child:nth-child(odd)]:col-span-2"
      >
        {OFFER_TABS.map((t) => (
          <TabsTrigger
            key={t.value}
            value={t.value}
            className="h-auto min-h-8 whitespace-normal text-center max-lg:leading-tight lg:h-[calc(2.25rem-7px)] lg:min-h-0 lg:flex-auto lg:whitespace-nowrap"
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  );
}
