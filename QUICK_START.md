# Quick Start Scripts for NIDAR Dual Drone System

## Available Scripts

You now have **2 startup scripts** to choose from:

---

## 🚀 Option 1: Start Everything (Recommended)

**File:** `start_all.bat`  
**Location:** `groundstation_nidar/start_all.bat`

**What it does:**
- ✅ Opens **3 separate terminal windows**
- ✅ Terminal 1: **VTOL Backend** (COM17 @ 57600 baud → ws://localhost:8765)
- ✅ Terminal 2: **Delivery Backend** (COM27 @ 115200 baud → ws://localhost:8766)
- ✅ Terminal 3: **Frontend** (Next.js dev server → http://localhost:3000)

**How to use:**
```bash
cd groundstation_nidar
start_all.bat
```

Then open your browser to: **http://localhost:3000**

---

## 🔧 Option 2: Start Backends Only (Testing)

**File:** `start_backends.bat`  
**Location:** `groundstation_nidar/BACKEND/start_backends.bat`

**What it does:**
- ✅ Opens **2 separate terminal windows**
- ✅ Terminal 1: **VTOL Backend** (COM17 @ 57600 baud)
- ✅ Terminal 2: **Delivery Backend** (COM27 @ 115200 baud)
- ❌ Does NOT start the frontend

**How to use:**
```bash
cd groundstation_nidar\BACKEND
start_backends.bat
```

**Use this when:**
- Testing drone connections without UI
- Debugging backend communication
- You want to manually start the frontend later

---

## 📋 What You'll See

After running `start_all.bat`, you'll see **3 terminal windows** open:

### Terminal 1: VTOL Backend
```
========================================
   VTOL SCOUT BACKEND
   COM17 @ 57600 baud
   WebSocket: ws://localhost:8765
========================================

[VTOL] Connecting to COM17 @ 57600...
[VTOL] ✅ Connected to COM17
[VTOL_WS] WebSocket server started on ws://0.0.0.0:8765

============================================================
  VTOL SCOUT TERMINAL
============================================================
Commands: PING, ARM, TAKEOFF:X, MODE:AUTO, RTL, QUIT
============================================================

CMD>
```

### Terminal 2: Delivery Backend
```
========================================
   DELIVERY DRONE BACKEND
   COM27 @ 115200 baud
   WebSocket: ws://localhost:8766
========================================

[DELIVERY] Connecting to COM27 @ 115200...
[DELIVERY] ✅ Connected to COM27
[DELIVERY_WS] WebSocket server started on ws://0.0.0.0:8766

============================================================
  DELIVERY DRONE TERMINAL
============================================================
Commands: PING, ARM, TAKEOFF:X, GOTO:lat,lon,alt, RTL, QUIT
============================================================

CMD>
```

### Terminal 3: Frontend
```
========================================
   NIDAR GROUND CONTROL STATION
   Frontend UI
   URL: http://localhost:3000
========================================

> groundstation_nidar@0.1.0 dev
> next dev

   ▲ Next.js 14... ready in 2.3s
   - Local:        http://localhost:3000
```

---

## 🎯 Testing the Drones

Once all terminals are open, you can:

1. **Test VTOL Connection:**
   - Go to Terminal 1 (VTOL Backend)
   - Type: `PING` and press Enter
   - You should see: `[VTOL] ✅ PONG`

2. **Test Delivery Connection:**
   - Go to Terminal 2 (Delivery Backend)
   - Type: `PING` and press Enter
   - You should see: `[DELIVERY] ✅ PONG`

3. **Use the Frontend:**
   - Open browser to `http://localhost:3000`
   - You should see both drone panels
   - Logs from both drones will appear separately

---

## 🛑 Stopping the System

**Option 1: Close All Terminals**
- Simply close each terminal window

**Option 2: Use QUIT Command**
- In VTOL terminal: Type `QUIT`
- In Delivery terminal: Type `QUIT`
- In Frontend terminal: Press `Ctrl+C`

**Option 3: Ctrl+C**
- Press `Ctrl+C` in each terminal

---

## 🔍 Troubleshooting

### "Port already in use" error
- **Cause:** Old backend process still running
- **Fix:** 
  1. Close all terminal windows
  2. Check Task Manager for `python.exe` processes
  3. Kill any lingering Python processes
  4. Run the script again

### "Can't open file" error
- **Cause:** Running script from wrong directory
- **Fix:** Make sure you run `start_all.bat` from the `groundstation_nidar` folder

### No response from PING command
- **Cause:** Drone not connected or powered off
- **Fix:**
  1. Check drone is powered ON
  2. Check 3DR radio is connected to drone telemetry port
  3. Verify COM port in Device Manager
  4. Check radio baud rate settings

### Gibberish/garbled text in logs
- **Cause:** Wrong baud rate
- **Fix:** 
  - VTOL should be 57600 baud
  - Delivery should be 115200 baud
  - Update `config/radio_config.json` if needed

---

## 📁 File Locations

```
groundstation_nidar/
├── start_all.bat              ← Run this for everything
├── BACKEND/
│   ├── start_backends.bat     ← Run this for backends only
│   ├── vtol_backend.py        ← VTOL backend script
│   ├── delivery_backend.py    ← Delivery backend script
│   └── config/
│       └── radio_config.json  ← Port and baud settings
└── FRONTEND/
    └── (Next.js app files)
```

---

## 🎉 Quick Reference

| Script | Terminals | Use Case |
|--------|-----------|----------|
| `start_all.bat` | 3 (VTOL + Delivery + Frontend) | **Full system operation** |
| `start_backends.bat` | 2 (VTOL + Delivery only) | **Backend testing only** |

---

## 📡 Port Configuration

| Drone | COM Port | Baud Rate | WebSocket | Frontend Panel |
|-------|----------|-----------|-----------|----------------|
| **VTOL Scout** | COM17 | 57600 | ws://localhost:8765 | VTOL - LOG |
| **Delivery** | COM27 | 115200 | ws://localhost:8766 | DRONE - LOG |

---

## ✅ Success Checklist

After running `start_all.bat`, verify:

- [ ] Terminal 1 shows "✅ Connected to COM17"
- [ ] Terminal 2 shows "✅ Connected to COM27"
- [ ] Terminal 3 shows "ready in" and "Local: http://localhost:3000"
- [ ] PING command in VTOL terminal returns PONG
- [ ] PING command in Delivery terminal returns PONG
- [ ] Browser shows UI at http://localhost:3000
- [ ] Both drone panels show data in the UI

**If all checkmarks are green: You're ready to fly! 🚁✈️**
