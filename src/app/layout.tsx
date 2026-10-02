import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Offer Studio", template: "%s · Offer Studio" },
  description: "Clone, edite e baixe páginas de oferta.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="pt-BR" className={`${theme} h-full`} suppressHydrationWarning>
      <body className="min-h-full">
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster theme={theme} />
      </body>
    </html>
  );
}
