import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sem os argumentos das ações no terminal do "npm run dev": eles podem ter
  // segredos (chave da API de pagamento, tokens dos pixels).
  logging: { serverFunctions: false },
  // O painel não usa next/image: desliga a rota /_next/image (responde 404). Ela
  // fica fora da checagem de endereço do src/proxy.ts e busca imagens de outros
  // endereços no servidor — uma porta a menos aberta no Mac.
  images: { unoptimized: true },
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
