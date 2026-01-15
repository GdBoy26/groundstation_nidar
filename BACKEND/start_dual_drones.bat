@echo off
echo ========================================
echo   NIDAR DUAL DRONE SYSTEM STARTUP
echo ========================================
echo.
echo   VTOL (Scout):    COM17 -^> ws://localhost:8765
echo   QUADCOPTER:      COM22 -^> ws://localhost:8766
echo.

echo Starting VTOL Drone Server (COM17 -^> Port 8765)...
start "VTOL Server" cmd /k "cd /d %~dp0 && python tx.py --port COM17"

timeout /t 2 /nobreak > nul

echo Starting DELIVERY Drone Server (COM22 -^> Port 8766)...
start "DELIVERY Server" cmd /k "cd /d %~dp0 && python tx_delivery.py --port COM22"

echo.
echo ========================================
echo   Both drone servers started!
echo.
echo   VTOL Server:     COM17 -^> ws://localhost:8765
echo   DELIVERY Server: COM22 -^> ws://localhost:8766
echo.
echo   Now start the frontend with:
echo   cd ..\FRONTEND && npm run dev
echo ========================================

pause
