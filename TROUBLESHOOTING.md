# NIDAR GCS Troubleshooting Guide

## Issue 1: Too Many WebSocket Connections

### Problem
You're seeing 10+ WebSocket connections instead of 2 (1 for VTOL, 1 for Delivery).

###Root Cause
Two separate parts of the frontend are creating WebSocket connections:
1. `TelemetryBootstrap.tsx` → `telemetryWebSocket.ts` (creates 2 connections)
2. `action-buttons.tsx` (creates 2 MORE connections)

### Solution
**Use ONLY the shared WebSocket client** from `telemetryWebSocket.ts`. 

The `action-buttons.tsx` should import and use `getTelemetryWebSocketClient()` instead of creating its own connections.

---

## Issue 2: No PONG Response from Drone

### Problem
You send `PING` via COM17 but don't receive `PONG` back from the drone.

### Why This Happens
1. **Drone is powered off** - Most common issue
2. **Air-side radio not connected** to drone's telemetry port  
3. **Radios not paired** - Check if both radios have matching NET ID
4. **Wrong baud rate** - Your config uses 57600, but drone might expect different
5. **Drone doesn't understand command** - MAVLink drones don't respond to plain text "PING"

### How to Debug

#### Step 1: Check if drone is sending ANYTHING
Watch the backend terminal. If drone is powered on and connected, you should see:
```
[VTOL_RX] >> [data from drone]
```

If you see NOTHING, the radio link isn't working.

#### Step 2: Check Radio LEDs
- **Solid Green** on both radios = Good link, paired
- **Blinking Red** = Searching for pair, not connected
- **Off** = Not powered

#### Step 3: Check COM Port
Your config says VTOL is on COM17. Verify:
```powershell
python -c "from serial.tools import list_ports; [print(f'{p.device} - {p.description}') for p in list_ports.comports()]"
```

#### Step 4: Check Baud Rate
Your config uses **57600 baud**. Common rates for drones:
- **57600** - Most common for MAVLink telemetry
- **115200** - Some flight controllers
- **921600** - High-speed (newer radios)

Check your flight controller's telemetry port settings!

#### Step 5: MAVLink vs Plain Text
If your drone uses **MAVLink protocol** (like Pixhawk, Ardupilot), it won't respond to plain text "PING".

**Solution:** Use MAVLink heartbeat instead. The backend needs to:
1. Import `pymavlink`
2. Send MAVLink HEARTBEAT messages
3. Listen for MAVLink HEARTBEAT responses

---

##Issue 3: React Hydration Mismatch

### Problem
Console error about server/client HTML mismatch with `antigravity-scroll-lock` class.

### Cause
A browser extension or dynamic class is adding/removing classes after server render.

### Solution 1: Suppress the Warning (Quick Fix)
In `layout.tsx`, add `suppressHydrationWarning`:

```tsx
<body className="font-sans antialiased" suppressHydrationWarning>
```

### Solution 2: Use Client-Only Component
Wrap the component causing issues in a client-only wrapper.

---

## Testing Without Hardware (Demo Mode)

To test that your software works WITHOUT needing the actual drones:

```bash
cd BACKEND
python tx.py --demo
```

This will:
- Simulate VTOL and Delivery drone responses
- Send fake telemetry data
- Respond to commands with ACKs
- Simulate human detections after 30 seconds in AUTO mode

---

## Common Questions

### Q: How do I know if my drone is using MAVLink?
**A:** Most modern drones (Pixhawk, Ardupilot, PX4) use MAVLink. If you connect via Mission Planner or QGroundControl, it's MAVLink.

### Q: What if only one radio is connected?
**A:** The system will work with just VTOL connected. The Delivery drone will show as disconnected, but won't crash.

### Q: Can I use different COM ports?
**A:** Yes! Edit `BACKEND/config/radio_config.json`:
```json
{
  "vtol": {
    "port": "COM17",  ← Change this
    ...
  },
  "delivery": {
    "port": "COM19",  ← Change this
    ...
  }
}
```

Then restart the backend.

### Q: How do I check if my 3DR radios are working?
**A:** Use a terminal program like PuTTY or the Arduino Serial Monitor:
1. Connect ground radio to USB (e.g., COM17)
2. Open serial terminal at 57600 baud
3. Type anything and press Enter
4. If radios are paired and drone is on, you should see MAVLink binary data streaming back

---

## Next Steps

1. **Power on your VTOL drone**
2. **Check radio LEDs** - should be solid green
3. **Run backend:** `python tx.py`
4. **Check for data:** Look for `[VTOL_RX]` messages
5. **If no data:** Check wiring, power, baud rate, radio pairing

Need more help? Check `TELEMETRY_INTEGRATION.md` for architecture details.
