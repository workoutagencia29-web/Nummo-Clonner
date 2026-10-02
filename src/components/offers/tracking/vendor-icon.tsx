import {
  ChartColumnIcon,
  ClapperboardIcon,
  InfinityIcon,
  type LucideIcon,
  MegaphoneIcon,
  Music2Icon,
  RouteIcon,
} from "lucide-react";
import type { PixelVendorId } from "@/lib/tracking/schema";
import { cn } from "@/lib/utils";

/**
 * Ícone neutro de cada plataforma (sem logotipos de marca): um símbolo do
 * lucide num quadrado com a cor de referência da plataforma.
 */
export const VENDOR_VISUAL: Record<PixelVendorId, { icon: LucideIcon; tile: string; short: string; about: string }> = {
  META: {
    icon: InfinityIcon,
    tile: "bg-blue-600 text-white",
    short: "Meta",
    about: "Anúncios no Facebook e no Instagram",
  },
  TIKTOK: {
    icon: Music2Icon,
    tile: "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900",
    short: "TikTok",
    about: "Anúncios no TikTok",
  },
  KWAI: {
    icon: ClapperboardIcon,
    tile: "bg-orange-500 text-white",
    short: "Kwai",
    about: "Anúncios no Kwai",
  },
  GA4: {
    icon: ChartColumnIcon,
    tile: "bg-amber-500 text-white",
    short: "GA4",
    about: "Visitas e comportamento no site",
  },
  GOOGLE_ADS: {
    icon: MegaphoneIcon,
    tile: "bg-emerald-600 text-white",
    short: "Google Ads",
    about: "Conversões das campanhas do Google",
  },
  UTMIFY: {
    icon: RouteIcon,
    tile: "bg-violet-600 text-white",
    short: "UTMify",
    about: "Vendas por anúncio e repasse de UTMs",
  },
};

export function VendorIcon({
  vendor,
  size = "md",
  className,
}: {
  vendor: PixelVendorId;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { icon: Icon, tile } = VENDOR_VISUAL[vendor];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-lg shadow-xs",
        size === "sm" && "size-7 [&_svg]:size-3.5",
        size === "md" && "size-9 [&_svg]:size-4.5",
        size === "lg" && "size-11 [&_svg]:size-5",
        tile,
        className,
      )}
    >
      <Icon />
    </span>
  );
}
