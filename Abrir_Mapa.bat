@echo off
REM Abre o Mapa de Lojas LOCALMENTE (para testar). A versao para todos fica na Vercel.
cd /d "%~dp0"
if not exist .env (
  echo Falta o ficheiro .env  - copie .env.example para .env e preencha DATABASE_URL ^(ou PGLITE_DIR^).
  pause
  exit /b 1
)
if not exist node_modules (
  echo A instalar as dependencias pela primeira vez...
  call npm install
)
start "" http://127.0.0.1:5173
echo Mapa de Lojas em http://127.0.0.1:5173  - para fechar, feche esta janela.
call npm run dev
