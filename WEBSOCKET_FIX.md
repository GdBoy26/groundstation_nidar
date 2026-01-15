# WebSocket Command Format Fix

## Problem
When clicking "START MISSION" in the UI, the backend showed:
```
[VTOL_WS] Command from frontend: 
```
The command was EMPTY! No commands were being sent to the drone.

## Root Cause
**Mismatched JSON key names** between frontend and backend:

### Frontend was sending:
```json
{
  "action": "command",
  "data": "PING"      ← Wrong key name!
}
```

### Backend expected:
```json
{
  "action": "command",
  "command": "PING"   ← Correct key name!
}
```

## The Fix
Changed 2 locations in `action-buttons.tsx`:

### Line 322 (sendCommandWithRetry):
```typescript
// BEFORE:
wsRef.current.send(JSON.stringify({ action: "command", data: command }))

// AFTER:
wsRef.current.send(JSON.stringify({ action: "command", command: command }))
```

### Line 394 (sendCommand):
```typescript
// BEFORE:
wsRef.current.send(JSON.stringify({ action: "command", data: command }))

// AFTER:
wsRef.current.send(JSON.stringify({ action: "command", command: command }))
```

## Result
✅ Commands now properly sent to drone  
✅ START MISSION button will trigger the full mission sequence:
  1. PING (test connection)
  2. ARM (arm motors)
  3. TAKEOFF:15 (takeoff to 15m)
  4. SCOUT (enable human detection)
  5. MODE:AUTO (start autonomous mission)

## Testing
Click "🚀 START" button in the UI. You should now see:
```
[VTOL_WS] Command from frontend: PING
[VTOL_TX] >> PING
[VTOL] ✅ PONG
```

Instead of empty commands!
