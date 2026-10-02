import { requireSession } from "@/server/session";

/** Editor em tela cheia (sem o menu lateral do painel). */
export default async function EditorLayout({ children }: LayoutProps<"/">) {
  await requireSession();
  return <div className="h-svh overflow-hidden">{children}</div>;
}
