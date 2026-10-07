/**
 * Textos padrão do bloco "Acesso ao produto" (Español, English, Português):
 * o editor põe no bloco (src/editor/widgets/access-content.ts) e o script da
 * página de obrigado (src/runtime/payments/access.ts) troca os que ainda são
 * os padrão quando o produto pago é de outro idioma que o do bloco. Sem
 * dependências (entra no script das páginas).
 */
import type { PayLocale } from "./contract";

export type AccessTextKey = "wait" | "okTitle" | "okText" | "go" | "noneTitle" | "noneText";

export const ACCESS_TEXTS: Record<PayLocale, Record<AccessTextKey, string>> = {
  es: {
    wait: "Confirmando tu pago…",
    okTitle: "¡Pago confirmado! 🎉",
    okText: "Tu acceso ya está disponible. Haz clic en el botón para entrar.",
    go: "Acceder a mi producto",
    noneTitle: "Aún no encontramos tu pago",
    noneText:
      "Si acabas de pagar, espera unos minutos y recarga esta página. Si necesitas ayuda, contacta a nuestro soporte.",
  },
  en: {
    wait: "Confirming your payment…",
    okTitle: "Payment confirmed! 🎉",
    okText: "Your access is ready. Click the button below to get in.",
    go: "Access my product",
    noneTitle: "We haven't found your payment yet",
    noneText: "If you just paid, wait a few minutes and reload this page. If you need help, contact our support.",
  },
  pt: {
    wait: "Confirmando seu pagamento…",
    okTitle: "Pagamento confirmado! 🎉",
    okText: "Seu acesso está liberado. Clique no botão abaixo para entrar.",
    go: "Acessar meu produto",
    noneTitle: "Ainda não encontramos seu pagamento",
    noneText:
      "Se você acabou de pagar, aguarde alguns minutos e recarregue esta página. Se precisar de ajuda, fale com o nosso suporte.",
  },
};
