@echo off
setlocal
title Vkick - Telegram tunnel
cd /d "%~dp0"

echo ==========================================
echo   Vkick - Telegram Mini App testing
echo ==========================================
echo.
echo This starts the dev server, then opens a public HTTPS tunnel to it.
echo Telegram only loads Mini Apps over HTTPS, so localhost cannot be used directly.
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [X] Node.js was not found on your PATH.
    echo     Install the LTS build from https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo [..] Installing dependencies ^(first run only^)
    call npm install --no-fund --no-audit
    if errorlevel 1 (
        echo.
        echo [X] npm install failed. Scroll up for the reason.
        echo.
        pause
        exit /b 1
    )
)

if not exist "logs\" mkdir "logs\"

echo [..] Starting the API server in the background ^(log: logs\api.log^)
start "Vkick - API server" /b cmd /c "npm run server > logs\api.log 2>&1"

rem Same gate as start.bat: wait for the API to actually answer. A tunnel that
rem opens before the API is ready just produces a connection-refused page in
rem Telegram, which is far more confusing than waiting a few seconds here.
echo [..] Waiting for the API to answer on port 8787
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\wait-for-api.ps1" -TimeoutSeconds 30
if errorlevel 1 (
  echo.
  echo [X] The API server is not answering on port 8787, so the tunnel would only
  echo     show a connection error. Its output:
  echo.
  type "logs\api.log"
  echo.
  pause
  exit /b 1
)

echo [..] Starting the dev server in its own window ^(leave it open^)
start "Vkick - dev server" cmd /k "npm run dev"

echo [..] Waiting for the dev server to come up...
timeout /t 4 /nobreak >nul

echo.
echo --------------------------------------------------------------------------
echo  NEXT STEPS, once the https URL appears below:
echo.
echo   1. Copy the https://....trycloudflare.com URL
echo   2. In Telegram, open @BotFather
echo   3. Send /newapp   ^(or /mybots ^> Bot Settings ^> Menu Button^)
echo   4. Paste the URL as the Web App URL
echo   5. Open your bot and tap the menu button
echo.
echo  The app detects Telegram automatically: header colour, haptics and the
echo  closing swipe all switch on with no rebuild.
echo --------------------------------------------------------------------------
echo.

where cloudflared >nul 2>nul
if errorlevel 1 (
    echo [..] cloudflared is not installed - using the npm build instead.
    echo      To install it permanently:  winget install --id Cloudflare.cloudflared
    echo.
    call npx -y cloudflared tunnel --url http://localhost:5173
) else (
    call cloudflared tunnel --url http://localhost:5173
)

echo.
echo Tunnel closed. The dev server window is still running - close it when done.
pause
