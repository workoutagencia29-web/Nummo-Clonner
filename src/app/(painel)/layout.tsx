import { cookies } from "next/headers";
import { AppShell } from "@/components/app/app-shell";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { getSidebarData, getWorkerStatus } from "@/server/queries";
import { lastOfferCurrency } from "@/server/services/preferences";
import { requireSession } from "@/server/session";

export default async function PainelLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const [sidebar, worker, cookieStore, offerCurrency] = await Promise.all([
    getSidebarData(),
    getWorkerStatus(),
    cookies(),
    lastOfferCurrency(),
  ]);
  return (
    <AppShell
      user={{ name: session.user.name, email: session.user.email }}
      sidebar={sidebar}
      workerOnline={worker.online}
      theme={parseTheme(cookieStore.get(THEME_COOKIE)?.value)}
      offerCurrency={offerCurrency}
    >
      {children}
    </AppShell>
  );
}
