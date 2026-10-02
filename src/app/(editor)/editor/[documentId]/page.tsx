import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EditorLoader } from "@/editor/editor-loader";
import { editorTabTitle } from "@/editor/title";
import { getEditorDocumentInfo } from "@/server/queries";
import { requireSession } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/editor/[documentId]">): Promise<Metadata> {
  const { documentId } = await params;
  const info = await getEditorDocumentInfo(documentId);
  return { title: info ? editorTabTitle(info) : "Página não encontrada" };
}

export default async function EditorPage({ params }: PageProps<"/editor/[documentId]">) {
  await requireSession();
  const { documentId } = await params;
  // Antes de mandar qualquer coisa: página excluída responde 404 (com a tela de "não encontrada").
  if (!(await getEditorDocumentInfo(documentId))) notFound();
  return <EditorLoader documentId={documentId} />;
}
