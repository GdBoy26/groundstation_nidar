# Separate Terminal Setup for VTOL and Delivery Drones

## Overview

Instead of running one backend that handles both drones, you can now run **TWO SEPARATE backends** in different terminals:

- **`vtol_backend.py`** - VTOL Scout only (COM17 → Port 8765)
- **`delivery_backend.py`** - Delivery Drone only (COM27 → Port 8766)

This gives you:
✅ Separate command terminals for each drone  
✅ Completely isolated logs (no mixing!)  
✅ Independent control of each drone  
✅ Cleaner debugging  

---

## How to Run

### Terminal 1: VTOL Scout

```bash
cd BACKEND
python vtol_backend.py
```

You'll see:
```
============================================================
  VTOL SCOUT TERMINAL
============================================================
Commands: PING, ARM, TAKEOFF:X, MODE:AUTO, RTL, QUIT
============================================================

CMD> 
```

**Commands:**
- `PING` - Test connection
- `ARM` - Arm VTOL
- `TAKEOFF:15` - Takeoff to 15m
- `MODE:AUTO` - Start autonomous mode
- `RTL` - Return to launch
- `QUIT` - Exit

---

### Terminal 2: Delivery Drone

Open a **NEW** terminal window:

```bash
cd BACKEND
python delivery_backend.py
```

You'll see:
```
============================================================
  DELIVERY DRONE TERMINAL
============================================================
Commands: PING, ARM, TAKEOFF:X, GOTO:lat,lon,alt, RTL, QUIT
============================================================

CMD> 
```

**Commands:**
- `PING` - Test connection
- `ARM` - Arm delivery drone
- `TAKEOFF:10` - Takeoff to 10m
- `GOTO:28.5450,77.1920,10` - Go to GPS coordinates
- `RTL` - Return to launch
- `QUIT` - Exit

---

## WebSocket Ports

Each backend runs its own WebSocket server:

| Drone | Script | COM Port | WebSocket | UI Panel |
|-------|--------|----------|-----------|----------|
| **VTOL Scout** | `vtol_backend.py` | COM17 | ws://localhost:8765 | VTOL - LOG |
| **Delivery** | `delivery_backend.py` | COM27 | ws://localhost:8766 | DRONE - LOG |

The frontend UI will automatically connect to both WebSocket servers.

---

## Logs

**VTOL Terminal** shows ONLY VTOL logs:
```
[VTOL] >> [00:20:15.123] [TELEM][INFO] M:AUTO A:N B:?V G:1(0) H:2.5m
CMD> PING
[VTOL_TX] >> PING
[VTOL] ✅ PONG
```

**Delivery Terminal** shows ONLY Delivery logs:
```
[DELIVERY] >> [00:20:15.456] [TELEM][INFO] M:STABILIZE A:N B:12.5V
CMD> PING
[DELIVERY_TX] >> PING
[DELIVERY] ✅ PONG
```

**No mixing! Completely separate!**

---

## Stopping

To stop either backend:
1. Type `QUIT` in that terminal, OR
2. Press `Ctrl+C`

---

## Old Combined Backend

The original `tx.py` still works if you want both drones in one terminal:

```bash
python tx.py
```

But for **separated logs and commands**, use the individual backends!

---

## Troubleshooting

### Port Already in Use
If you get "Address already in use" error:
1. Stop the old `tx.py` process
2. Or change the WebSocket port in the script

### Gibberish in Delivery Logs
If you see strange characters like `Q_L Qr QK`:
- Your delivery drone might be sending **binary MAVLink** data
- The script uses `decode('utf-8', errors='ignore')` to handle this
- Readable text messages will still appear correctly

### No Response from Drone
1. Check drone is powered ON
2. Check 3DR radio is connected to drone's telemetry port
3. Try `PING` command to test connection

---

## Frontend

The frontend (`npm run dev`) connects to BOTH WebSocket servers automatically:
- VTOL Panel → Port 8765
- DRONE Panel → Port 8766

No changes needed to the frontend!

---

## Quick Start (Both Drones)

**Terminal 1:**
```bash
cd BACKEND
python vtol_backend.py
```

**Terminal 2:**
```bash
cd BACKEND  
python delivery_backend.py
```

**Terminal 3:**
```bash
cd FRONTEND
npm run dev
```

**Browser:**
Open `http://localhost:3000`

✅ You now have complete control with separated logs! 🎉
