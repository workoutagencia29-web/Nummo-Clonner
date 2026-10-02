"use client";

import { DownloadIcon } from "lucide-react";
import { type ComponentProps, useEffect, useRef } from "react";
import { OfferMenu } from "@/components/offers/offer-menu";
import { Button } from "@/components/ui/button";
import { ExportDialog } from "./export-dialog";
import { EXPORT_QUERY_PARAM, OPEN_EXPORT_EVENT, withoutParam } from "./logic";
import { BusyIcon } from "./parts";
import { useExportController } from "./use-export-controller";

type MenuProps = ComponentProps<typeof OfferMenu>;

/**
 * Ações do cabeçalho da oferta: menu "Ações" + "Baixar ZIP" (principal; o menu
 * não repete o ZIP). Com `autoOpen` (?baixar=1, vindo do menu do card),
 * o diálogo já abre e o parâmetro sai do endereço.
 */
export function OfferExportActions({
  offerId,
  menu,
  autoOpen = false,
}: {
  offerId: string;
  menu: MenuProps;
  autoOpen?: boolean;
}) {
  const c = useExportController(offerId);
  const { setOpen } = c;

  const autoOpened = useRef(false);
  useEffect(() => {
    if (!autoOpen || autoOpened.current) return;
    autoOpened.current = true;
    setOpen(true);
    const clean = withoutParam(window.location.href, EXPORT_QUERY_PARAM);
    if (clean !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, "", clean);
    }
  }, [autoOpen, setOpen]);

  // Outros pontos da tela (cartão "Próximos passos") abrem o mesmo diálogo.
  useEffect(() => {
    const open = () => setOpen(true);
    window.addEventListener(OPEN_EXPORT_EVENT, open);
    return () => window.removeEventListener(OPEN_EXPORT_EVENT, open);
  }, [setOpen]);

  // Gerando um ZIP (o acompanhado ou um deixado gerando ao voltar às opções), com o diálogo fechado.
  const busy = (c.stage === "progress" || c.background) && !c.open;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <OfferMenu {...menu} />
      <Button size="sm" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {busy ? <BusyIcon /> : <DownloadIcon />}
        Baixar ZIP
      </Button>
      <ExportDialog c={c} />
    </div>
  );
}
