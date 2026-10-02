@echo off
setlocal
title Vkick - dev server
cd /d "%~dp0"

set "DRY=0"
if /i "%~1"=="--dry-run" set "DRY=1"

echo ==========================================
echo   Vkick - local dev launcher
echo ==========================================
echo.

rem ---- Node.js present? -------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
    echo [X] Node.js was not found on your PATH.
    echo.
    echo     Install the LTS build from https://nodejs.org
    echo     then run this file again.
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
echo [ok] Node %NODEV%

where npm >nul 2>nul
if errorlevel 1 (
    echo [X] npm was not found on your PATH.
    echo     Reinstall Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)
echo [ok] npm found

rem ---- Dependencies ----------------------------------------------------------
if exist "node_modules\" (
    echo [ok] Dependencies already installed
) else (
    echo [..] Installing dependencies ^(first run only, takes a minute^)
    call npm install --no-fund --no-audit
    if errorlevel 1 (
        echo.
        echo [X] npm install failed. Scroll up for the reason.
        echo.
        pause
        exit /b 1
    )
    echo [ok] Dependencies installed
)

if "%DRY%"=="1" (
    echo.
    echo [ok] Setup looks good.
    echo     Run start.bat with no arguments to launch the app.
    echo.
    pause
    exit /b 0
)

rem ---- Port check -------------------------------------------------------------
rem A stale dev server on 5173 used to push the app to 5174/5175, which breaks
rem the Telegram tunnel URL and any bookmark. Say so instead of drifting.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:"TCP .*:5173 .*LISTENING"') do (
  echo [X] Port 5173 is already in use by PID %%p.
  echo.
  echo     A previous dev server is still running. Close it, or run:
  echo       taskkill /PID %%p /F
  echo.
  pause
  exit /b 1
)

rem ---- Launch ----------------------------------------------------------------
echo.
echo Starting the API server and the dev server.
echo Your browser opens automatically when it is ready.
echo.
echo   Local:  http://localhost:5173
echo   Phone:  use the Network URL printed below, on the same wi-fi
echo.
echo   The API runs in the background of THIS window, logging to logs\api.log,
echo   and the dev server runs in the foreground. Closing this window stops both.
echo   To test inside Telegram, run start-telegram.bat instead.
echo.

if not exist "logs\" mkdir "logs\"

echo [..] Starting the API server in the background ^(log: logs\api.log^)
rem One window, one process tree. A second console window for the API was the
rem part we could not verify: the server reported "listening" there and still
rem answered nothing. Logging to a file also means a crash survives the window.
start "Vkick - API server" /b cmd /c "npm run server > logs\api.log 2>&1"

rem Wait for the API to actually answer, not just to be spawned. A launcher that
rem proceeds regardless is how a dead API becomes a silent ECONNREFUSED wall.
echo [..] Waiting for the API to answer on port 8787
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\wait-for-api.ps1" -TimeoutSeconds 30
if errorlevel 1 goto :apifail

echo [ok] API is up ^(http://localhost:8787^)
echo.
goto :launchdev

:apifail
echo.
echo [X] The API server is not answering on port 8787, so nothing else can work.
echo     This is everything it printed:
echo.
type "logs\api.log"
echo.
echo ---------------------------------------------------------------
echo Fix the error above, then run start.bat again.
pause
exit /b 1

:launchdev
rem `--open` is what actually opens the app window. Plain `vite --host` only
rem prints the URL, so the "browser opens automatically" line above used to be a
rem promise nothing kept. Passed here (not in vite.config.ts) so that
rem start-telegram.bat, which wants the tunnel URL instead, stays quiet.
call npm run dev -- --open

echo.
echo Server stopped. The API server window may still be open - close it when done.
pause
