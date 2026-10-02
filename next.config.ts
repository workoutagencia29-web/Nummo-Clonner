import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // HTML colado na clonagem pode ter até 10 MB (o ZIP usa uma rota própria).
    // A ação recebe o HTML dentro de um JSON: aspas, quebras de linha e acentos
    // escapados podem quase dobrar o tamanho. Os dois limites abaixo ficam bem
    // acima disso, para que o limite de 10 MB (com a mensagem em português) seja
    // sempre o primeiro a ser atingido — e não um corte silencioso do corpo.
    serverActions: { bodySizeLimit: "32mb" },
    // src/proxy.ts roda antes das ações e guarda o corpo na memória; acima deste
    // limite o Next corta o corpo (padrão: 10 MB) e a ação falha sem explicação.
    proxyClientMaxBodySize: "32mb",
  },
};

export default nextConfig;
