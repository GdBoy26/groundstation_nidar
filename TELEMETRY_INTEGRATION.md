# NIDAR Ground Control Station - System Documentation

## System Overview

NIDAR GCS controls two drones via **433MHz radio** links with **independent WebSocket servers**:

| Drone | Serial Port | WebSocket | Purpose |
|-------|-------------|-----------|---------|
| **VTOL Scout** | COM17 | ws://localhost:8765 | KML boundary survey, human detection |
| **Delivery Drone** | COM19 | ws://localhost:8766 | Supply delivery to detected humans |

## Key Features

### 1. Independent Log Streams
- **VTOL logs** only appear in VTOL panel (via port 8765)
- **Delivery logs** only appear in Delivery panel (via port 8766)
- No cross-contamination of logs between drones

### 2. VTOL RTL Logic
- **VTOL does NOT RTL on a timer**
- **VTOL RTL happens ONLY when KML mission is complete**
- Mission complete is detected by messages like: `MISSION COMPLETE`, `KML COMPLETE`, `SURVEY COMPLETE`

### 3. Human Detection Queue
- VTOL broadcasts human detections
- GCS queues detections with de-duplication (10m radius)
- Delivery drone dispatched to queued locations

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        NIDAR GCS ARCHITECTURE                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   VTOL Scout                          Delivery Drone                │
│   (433MHz)                            (433MHz)                      │
│       │                                   │                         │
│       ▼                                   ▼                         │
│   ┌───────┐                           ┌───────┐                     │
│   │ COM17 │                           │ COM19 │                     │
│   └───┬───┘                           └───┬───┘                     │
│       │                                   │                         │
│       ▼                                   ▼                         │
│   ┌─────────────────────────────────────────────────────┐          │
│   │               tx.py (Python Backend)                 │          │
│   │  ┌─────────────────────┬─────────────────────────┐  │          │
│   │  │  VTOL Handler       │    Delivery Handler     │  │          │
│   │  │  - Send/Receive     │    - Send/Receive       │  │          │
│   │  │  - Parse Telemetry  │    - Parse Telemetry    │  │          │
│   │  │  - Detect Humans    │    - Execute Delivery   │  │          │
│   │  └──────────┬──────────┴───────────┬─────────────┘  │          │
│   │             │                      │                 │          │
│   │     Detection Queue ◄──────────────┘                 │          │
│   │     (human locations)                                │          │
│   └─────────────────────────────────────────────────────┘          │
│             │                          │                            │
│             ▼                          ▼                            │
│   ┌─────────────────┐        ┌─────────────────┐                   │
│   │  WebSocket 8765 │        │  WebSocket 8766 │                   │
│   │  (VTOL ONLY)    │        │  (DELIVERY ONLY)│                   │
│   └────────┬────────┘        └────────┬────────┘                   │
│            │                          │                            │
│            ▼                          ▼                            │
│   ┌─────────────────────────────────────────────────────┐          │
│   │              Next.js Frontend                        │          │
│   │  ┌─────────────────┐  ┌─────────────────┐           │          │
│   │  │  VTOL Panel     │  │  Delivery Panel │           │          │
│   │  │  - Logs (VTOL)  │  │  - Logs (DRONE) │           │          │
│   │  │  - Telemetry    │  │  - Telemetry    │           │          │
│   │  │  - Map Track    │  │  - Map Track    │           │          │
│   │  └─────────────────┘  └─────────────────┘           │          │
│   └─────────────────────────────────────────────────────┘          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Human Detection Flow
```
1. VTOL Scout flying KML boundary
2. Onboard camera detects human
3. VTOL sends: "HUMAN DETECTED: 1 person(s), conf=0.92, loc=28.545,77.192,15.0m"
4. tx.py parses detection, adds to queue
5. Detection event broadcast to both WebSockets
6. Delivery drone dispatched to location
```

### RTL Flow (VTOL)
```
1. VTOL completes KML survey mission
2. VTOL sends: "MISSION COMPLETE" or "KML COMPLETE"
3. tx.py detects mission complete
4. Automatic RTL command sent to VTOL
5. VTOL returns to launch
```

## Configuration

### Radio Config (config/radio_config.json)
```json
{
  "frequency": "433MHz",
  "vtol": {
    "name": "VTOL Scout",
    "port": "COM17",
    "baud": 57600,
    "websocket_port": 8765
  },
  "delivery": {
    "name": "Delivery Drone",
    "port": "COM19",
    "baud": 57600,
    "websocket_port": 8766
  }
}
```

## Usage

### Backend
```bash
# With hardware
python tx.py

# Demo mode (no hardware)
python tx.py --demo

# Manual port specification
python tx.py --port COM17 --delivery-port COM19
```

### Frontend
```bash
cd FRONTEND
npm run dev
```

### Commands
Prefix commands with `V:` for VTOL or `D:` for Delivery:

```
V:PING          - Ping VTOL
V:ARM           - Arm VTOL
V:TAKEOFF:15    - VTOL takeoff to 15m
V:MODE:AUTO     - Start KML survey mission
V:RTL           - VTOL return to launch (manual)

D:PING          - Ping Delivery drone
D:ARM           - Arm Delivery drone
D:TAKEOFF:10    - Delivery takeoff
D:GOTO:lat,lon,alt - Go to location
D:DELIVER       - Execute delivery
D:RTL           - Delivery return to launch

QUEUE           - Show detection queue status
HELP            - Show all commands
```

## WebSocket Message Formats

### Log Message
```json
{
  "action": "log",
  "data": {
    "time": "14:32:15",
    "source": "VTOL",
    "level": "INFO",
    "message": "ARMED - Motors ready"
  }
}
```

### Telemetry Message
```json
{
  "action": "telemetry",
  "data": {
    "vtolGps": { "lat": 28.545, "lon": 77.192, "alt": 15.0 },
    "heading": 180.5,
    "speed": 8.2,
    "batteryPercent": 85
  }
}
```

### Detection Event
```json
{
  "action": "detection",
  "event": "human_detected",
  "data": {
    "lat": 28.545123,
    "lon": 77.192456,
    "alt": 15.0,
    "confidence": 0.92,
    "count": 1
  }
}
```

## Troubleshooting

### Logs appearing in wrong panel
- Each WebSocket server is independent
- VTOL (8765) only sends VTOL logs
- Delivery (8766) only sends Delivery logs
- Check frontend connection to correct port

### VTOL RTL happening unexpectedly
- VTOL RTL is triggered ONLY by mission complete
- Check for mission complete messages in logs
- No automatic timer-based RTL

### Connection issues
- Check COM ports are available
- Verify 433MHz radio links are active
- Run in `--demo` mode to test without hardware
