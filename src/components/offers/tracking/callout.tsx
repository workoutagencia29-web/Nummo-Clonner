import { CircleCheckIcon, InfoIcon, type LucideIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const STYLES = {
  info: { box: "border-primary/25 bg-primary/5", icon: "text-primary", Icon: InfoIcon },
  warning: {
    box: "border-warning/50 bg-warning/10",
    icon: "text-warning-foreground dark:text-warning",
    Icon: TriangleAlertIcon,
  },
  success: { box: "border-success/40 bg-success/10", icon: "text-success", Icon: CircleCheckIcon },
} as const;

/**
 * Caixa de aviso/explicação dentro dos formulários (informação, atenção, tudo
 * certo). A ação fica ao lado do texto só quando a própria caixa é larga
 * (container query): na coluna estreita do painel e no celular, ela vai para
 * baixo do texto, que fica com a largura toda.
 */
export function Callout({
  variant = "info",
  title,
  icon,
  action,
  className,
  children,
}: {
  variant?: keyof typeof STYLES;
  title?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const style = STYLES[variant];
  const Icon = icon ?? style.Icon;
  return (
    <div
      data-slot="callout"
      data-variant={variant}
      className={cn("@container flex gap-3 rounded-lg border p-3 text-sm", style.box, className)}
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", style.icon)} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-3 @lg:flex-row @lg:items-center">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {title && <p className="font-medium leading-snug">{title}</p>}
          {children && (
            <div className="text-muted-foreground leading-relaxed [&_strong]:text-foreground">{children}</div>
          )}
        </div>
        {action && <div className="shrink-0 self-start @lg:self-center">{action}</div>}
      </div>
    </div>
  );
}
