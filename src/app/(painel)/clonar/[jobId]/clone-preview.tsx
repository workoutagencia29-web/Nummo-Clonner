"use client";

import { ExternalLinkIcon, MonitorIcon, SmartphoneIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { CloneModeValue, Device } from "@/worker/clone/types";

export type ReviewPreviews = Partial<Record<Device, Record<CloneModeValue, string>>>;

const DESKTOP_WIDTH = 1280;

/**
 * Prévia da cópia num iframe isolado (origem própria), com troca de dispositivo,
 * modo e comparação com o print do original.
 */
export function ClonePreview({
  previews,
  screenshots,
  mode,
  onModeChange,
  suggestedMode,
  hasDelay,
}: {
  previews: ReviewPreviews;
  screenshots: Partial<Record<Device, string>>;
  mode: CloneModeValue;
  onModeChange: (mode: CloneModeValue) => void;
  suggestedMode: CloneModeValue;
  hasDelay: boolean;
}) {
  const [device, setDevice] = useState<Device>(previews.desktop ? "desktop" : "mobile");
  const [view, setView] = useState<"copia" | "original">("copia");
  const [showDelay, setShowDelay] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const base = previews[device]?.[mode];
  const src = base ? `${base}${showDelay ? "?os_mostrar_delay=1" : ""}` : null;
  const shot = screenshots[device] ?? screenshots.desktop;
  const scale = device === "desktop" && boxWidth ? Math.min(1, boxWidth / DESKTOP_WIDTH) : 1;
  const frameHeight = 640;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          value={device}
          onValueChange={(v) => v && setDevice(v as Device)}
          aria-label="Aparelho"
        >
          <ToggleGroupItem value="desktop" disabled={!previews.desktop} aria-label="Computador">
            <MonitorIcon />
            Computador
          </ToggleGroupItem>
          <ToggleGroupItem value="mobile" disabled={!previews.mobile} aria-label="Celular">
            <SmartphoneIcon />
            Celular
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          value={view}
          onValueChange={(v) => v && setView(v as typeof view)}
          aria-label="Visualização"
        >
          <ToggleGroupItem value="copia">Cópia</ToggleGroupItem>
          <ToggleGroupItem value="original" disabled={!shot}>
            Original
          </ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          type="single"
          variant="outline"
          value={mode}
          onValueChange={(v) => v && onModeChange(v as CloneModeValue)}
          aria-label="Modo da cópia"
        >
          <ToggleGroupItem value="EDITABLE">
            Editável{suggestedMode === "EDITABLE" && <span className="size-1.5 rounded-full bg-primary" aria-hidden />}
          </ToggleGroupItem>
          <ToggleGroupItem value="PRESERVE_JS" title="Mantém os scripts do site original (modo “Preservar JS”)">
            Com scripts
            {suggestedMode === "PRESERVE_JS" && <span className="size-1.5 rounded-full bg-primary" aria-hidden />}
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="ml-auto flex items-center gap-3">
          {hasDelay && view === "copia" && (
            <div className="flex items-center gap-2">
              <Switch id="show-delay" checked={showDelay} onCheckedChange={setShowDelay} />
              <Label htmlFor="show-delay" className="text-sm font-normal">
                Mostrar itens com delay
              </Label>
            </div>
          )}
          {src && (
            <Button variant="ghost" size="sm" asChild>
              <a href={src} target="_blank" rel="noopener noreferrer">
                <ExternalLinkIcon />
                Nova aba
              </a>
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {mode === "EDITABLE"
          ? "Editável: página estática, 100% editável. Scripts do site original foram removidos (os players de vídeo continuam)."
          : "Com scripts (“Preservar JS”): mantém o funcionamento do site original, como quiz e calculadora (menos os rastreadores); a edição visual fica limitada."}{" "}
        O ponto azul indica o modo recomendado.
      </p>

      <div ref={box} className="overflow-hidden rounded-xl border bg-muted/40">
        {view === "original" && shot ? (
          <div className="max-h-[640px] overflow-y-auto">
            {/* biome-ignore lint/performance/noImgElement: print servido pela API local */}
            <img
              src={`/api/files/${shot}`}
              alt="Print da página original"
              className={cn("mx-auto block", device === "mobile" ? "w-[390px]" : "w-full")}
            />
          </div>
        ) : src ? (
          device === "desktop" ? (
            <div style={{ height: frameHeight }} className="relative">
              <iframe
                key={src}
                title="Prévia da cópia (computador)"
                src={src}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                className="absolute top-0 left-0 origin-top-left border-0 bg-white"
                style={{ width: DESKTOP_WIDTH, height: frameHeight / scale, transform: `scale(${scale})` }}
              />
            </div>
          ) : (
            <div className="flex justify-center py-4" style={{ height: frameHeight + 32 }}>
              <iframe
                key={src}
                title="Prévia da cópia (celular)"
                src={src}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                className="h-full w-[390px] rounded-2xl border-4 border-foreground/80 bg-white shadow-lg"
              />
            </div>
          )
        ) : (
          <p className="p-6 text-sm text-muted-foreground">Prévia indisponível neste aparelho.</p>
        )}
      </div>
    </div>
  );
}
