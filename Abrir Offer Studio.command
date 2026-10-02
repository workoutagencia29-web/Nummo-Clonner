#!/bin/zsh
# Atalho do Offer Studio: dê dois cliques neste arquivo para abrir o app.
# Ele liga o banco de dados, o painel e o robô de tarefas e abre o navegador.
# Para desligar, feche esta janela (ou aperte Ctrl+C).

cd "$(dirname "$0")" || exit 1

# Garante que o Node instalado pelo site oficial ou pelo Homebrew seja encontrado.
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js não encontrado. Instale a versão 24 em https://nodejs.org e tente de novo."
  read -r "?Aperte Enter para fechar."
  exit 1
fi

# Instala as dependências na primeira vez e depois de atualizações do projeto.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Instalando as dependências (pode levar alguns minutos)…"
  npm install || { read -r "?Falhou. Aperte Enter para fechar."; exit 1; }
fi

if [ ! -f .env ]; then
  npm run setup || { read -r "?Falhou. Aperte Enter para fechar."; exit 1; }
fi

echo ""
echo "Abrindo o Offer Studio… (deixe esta janela aberta enquanto usa)"
echo ""
npm start
