# Telemetry Log Integration Guide

## Overview

The backend `tx.py` file now broadcasts telemetry logs to the frontend in real-time via WebSocket. When you run `tx.py`, all logs from the drone are automatically sent to the frontend and displayed in the LogPanel.

## Architecture

### Backend (tx.py)
- **WebSocket Server**: Starts on `ws://0.0.0.0:8000/telemetry`
- **Log Broadcasting**: Every log message from the drone is sent to all connected WebSocket clients
- **Auto-reconnect**: The server automatically restarts if the connection is lost

### Frontend (React/Next.js)

#### New File: `lib/telemetryWebSocket.ts`
- **TelemetryWebSocketClient**: Handles WebSocket connection and message parsing
- **Auto-reconnect**: Automatically attempts to reconnect if disconnected
- **Log Handling**: Receives log messages and adds them to the Zustand store
- **Telemetry Handling**: Receives telemetry updates and updates the store

#### Updated: `components/TelemetryBootstrap.tsx`
- Initializes WebSocket connection on app startup

#### Existing: `stores/telemetryStore.ts`
- Already has `addLog()` method to store logs
- Logs are displayed in the LogPanel component

## Usage

### Step 1: Install websockets package on backend
```bash
pip install websockets
```

### Step 2: Run the backend
```bash
python3 tx.py
```

This will output:
```
[WS] WebSocket server started on ws://0.0.0.0:8000/telemetry
[INFO] Connecting to radio on COM3 @ 57600...
[OK] Connected to radio
CMD>
```

### Step 3: Run the frontend
```bash
npm run dev
```

The frontend will automatically connect to the WebSocket server.

### Step 4: Send drone commands
From the tx.py prompt, send commands like:
```
CMD> SCOUT
CMD> ARM
CMD> TAKEOFF:10
```

The logs will appear in real-time in the LogPanel on the frontend.

## Log Message Format

Logs sent from tx.py to the frontend follow this format:

```json
{
  "action": "log",
  "data": {
    "time": "HH:MM:SS",
    "source": "DRONE",
    "level": "INFO|WARN|ERROR",
    "message": "Log message text"
  }
}
```

## Telemetry Update Format

Telemetry updates follow this format:

```json
{
  "action": "telemetry",
  "data": {
    "vtolArmed": true,
    "droneArmed": false,
    "vtolFlying": true,
    "droneFlying": false,
    "pitch": 5.2,
    "roll": -2.1,
    "speed": 8.5,
    "heading": 270,
    "batteryVoltage": 12.5,
    "droneGps": {"lat": 28.545, "lon": 77.192, "alt": 120},
    "vtolGps": {"lat": 28.546, "lon": 77.191, "alt": 0}
  }
}
```

## Connection Status

### In the browser console
- **Connected**: `[WS] Connected to telemetry server`
- **Disconnected**: `[WS] Disconnected from telemetry server`
- **Reconnecting**: `[WS] Attempting to reconnect in 3000ms...`

### In the backend console
- **Client connected**: `[WS] Client connected. Total clients: 1`
- **Client disconnected**: `[WS] Client disconnected. Total clients: 0`

## Troubleshooting

### WebSocket connection fails
1. Ensure `websockets` package is installed: `pip install websockets`
2. Check that the backend is running on port 8000
3. Check firewall settings - port 8000 should be accessible

### Logs not appearing
1. Check browser console for connection errors
2. Verify the backend is sending logs with `print()` statements
3. Check that logs are being added to the store

### Auto-reconnect not working
1. Check that the backend is still running
2. Verify network connectivity
3. Check for firewall blocking the connection

## Future Enhancements

- [ ] Send telemetry updates from tx.py to frontend
- [ ] Support multiple telemetry sources
- [ ] Add authentication/authorization
- [ ] Persistent log storage
- [ ] Log filtering by source/level
- [ ] Real-time log search
