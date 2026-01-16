@echo off
REM ========================================
REM   NIDAR DUAL DRONE BACKENDS ONLY
REM   Opens 2 separate terminals:
REM   1. VTOL Backend (COM22)
REM   2. Delivery Backend (COM17)
REM ========================================

echo.
echo ========================================
echo   NIDAR DUAL DRONE BACKENDS
echo ========================================
echo.
echo   Starting 2 separate terminals...
echo.
echo   Terminal 1: VTOL Backend    (COM22 -^> ws://localhost:8765)
echo   Terminal 2: Delivery Backend (COM17 -^> ws://localhost:8766)
echo.
echo ========================================
echo.

REM Get the directory where this script is located
set "SCRIPT_DIR=%~dp0"

REM Terminal 1: VTOL Backend
echo [1/2] Starting VTOL Backend...
start "VTOL BACKEND - COM22:8765" cmd /k "cd /d "%SCRIPT_DIR%" && echo ======================================== && echo    VTOL SCOUT BACKEND && echo    COM22 @ 57600 baud && echo    WebSocket: ws://localhost:8765 && echo ======================================== && echo. && python vtol_backend.py"

REM Wait 2 seconds before starting next terminal
timeout /t 2 /nobreak > nul

REM Terminal 2: Delivery Backend
echo [2/2] Starting Delivery Backend...
start "DELIVERY BACKEND - COM17:8766" cmd /k "cd /d "%SCRIPT_DIR%" && echo ======================================== && echo    DELIVERY DRONE BACKEND && echo    COM17 @ 57600 baud && echo    WebSocket: ws://localhost:8766 && echo ======================================== && echo. && python delivery_backend.py"

echo.
echo ========================================
echo   BOTH BACKENDS STARTED!
echo ========================================
echo.
echo   Terminal 1: VTOL Backend (COM22 @ 57600)
echo   Terminal 2: Delivery Backend (COM17 @ 57600)
echo.
echo   WebSocket Servers:
echo   - VTOL:     ws://localhost:8765
echo   - DELIVERY: ws://localhost:8766
echo.
echo   To stop: Close terminal windows or press Ctrl+C
echo ========================================
echo.
pause
