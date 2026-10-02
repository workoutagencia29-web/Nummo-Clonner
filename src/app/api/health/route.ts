import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Usado pelo script de inicialização para saber quando o painel está pronto. */
export async function GET() {
  try {
    await prisma.$queryRaw`select 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false, error: "Banco de dados indisponível." }, { status: 503 });
  }
}
