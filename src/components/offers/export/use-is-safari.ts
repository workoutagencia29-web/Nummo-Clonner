"use client";

import { useSyncExternalStore } from "react";
import { isSafariUserAgent } from "./logic";

const subscribe = () => () => {};

/** O painel está aberto no Safari? (No servidor e na hidratação, false: nada pisca.) */
export function useIsSafari(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isSafariUserAgent(navigator.userAgent),
    () => false,
  );
}
