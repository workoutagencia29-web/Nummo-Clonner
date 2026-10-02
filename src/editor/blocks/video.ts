/**
 * Blocos de vídeo: YouTube, Vimeo, Panda (iframe), VTurb (player montado na
 * página) e arquivo de vídeo. Ao soltar, o bloco fica selecionado: é só colar o
 * link em "Configurações".
 */
import { videoEmbedDef, videoFileDef, vturbDef } from "@/editor/widgets/video";
import { icon, type OsBlock } from "./shared";

const WIDTH = { "max-width": "860px" };

export const videoBlocks: OsBlock[] = [
  {
    id: "video-youtube",
    label: "YouTube",
    category: "video",
    media: icon('<rect x="2.5" y="5" width="19" height="14" rx="4"/><path d="m10 9 5 3-5 3z"/>'),
    content: videoEmbedDef("youtube", "", WIDTH),
    select: true,
  },
  {
    id: "video-vimeo",
    label: "Vimeo",
    category: "video",
    media: icon(
      '<path d="M3 8.5c1.5-1 2.4-1.5 3-1.2.9.4 1.3 5.5 2.3 7.5.6 1.3 1.4.4 2.8-1.6 1.6-2.4 1.1-4-.5-3.1C11.5 5.3 15 4.3 16.4 6c1.4 1.8-.2 5.6-3.4 9.3-3 3.4-4.5 3.4-5.6 1.2"/><path d="M16 7c2-.3 3.6.1 4.5 1"/>',
    ),
    content: videoEmbedDef("vimeo", "", WIDTH),
    select: true,
  },
  {
    id: "video-vturb",
    label: "VTurb",
    category: "video",
    media: icon(
      '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m10 8.5 5 3.5-5 3.5z"/><path d="M6 21v-2M18 21v-2"/>',
    ),
    content: vturbDef(WIDTH),
    select: true,
  },
  {
    id: "video-panda",
    label: "Panda Video",
    category: "video",
    media: icon(
      '<circle cx="12" cy="13" r="7"/><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="m10.5 11 3.5 2-3.5 2z"/>',
    ),
    content: videoEmbedDef("panda", "", WIDTH),
    select: true,
  },
  {
    id: "video-arquivo",
    label: "Vídeo do arquivo",
    category: "video",
    media: icon(
      '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="m10 12 4 2.5-4 2.5z"/>',
    ),
    content: videoFileDef(WIDTH),
    select: true,
  },
];
