@echo off
setlocal
cd /d "%~dp0"
title openGym - Ambiente Local

where node >nul 2>nul
if errorlevel 1 (
  echo Erro: Node.js nao encontrado no PATH.
  pause
  exit /b 1
)

if /i "%~1"=="dev" goto :run_dev
if /i "%~1"=="pull" goto :run_pull_dev
if /i "%~1"=="snapshot" goto :run_snapshot
if /i "%~1"=="reset" goto :run_reset
if /i "%~1"=="media" goto :run_media

set /a _EMPTY=0

:menu
echo.
echo ==========================================
echo   openGym - Ambiente Local (Windows)
echo   http://localhost:5173
echo ==========================================
echo.
echo   [1] Subir ambiente local
echo   [2] Puxar snapshot da VPS e subir ambiente
echo   [3] Puxar apenas o snapshot (sem subir)
echo   [4] Resetar perfil de teste zerado (--reset-zero)
echo   [5] Rebaixar midia (JPG/GIF) e subir ambiente
echo   [0] Sair
echo.
set "CHOICE="
set /p "CHOICE=Escolha uma opcao [0-5]: "
if "%CHOICE%"=="" (
  set /a _EMPTY+=1
  if %_EMPTY% GEQ 5 exit /b 0
  echo Opcao invalida.
  goto :menu
)
set /a _EMPTY=0
if "%CHOICE%"=="1" goto :run_dev
if "%CHOICE%"=="2" goto :run_pull_dev
if "%CHOICE%"=="3" goto :run_snapshot
if "%CHOICE%"=="4" goto :run_reset
if "%CHOICE%"=="5" goto :run_media
if "%CHOICE%"=="0" exit /b 0
echo Opcao invalida.
goto :menu

:run_dev
echo.
echo Iniciando openGym em http://localhost:5173 ...
node scripts\dev.mjs
echo.
pause
goto :menu

:run_pull_dev
echo.
set "TARGET_FILE=%LOCALAPPDATA%\opengym-dev\data\.snapshot-target"
if exist "%TARGET_FILE%" (
  node scripts\dev.mjs --pull
) else (
  set "TARGET="
  set /p "TARGET=Nome exato ou UID do usuario na VPS: "
  if "%TARGET%"=="" goto :menu
  node scripts\dev.mjs --pull "%TARGET%"
)
echo.
pause
goto :menu

:run_snapshot
echo.
set "TARGET_FILE=%LOCALAPPDATA%\opengym-dev\data\.snapshot-target"
if exist "%TARGET_FILE%" (
  node scripts\dev-snapshot.mjs
) else (
  set "TARGET="
  set /p "TARGET=Nome exato ou UID do usuario na VPS: "
  if "%TARGET%"=="" goto :menu
  node scripts\dev-snapshot.mjs --user "%TARGET%"
)
echo.
pause
goto :menu

:run_reset
echo.
set "CONFIRM="
set /p "CONFIRM=Apagar usuarios/dados secundarios (mantendo seu snapshot)? [S/N]: "
if /i not "%CONFIRM%"=="S" goto :menu
node scripts\dev-snapshot.mjs --reset-zero
echo.
pause
goto :menu

:run_media
echo.
node scripts\dev.mjs --refresh-media
echo.
pause
goto :menu
