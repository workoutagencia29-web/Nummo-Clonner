/**
 * Carregador do SDK de cartão do gateway (Kyvo: KyvoCard), uma vez por
 * página: usado pela janela de pagamento (./window.ts) e pela página de
 * checkout do Offer Studio (src/runtime/checkout). Só carregue endereços que
 * passaram por isAllowedSdkUrl (src/lib/payments/contract.ts).
 */
interface CardSdk {
  mount(opts: Record<string, unknown>): unknown;
}

const sdkLoads: Record<string, Promise<boolean>> = {};

/** Carrega o SDK do gateway uma vez (true = carregou). */
export function loadSdk(url: string): Promise<boolean> {
  if ((window as unknown as { KyvoCard?: CardSdk }).KyvoCard) return Promise.resolve(true);
  if (!sdkLoads[url]) {
    sdkLoads[url] = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = url;
      s.async = true;
      s.onload = () => resolve(true);
      s.onerror = () => {
        delete sdkLoads[url];
        s.remove();
        resolve(false);
      };
      (document.head || document.documentElement).appendChild(s);
    });
  }
  return sdkLoads[url];
}
