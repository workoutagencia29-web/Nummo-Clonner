/**
 * Peças puras da exportação para hospedagem SEM PHP (Vercel/Netlify): o
 * endereço do endpoint por plataforma, os caminhos dos arquivos no ZIP, os
 * manifestos (vercel.json / netlify.toml), o modelo .env.example (só os NOMES
 * das variáveis, nunca valores) e os caminhos reservados (para o "Com scripts"
 * e os redirecionamentos não baterem na função).
 *
 * O JavaScript da função é empacotado à parte (serverlessFunctionJs em
 * runtime-bundle.ts, no worker); aqui não há esbuild nem segredo.
 */
import { ZIP_PAYMENT_ENDPOINT } from "@/lib/payments/contract";
import type { ServerlessProvider } from "@/server/services/payments/serverless/config";

/** Destino da exportação: PHP (padrão) ou uma hospedagem sem PHP. */
export type ExportTarget = "php" | "vercel" | "netlify";
export type ServerlessTarget = "vercel" | "netlify";

export function isServerlessTarget(t: ExportTarget): t is ServerlessTarget {
  return t === "vercel" || t === "netlify";
}

/** Caminho da função no ZIP, por plataforma. */
export const SERVERLESS_FUNCTION_PATH: Record<ServerlessTarget, string> = {
  vercel: "api/pagamento.mjs",
  netlify: "netlify/functions/pagamento.mjs",
};

/** Endereço (mesma origem, raiz absoluta) que a página chama, por plataforma. */
export const SERVERLESS_ENDPOINT: Record<ServerlessTarget, string> = {
  vercel: "/api/pagamento",
  netlify: "/.netlify/functions/pagamento",
};

/** Arquivo do manifesto por plataforma. */
export const SERVERLESS_MANIFEST_PATH: Record<ServerlessTarget, string> = {
  vercel: "vercel.json",
  netlify: "netlify.toml",
};

/** Modelo das variáveis de ambiente (vazio, só para você saber os nomes). */
export const ENV_EXAMPLE_PATH = ".env.example";

/**
 * Endereço do endpoint de pagamento para o render: raiz absoluta nas
 * hospedagens sem PHP; no PHP, relativo (a página sobe até a raiz com `rel`).
 */
export function paymentEndpoint(target: ExportTarget, rel: string): string {
  if (target === "vercel") return SERVERLESS_ENDPOINT.vercel;
  if (target === "netlify") return SERVERLESS_ENDPOINT.netlify;
  return `${rel}${ZIP_PAYMENT_ENDPOINT}`;
}

/** Variável de ambiente da chave de cada gateway (para o .env.example e o guia). */
export const GATEWAY_ENV_NAME: Record<ServerlessProvider, string> = {
  FLEVOPAY: "OS_FLEVOPAY_KEY",
  BLACKCAT: "OS_BLACKCAT_KEY",
  CLOWNPAY: "OS_CLOWNPAY_KEY",
  KYVO: "OS_KYVO_KEY",
};

/** Nome do segredo que lacra os pedidos (gerado pelo Offer Studio, vai no ambiente). */
export const PAY_SECRET_ENV_NAME = "OS_PAY_SECRET";

/** Conteúdo do vercel.json / netlify.toml. */
export function serverlessManifest(target: ServerlessTarget): string {
  if (target === "vercel") {
    return `${JSON.stringify(
      {
        $schema: "https://openapi.vercel.sh/vercel.json",
        functions: { "api/pagamento.mjs": { maxDuration: 10 } },
      },
      null,
      2,
    )}\n`;
  }
  return `# Gerado pelo Offer Studio — pagamento sem PHP na Netlify.
[build]
  publish = "."

[build.environment]
  NODE_VERSION = "20"

[functions]
  directory = "netlify/functions"
`;
}

/**
 * .env.example: só os NOMES das variáveis (valores em branco). O valor do
 * segredo e das chaves você cola no painel da hospedagem, nunca num arquivo.
 */
export function serverlessEnvExample(gateways: readonly ServerlessProvider[]): string {
  const lines = [
    "# Variaveis de ambiente do pagamento.",
    "# Cole os VALORES no painel da sua hospedagem (Vercel/Netlify), nunca aqui nem em arquivo do site.",
    "",
    "# Segredo que protege os pedidos (o Offer Studio mostrou o valor ao exportar).",
    `${PAY_SECRET_ENV_NAME}=`,
    "",
    "# Chave de API de cada gateway usado nesta oferta.",
  ];
  for (const g of gateways) lines.push(`${GATEWAY_ENV_NAME[g]}=`);
  return `${lines.join("\n")}\n`;
}

/** Caminhos que a exportação serverless ocupa no ZIP (função + manifesto + .env.example). */
export function serverlessReservedPaths(target: ServerlessTarget): string[] {
  return [SERVERLESS_FUNCTION_PATH[target], SERVERLESS_MANIFEST_PATH[target], ENV_EXAMPLE_PATH];
}
