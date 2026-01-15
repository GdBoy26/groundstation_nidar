@echo off
REM ========================================
REM   NIDAR DUAL DRONE SYSTEM - AUTO START
REM   Opens 3 separate terminals:
REM   1. VTOL Backend (COM17)
REM   2. Delivery Backend (COM27)
REM   3. Frontend (Next.js)
REM ========================================

echo.
echo ========================================
echo   NIDAR DUAL DRONE SYSTEM STARTUP
echo ========================================
echo.
echo   Starting 3 separate terminals...
echo.
echo   Terminal 1: VTOL Backend    (COM17 -^> ws://localhost:8765)
echo   Terminal 2: Delivery Backend (COM27 -^> ws://localhost:8766)
echo   Terminal 3: Frontend         (http://localhost:3000)
echo.
echo ========================================
echo.

REM Get the directory where this script is located
set "SCRIPT_DIR=%~dp0"

REM Terminal 1: VTOL Backend
echo [1/3] Starting VTOL Backend...
start "VTOL BACKEND - COM17:8765" cmd /k "cd /d "%SCRIPT_DIR%BACKEND" && echo ======================================== && echo    VTOL SCOUT BACKEND && echo    COM17 @ 57600 baud && echo    WebSocket: ws://localhost:8765 && echo ======================================== && echo. && python vtol_backend.py"

REM Wait 2 seconds before starting next terminal
timeout /t 2 /nobreak > nul

REM Terminal 2: Delivery Backend
echo [2/3] Starting Delivery Backend...
start "DELIVERY BACKEND - COM27:8766" cmd /k "cd /d "%SCRIPT_DIR%BACKEND" && echo ======================================== && echo    DELIVERY DRONE BACKEND && echo    COM27 @ 115200 baud && echo    WebSocket: ws://localhost:8766 && echo ======================================== && echo. && python delivery_backend.py"

REM Wait 3 seconds for backends to initialize
timeout /t 3 /nobreak > nul

REM Terminal 3: Frontend
echo [3/3] Starting Frontend...
start "FRONTEND - localhost:3000" cmd /k "cd /d "%SCRIPT_DIR%FRONTEND" && echo ======================================== && echo    NIDAR GROUND CONTROL STATION && echo    Frontend UI && echo    URL: http://localhost:3000 && echo ======================================== && echo. && npm run dev"

echo.
echo ========================================
echo   ALL TERMINALS STARTED!
echo ========================================
echo.
echo   Terminal 1: VTOL Backend (COM17)
echo   Terminal 2: Delivery Backend (COM27)
echo   Terminal 3: Frontend (localhost:3000)
echo.
echo   Once all services are running:
echo   Open browser to: http://localhost:3000
echo.
echo   To stop: Close each terminal window or press Ctrl+C
echo ========================================
echo.
pause
