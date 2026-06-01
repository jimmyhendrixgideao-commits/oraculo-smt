@echo off
title ORACULO SMT
cls

echo.
echo  ==========================================
echo   ORACULO SMT - Sistema Inteligente SMT
echo   Suporte Tecnico para Industria SMT
echo  ==========================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERRO] Node.js nao encontrado!
    echo  Baixe em: https://nodejs.org
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo  [OK] Node.js: %NODE_VER%

echo  Verificando porta 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000 "') do (
    taskkill /f /pid %%a >nul 2>&1
)
echo  [OK] Porta 3000 liberada.

if not exist "node_modules" (
    echo.
    echo  Instalando dependencias...
    call npm install
    if %errorlevel% neq 0 (
        echo  [ERRO] Falha ao instalar dependencias.
        pause
        exit /b 1
    )
    echo  [OK] Dependencias instaladas!
)

echo.
echo  ==========================================
echo  Iniciando ORACULO SMT...
echo  Acesse: http://localhost:3000
echo  Para encerrar: pressione Ctrl+C
echo  ==========================================
echo.

timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"

node server.js

pause
