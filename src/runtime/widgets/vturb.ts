/**
 * Player VTurb (data-os-widget="vturb"): monta o player com a conta e o ID
 * guardados (data-os-account, data-os-player, data-os-version "v4" | "v3") e
 * carrega o script oficial. No editor aparece só um marcador.
 */
import { opt, widgets } from "./util";

const SAFE = /^[\w-]{3,80}$/;

export function initVturb(root?: ParentNode) {
  for (const el of widgets("vturb", root)) {
    const account = opt(el, "account");
    const id = opt(el, "player");
    if (!SAFE.test(account) || !SAFE.test(id) || el.querySelector("vturb-smartplayer,[id^=vid_]")) continue;
    const v4 = opt(el, "version", "v4") !== "v3";
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://scripts.converteai.net/${account}/players/${id}/${v4 ? "v4/" : ""}player.js`;
    if (v4) {
      const player = document.createElement("vturb-smartplayer");
      player.id = `vid-${id}`;
      player.style.cssText = "display:block;margin:0 auto;width:100%";
      el.appendChild(player);
    } else {
      script.id = `scr_${id}`;
      // Player antigo: o script procura o contêiner #vid_<id> e desenha o vídeo nele.
      el.innerHTML = `<div id="vid_${id}" style="position:relative;width:100%;padding:56.25% 0 0"></div>`;
    }
    document.head.appendChild(script);
  }
}
