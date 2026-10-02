"use client";

import { KeyRoundIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { ConfirmDialog } from "@/components/app/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useAction } from "@/hooks/use-action";
import { plural } from "@/lib/format";
import { PIXEL_VENDOR_LABEL, PIXEL_VENDORS, type PixelVendorId, SERVER_API_VENDORS } from "@/lib/tracking/schema";
import { cn } from "@/lib/utils";
import { deletePixelAction, setPixelEnabledAction } from "@/server/actions/tracking";
import type { PixelView } from "@/server/services/tracking";
import { Callout } from "./callout";
import { SectionHeading } from "./form-kit";
import { PixelDialog, type PixelDialogMode, PlatformGrid } from "./pixel-dialog";
import { VENDOR_VISUAL, VendorIcon } from "./vendor-icon";

/** Nome do pixel na tela: apelido, ou a plataforma. */
export function pixelName(pixel: Pick<PixelView, "vendor" | "label">) {
  return pixel.label || `Pixel ${VENDOR_VISUAL[pixel.vendor].short}`;
}

/** Selos de cada pixel: desativado, envio pelo servidor, conversões, código de teste… */
export function pixelBadges(pixel: PixelView): { text: string; variant: "success" | "warning" | "outline" }[] {
  const out: { text: string; variant: "success" | "warning" | "outline" }[] = [];
  if (!pixel.enabled) out.push({ text: "Desativado", variant: "outline" });
  if (pixel.vendor === "META" || pixel.vendor === "TIKTOK") {
    const api = SERVER_API_VENDORS[pixel.vendor].label;
    const on = pixel.vendor === "META" ? pixel.options.capi : pixel.options.eventsApi;
    if (on) {
      if (pixel.tokenUnreadable) out.push({ text: `${api}: cole o token de novo`, variant: "warning" });
      else if (pixel.needsToken) out.push({ text: `${api} sem token`, variant: "warning" });
      else out.push({ text: `${api} ligada`, variant: "success" });
      if (pixel.testEventCode) out.push({ text: `Código de teste: ${pixel.testEventCode}`, variant: "outline" });
    }
  }
  if (pixel.vendor === "GOOGLE_ADS") {
    const count = Object.values(pixel.options.conversionLabels ?? {}).filter(Boolean).length;
    out.push(
      count
        ? { text: plural(count, "conversão", "conversões"), variant: "success" }
        : { text: "Sem rótulos de conversão", variant: "warning" },
    );
  }
  if (pixel.vendor === "UTMIFY" && pixel.options.utmsScript) out.push({ text: "Script de UTMs", variant: "outline" });
  return out;
}

function PixelRow({
  pixel,
  ignored = false,
  onEdit,
  onDelete,
}: {
  pixel: PixelView;
  /** Segundo pixel ativo da UTMify: não carrega (a UTMify lê um pixel por página). */
  ignored?: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const toggle = useAction(setPixelEnabledAction);
  const [enabled, setEnabled] = useState(pixel.enabled);
  const [synced, setSynced] = useState(pixel.enabled);
  // A lista atualiza depois de salvar: acompanha o valor novo.
  if (synced !== pixel.enabled) {
    setSynced(pixel.enabled);
    setEnabled(pixel.enabled);
  }
  const name = pixelName(pixel);
  const badges = pixelBadges({ ...pixel, enabled });
  if (ignored && enabled) {
    badges.unshift({ text: "Não carrega: a UTMify aceita um pixel por oferta", variant: "warning" });
  }

  return (
    <li className={cn("flex flex-wrap items-center gap-3 px-4 py-3", !enabled && "bg-muted/30")}>
      <div className="min-w-0 flex-1 basis-60">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("font-medium", !enabled && "text-muted-foreground")}>{name}</span>
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{pixel.pixelId}</code>
        </div>
        {badges.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {badges.map((b) => (
              <Badge key={b.text} variant={b.variant}>
                {b.variant !== "outline" && b.text.includes("token") && <KeyRoundIcon />}
                {b.text}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        <Switch
          checked={enabled}
          disabled={toggle.pending}
          aria-label={`Pixel ${pixel.pixelId} ativo`}
          onCheckedChange={(value) => {
            setEnabled(value);
            void toggle.run(
              { id: pixel.id, enabled: value },
              {
                success: value ? "Pixel ativado." : "Pixel desativado. Ele fica guardado, sem receber eventos.",
                onError: () => setEnabled(!value),
              },
            );
          }}
          className="mr-2"
        />
        <Button variant="ghost" size="icon-sm" aria-label={`Editar pixel ${pixel.pixelId}`} onClick={onEdit}>
          <PencilIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Excluir pixel ${pixel.pixelId}`} onClick={onDelete}>
          <Trash2Icon />
        </Button>
      </div>
    </li>
  );
}

/** Pixels da oferta, em um cartão por plataforma. */
export function PixelsSection({ offerId, pixels }: { offerId: string; pixels: PixelView[] }) {
  const [dialog, setDialog] = useState<{ open: boolean; mode: PixelDialogMode }>({
    open: false,
    mode: { kind: "create" },
  });
  const [deleting, setDeleting] = useState<PixelView | null>(null);
  const remove = useAction(deletePixelAction);
  const byVendor = PIXEL_VENDORS.map((vendor) => ({ vendor, list: pixels.filter((p) => p.vendor === vendor) })).filter(
    (g) => g.list.length > 0,
  );
  const needingToken = pixels.filter((p) => p.needsToken);
  // O pixel da UTMify já manda os eventos para a Meta: com um pixel da Meta aqui também, cuidado com o mesmo pixel duas vezes.
  const utmifyWithMeta =
    pixels.some((p) => p.enabled && p.vendor === "UTMIFY") && pixels.some((p) => p.enabled && p.vendor === "META");

  const openCreate = (vendor?: PixelVendorId) => setDialog({ open: true, mode: { kind: "create", vendor } });

  return (
    <section aria-labelledby="os-pixels-title" className="flex flex-col gap-4">
      <SectionHeading
        title={<span id="os-pixels-title">Pixels</span>}
        description="Cada oferta tem os próprios pixels. O PageView sai sozinho em todas as páginas; os outros eventos vêm das regras da aba Eventos."
        actions={
          pixels.length > 0 && (
            <Button onClick={() => openCreate()}>
              <PlusIcon />
              Adicionar pixel
            </Button>
          )
        }
      />

      {needingToken.length > 0 && (
        <Callout variant="warning" title="Falta o token de acesso">
          {needingToken.length === 1
            ? `O pixel ${needingToken[0].pixelId} está com o envio pelo servidor ligado, mas sem token válido.`
            : `${needingToken.length} pixels estão com o envio pelo servidor ligado, mas sem token válido.`}{" "}
          Edite o pixel e cole o token (ou desligue o envio pelo servidor). O pixel no navegador continua funcionando.
        </Callout>
      )}

      {utmifyWithMeta && (
        <Callout title="UTMify e Meta juntos">
          O pixel da UTMify já envia PageView, ViewContent, InitiateCheckout e Lead para o pixel da Meta cadastrado no
          painel da UTMify. Se esse mesmo pixel da Meta também está aqui, os eventos contam duas vezes: deixe ativo só
          um dos dois.
        </Callout>
      )}

      {pixels.length === 0 ? (
        <div className="flex flex-col gap-4 rounded-xl border border-dashed bg-card p-6">
          <div className="text-center">
            <p className="font-medium">Nenhum pixel nesta oferta ainda</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Escolha a plataforma para adicionar o primeiro. Você pode ter vários pixels, até da mesma plataforma.
            </p>
          </div>
          <PlatformGrid onPick={(v) => openCreate(v)} className="mx-auto w-full max-w-3xl" />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {byVendor.map(({ vendor, list }) => (
            <section
              key={vendor}
              aria-label={PIXEL_VENDOR_LABEL[vendor]}
              className="overflow-hidden rounded-xl border bg-card"
            >
              <header className="flex items-center gap-3 border-b bg-muted/30 px-4 py-3">
                <VendorIcon vendor={vendor} size="sm" />
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium text-sm leading-tight">{PIXEL_VENDOR_LABEL[vendor]}</h3>
                  <p className="text-xs text-muted-foreground">{plural(list.length, "pixel", "pixels")}</p>
                </div>
                {/* A UTMify aceita um pixel por página: sem "Outro pixel". */}
                {vendor !== "UTMIFY" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openCreate(vendor)}
                    aria-label={`Adicionar outro pixel ${VENDOR_VISUAL[vendor].short}`}
                  >
                    <PlusIcon />
                    Outro pixel
                  </Button>
                )}
              </header>
              <ul className="divide-y">
                {list.map((pixel) => (
                  <PixelRow
                    key={pixel.id}
                    pixel={pixel}
                    ignored={vendor === "UTMIFY" && pixel.enabled && list.find((p) => p.enabled) !== pixel}
                    onEdit={() => setDialog({ open: true, mode: { kind: "edit", pixel } })}
                    onDelete={() => setDeleting(pixel)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <PixelDialog
        offerId={offerId}
        open={dialog.open}
        mode={dialog.mode}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
      />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? `Excluir o pixel ${deleting.pixelId}?` : "Excluir pixel?"}
        description="Os eventos desta oferta deixam de ir para esse pixel em todas as páginas. O token salvo, se houver, também é apagado. Para só pausar, use o botão de ativar."
        confirmLabel="Excluir pixel"
        destructive
        pending={remove.pending}
        onConfirm={() => {
          if (!deleting) return;
          void remove.run({ id: deleting.id }, { success: "Pixel excluído.", onSuccess: () => setDeleting(null) });
        }}
      />
    </section>
  );
}
