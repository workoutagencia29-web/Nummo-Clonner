/**
 * Mensagens de erro do login/conta em português (usado nas telas, no navegador).
 */

/** Códigos de erro do Better Auth → português. */
const AUTH_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha incorretos.",
  INVALID_EMAIL: "Digite um e-mail válido.",
  INVALID_PASSWORD: "Senha atual incorreta.",
  PASSWORD_TOO_SHORT: "A senha precisa ter pelo menos 8 caracteres.",
  PASSWORD_TOO_LONG: "A senha pode ter no máximo 128 caracteres.",
  USER_ALREADY_EXISTS: "Já existe uma conta com esse e-mail.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Já existe uma conta com esse e-mail.",
  SINGLE_USER_ONLY: "Já existe uma conta neste Offer Studio. Entre com ela.",
  SESSION_EXPIRED: "Sua sessão expirou. Entre de novo.",
  FAILED_TO_CREATE_USER: "Não foi possível criar a conta.",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "Conta não encontrada.",
};

export function authErrorMessage(
  error: { code?: string; status?: number; statusText?: string; message?: string } | null | undefined,
) {
  if (!error) return "Algo deu errado. Tente de novo.";
  if (error.statusText === "Fetch Error") {
    return "Não foi possível falar com o Offer Studio. Ele ainda está aberto?";
  }
  if (error.status === 429) return "Muitas tentativas. Aguarde um minuto e tente de novo.";
  if (error.code && AUTH_MESSAGES[error.code]) return AUTH_MESSAGES[error.code];
  return "Não foi possível concluir. Confira os dados e tente de novo.";
}
