/**
 * Biblioteca de blocos do editor. Cada arquivo desta pasta exporta uma lista de
 * blocos; aqui eles são registrados no GrapesJS, agrupados por categoria.
 *
 * Convenção: blocos são definições de componente (não HTML solto) com estilos
 * próprios, para funcionarem numa página em branco e dentro de páginas clonadas.
 * Comportamentos (contador, popup, notificação…) ficam no script da página
 * (src/runtime), ligados por data-os-widget — nada executa dentro do editor.
 * Os tipos de componente desses widgets (com as opções em "Configurações")
 * ficam em src/editor/widgets e são registrados aqui também.
 */
import type { Editor } from "grapesjs";
import { registerWidgetTypes } from "@/editor/widgets";
import { basicBlocks } from "./basic";
import { contentBlocks } from "./content";
import { conversionBlocks } from "./conversion";
import { footerBlocks } from "./footer";
import { formBlocks } from "./forms";
import { proofBlocks } from "./proof";
import { BLOCK_CATEGORIES, type OsBlock } from "./shared";
import { structureBlocks } from "./structure";
import { videoBlocks } from "./video";

export { BLOCK_CATEGORIES, type BlockCategory, icon, type OsBlock } from "./shared";

/** Todas as listas de blocos, na ordem em que aparecem no painel. */
export const ALL_BLOCKS: OsBlock[] = [
  ...basicBlocks.filter((b) => b.category === "basicos"),
  ...contentBlocks,
  ...basicBlocks.filter((b) => b.category !== "basicos"),
  ...structureBlocks,
  ...conversionBlocks,
  ...videoBlocks,
  ...proofBlocks,
  ...formBlocks,
  ...footerBlocks,
];

export function registerBlocks(editor: Editor) {
  registerWidgetTypes(editor);
  for (const block of ALL_BLOCKS) {
    editor.Blocks.add(block.id, {
      label: block.label,
      category: BLOCK_CATEGORIES[block.category],
      media: block.media,
      content: block.content as never,
      ...(block.select && { select: true }),
      ...(block.activate && { activate: true }),
    });
  }
}
