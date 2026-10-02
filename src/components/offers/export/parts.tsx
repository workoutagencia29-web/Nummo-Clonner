"use client";

/**
 * Peças do diálogo "Baixar ZIP": aviso, árvore "O que vai no ZIP" e as opções
 * com explicação em palavras simples.
 */
import {
  CircleAlertIcon,
  CircleCheckIcon,
  FileCodeIcon,
  FileIcon,
  FileTextIcon,
  FlaskConicalIcon,
  FolderIcon,
  HouseIcon,
  InfoIcon,
  Loader2Icon,
  type LucideIcon,
  ScaleIcon,
  SmartphoneIcon,
  SplitIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { type ReactNode, useId } from "react";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { ExportOptions, ServerEventVendor } from "@/lib/export/options";
import { cn } from "@/lib/utils";
import { EVENTS_CONFIG_FILE, EVENTS_FILE, serverEventsLabel, serverEventsWho, type TreeRow } from "./logic";

const NOTICE = {
  info: { box: "border-primary/25 bg-primary/5", icon: "text-primary", Icon: InfoIcon },
  warning: {
    box: "border-warning/50 bg-warning/10",
    icon: "text-warning-foreground dark:text-warning",
    Icon: TriangleAlertIcon,
  },
  success: { box: "border-success/40 bg-success/10", icon: "text-success", Icon: CircleCheckIcon },
  error: { box: "border-destructive/40 bg-destructive/5", icon: "text-destructive", Icon: CircleAlertIcon },
} as const;

/** Caixa de aviso (informação, atenção, pronto, erro). */
export function Notice({
  variant = "info",
  title,
  children,
  className,
  role,
}: {
  variant?: keyof typeof NOTICE;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  role?: "status" | "alert";
}) {
  const style = NOTICE[variant];
  return (
    <div
      role={role}
      data-slot="export-notice"
      data-variant={variant}
      className={cn("flex gap-3 rounded-lg border p-3 text-sm", style.box, className)}
    >
      <style.Icon className={cn("mt-0.5 size-4 shrink-0", style.icon)} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title && <p className="font-medium leading-snug">{title}</p>}
        {children && <div className="text-muted-foreground leading-relaxed [&_strong]:text-foreground">{children}</div>}
      </div>
    </div>
  );
}

/** Ícone girando (decorativo: o texto ao lado já diz o que está acontecendo). */
export function BusyIcon({ className }: { className?: string }) {
  return <Loader2Icon aria-hidden="true" className={cn("size-4 animate-spin", className)} />;
}

/** Ícone de cada tipo de item do ZIP. */
function iconOf(row: TreeRow): LucideIcon {
  switch (row.kind) {
    case "page":
      return row.depth === 0 && row.path === "index.html" ? HouseIcon : FileTextIcon;
    case "splitter":
      return SplitIcon;
    case "variant":
      return FlaskConicalIcon;
    case "mobile":
      return SmartphoneIcon;
    case "legal":
      return ScaleIcon;
    default:
      if (row.isFolder) return FolderIcon;
      return row.name.endsWith(".php") || row.name.endsWith(".js") ? FileCodeIcon : FileIcon;
  }
}

const ICON_TONE: Partial<Record<TreeRow["kind"], string>> = {
  splitter: "text-primary",
  variant: "text-primary",
  mobile: "text-foreground",
  page: "text-foreground",
  legal: "text-muted-foreground",
};

/** Árvore compacta "O que vai no ZIP" (uma linha por página/pasta/arquivo). */
export function ExportTree({ rows, loading }: { rows: TreeRow[]; loading?: boolean }) {
  if (loading && rows.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border p-3" aria-busy="true">
        <span className="sr-only">Carregando o conteúdo do ZIP…</span>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-2" style={{ paddingLeft: i === 2 ? 20 : 0 }}>
            <Skeleton className="size-4 rounded" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="ml-auto h-4 w-24" />
          </div>
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="rounded-lg border p-3 text-sm text-muted-foreground">Nada para listar ainda.</p>;
  }
  return (
    <ul aria-label="Arquivos e pastas do ZIP" className="flex flex-col rounded-lg border py-1.5 text-sm">
      {rows.map((row) => {
        const Icon = iconOf(row);
        return (
          <li
            key={row.path}
            data-path={row.path}
            data-kind={row.kind}
            className="flex min-w-0 items-center gap-2 px-3 py-1"
            style={{ paddingLeft: 12 + row.depth * 20 }}
          >
            <Icon className={cn("size-4 shrink-0 text-muted-foreground", ICON_TONE[row.kind])} aria-hidden="true" />
            {/* O nome nunca some (é o que a pessoa procura); o rótulo encolhe e mostra o resto ao passar o mouse. */}
            <span className="max-w-[60%] shrink-0 truncate font-mono text-[13px]" title={row.name}>
              {row.name}
            </span>
            {row.label && (
              <span
                className="ml-auto min-w-0 flex-1 truncate pl-3 text-right text-muted-foreground text-xs"
                title={row.label}
              >
                {row.label}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function OptionRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  children,
}: {
  label: string;
  description: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <Field orientation="horizontal" className="items-start" data-disabled={disabled}>
        <FieldContent>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <FieldDescription>{description}</FieldDescription>
        </FieldContent>
        <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="mt-0.5" />
      </Field>
      {children}
    </div>
  );
}

/** Opções do ZIP: só mostra o que se aplica à oferta (divisor com versões A/B; eventos.php com token). */
export function ExportOptionsForm({
  options,
  onChange,
  hasVariants,
  hasServerEventTokens,
  serverEventVendors,
  disabled,
}: {
  options: ExportOptions;
  onChange: (patch: Partial<ExportOptions>) => void;
  hasVariants: boolean;
  hasServerEventTokens: boolean;
  /** Plataformas com token salvo (muda o nome da opção: só Meta, só TikTok ou as duas). */
  serverEventVendors?: ServerEventVendor[];
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col divide-y rounded-lg border">
      {hasVariants && (
        <OptionRow
          label="Divisor A/B"
          checked={options.splitter}
          onCheckedChange={(splitter) => onChange({ splitter })}
          disabled={disabled}
          description={
            <>
              O index.html de cada página com versões sorteia a versão pelo percentual de cada uma, e o visitante
              continua vendo sempre a mesma. Desligado, a pasta de cada página mostra a versão de controle (a da
              bandeira no Teste A/B) e as outras ficam só nas pastas oferta-…/
            </>
          }
        />
      )}
      {hasServerEventTokens && (
        <OptionRow
          label={serverEventsLabel(serverEventVendors)}
          checked={options.serverEvents}
          onCheckedChange={(serverEvents) => onChange({ serverEvents })}
          disabled={disabled}
          description={
            <>
              Inclui o arquivo {EVENTS_FILE}, que também envia as conversões {serverEventsWho(serverEventVendors)} pelo
              servidor da sua hospedagem — mais precisão com bloqueadores de anúncio e no iPhone.
            </>
          }
        >
          {options.serverEvents && (
            <Notice variant="warning" title="Só ligue se a sua hospedagem tiver PHP">
              Hostinger, HostGator e a maioria das hospedagens com cPanel têm PHP. Numa hospedagem sem PHP (Netlify,
              Cloudflare Pages, GitHub Pages…), o {EVENTS_CONFIG_FILE}, que guarda o seu token de acesso, ficaria aberto
              para qualquer pessoa ler.
            </Notice>
          )}
        </OptionRow>
      )}
      <OptionRow
        label="HTML otimizado"
        checked={options.optimizeHtml}
        onCheckedChange={(optimizeHtml) => onChange({ optimizeHtml })}
        disabled={disabled}
        description="Tira comentários e espaços sobrando para a página carregar mais rápido. Scripts e visual não mudam."
      />
    </div>
  );
}
