import { cookies } from "next/headers";
import { AppShell } from "@/components/app/app-shell";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import { getSidebarData, getWorkerStatus } from "@/server/queries";
import { requireSession } from "@/server/session";

export default async function PainelLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const [sidebar, worker, cookieStore] = await Promise.all([getSidebarData(), getWorkerStatus(), cookies()]);
  return (
    <AppShell
      user={{ name: session.user.name, email: session.user.email }}
      sidebar={sidebar}
      workerOnline={worker.online}
      theme={parseTheme(cookieStore.get(THEME_COOKIE)?.value)}
    >
      {children}
    </AppShell>
  );
}
