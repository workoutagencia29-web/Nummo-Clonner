#!/bin/zsh
# Esqueceu a senha do Offer Studio? Dê dois cliques neste arquivo para criar
# uma senha nova. Suas ofertas não mudam. Funciona com o app aberto ou fechado.

cd "$(dirname "$0")" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js não encontrado. Instale a versão 24 em https://nodejs.org e tente de novo."
  read -r "?Aperte Enter para fechar."
  exit 1
fi

npm run --silent redefinir-senha
echo ""
read -r "?Aperte Enter para fechar esta janela."
