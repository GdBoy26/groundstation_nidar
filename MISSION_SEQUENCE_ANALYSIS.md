# Mission Button Sequence Analysis & Critical Safety Issue

**Date**: 2026-01-16 07:51  
**Critical Bug**: Mission starts even when VTOL battery is disconnected ❌

---

## 🚨 CRITICAL SAFETY ISSUE

### Problem
When the user removed the VTOL battery and pressed "START MISSION", the system proceeded with the mission anyway. **This is a critical safety failure.**

### Root Cause
The `handleStartLaunch()` function in `action-buttons.tsx` (Line 637) does **NOT** check hardware connection status before starting the mission.

```typescript
// Line 637-680: NO HARDWARE CHECKS!
const handleStartLaunch = useCallback(async () => {
  setIsLaunching(true)
  // ... directly proceeds to startVTOLMission()
  await startVTOLMission() // ❌ No pre-flight checks!
})
```

### Missing Safety Checks
1. ❌ No VTOL hardware connection verification
2. ❌ No Delivery drone hardware connection verification  
3. ❌ No battery level checks
4. ❌ No GPS signal validation
5. ❌ No "ready for flight" verification

---

## Current Button Sequences (AS-IS)

### 🚀 **START MISSION** Button
**Location**: Line 1115-1124  
**Handler**: `handleStartLaunch()` (Line 637-681)

**Current Sequence**:
1. Set `isLaunching = true`
2. Set status color to yellow  
3. Log "DUAL DRONE MISSION STARTING"
4. **Immediately call** `startVTOLMission()` ❌ **NO SAFETY CHECKS**
5. VTOL Mission starts (regardless of hardware state)

**VTOL Mission Sub-Sequence** (`startVTOLMission`, Line 425-466):
1. Send `PING` to VTOL (no ACK wait) - Line 430
2. Wait 1 second
3. Send `ARM` command - Line 436
4. Wait 3 seconds (assumes arming succeeded)
5. **Force set** `vtolArmed = true` in store - Line 438 ❌
6. Send `TAKEOFF:10` - Line 445
7. Wait 8 seconds
8. **Force set** `vtolFlying = true` - Line 447 ❌
9. Send `SCOUT` - Line 454
10. Send `MODE:AUTO` - Line 461
11. Return success

**Problems**:
- ✅ Uses simple `sendCommand` (Line 401) - doesn't wait for ACK
- ❌ **Blindly assumes commands succeed** without verification
- ❌ **Force-updates telemetry store** with fake "armed" and "flying" states
- ❌ No hardware connection check
- ❌ No actual telemetry validation

---

### 🛑 **ABORT VTOL** Button
**Location**: Line 1127-1131  
**Handler**: `handleAbortVTOL()` (Line 685-761)

**Sequence**:
1. Set abort status, save mission state
2. Send `ABORT` command
3. Wait 500ms
4. Send `LAND` command
5. Wait 8 seconds
6. Send `DISARM` command
7. Send `STATUS` to verify
8. Wait for confirmation via log messages

---

### 🛑 **ABORT DRONE** Button  
**Location**: Line 1134-1138  
**Handler**: `handleAbortDelivery()` (Line 765-846)

**Sequence**: (Same as VTOL abort, but for delivery drone)

---

### 🛑 **ABORT ALL** Button
**Location**: Line 1141-1145  
**Handler**: `handleAbortMission()` (Line 850-941)

**Sequence**:
1. Send `ABORT` to both drones
2. Send `LAND` to both
3. Wait 10 seconds
4. Send `DISARM` to both
5. Send `STATUS` to both
6. Wait for confirmation

---

### 🔄 **RESUME MISSION** Button
**Location**: Line 1149-1156  
**Handler**: `handleResumeMission()` (Line 945-1042)  
**Visibility**: Only shows when `isAborted && (abortConfirmed.vtol || abortConfirmed.drone) && savedMissionStateRef.current`

**Sequence**:
1. Check for saved mission state
2. If VTOL was flying: Re-arm → Takeoff:20 → MODE:AUTO
3. If Delivery was delivering: Re-arm → Takeoff:10 → Continue waypoints
4. Clear saved state

---

## Delivery Drone Auto-Trigger Logic

**Trigger Condition** (Line 613-633):
```typescript
useEffect(() => {
  if (waypointQueue has pending items && vtolState === "returning") {
    startDeliverySequence()
  }
}, [vtolState, waypointQueue])
```

**Delivery Sequence** (`startDeliverySequence`, Line 470-609):
1. PING with retry (waits for ACK) ✅
2. ARM with retry (waits for ACK) ✅
3. TAKEOFF:15 with retry ✅
4. For each waypoint:
   - Send `GOTO:lat,lon,15`
   - Wait for ACK
   - Send `DELIVER:lat,lon`
   - Wait for ACK
   - Mark completed
5. Send `RTL` when all complete

**Good**: Uses `sendCommandWithRetry` which waits for ACKs ✅

---

## Critical Findings

### ❌ Major Safety Issues
1. **No hardware connection checks** before mission start
2. **Force-updates telemetry** with fake armed/flying states
3. **No real ACK validation** in VTOL sequence (uses sendCommand, not sendCommandWithRetry)
4. **Assumes success** without verifying drone responses

### ⚠️ Design Inconsistencies
- VTOL mission uses `sendCommand` (fire-and-forget)
- Delivery mission uses `sendCommandWithRetry` (waits for ACK)
- Should both use retry logic!

### 📊 Telemetry Store Issues
The store (Line 90-172, `telemetryStore.ts`) **does NOT include**:
- `vtolHardwareConnected` state
- `droneHardwareConnected` state  
- `vtolLastTelemetryTime` state
- `droneLastTelemetryTime` state

These are **dynamically added** via `setState()` but not defined in the type! This is TypeScript unsafe.

---

## Required Fixes

### 1. Add Pre-Flight Safety Checks
```typescript
const handleStartLaunch = async () => {
  // ✅ CHECK HARDWARE CONNECTIONS
  if (!vtolHardwareConnected) {
    addLog({ ... message: "❌ VTOL NOT CONNECTED" })
    return
  }
  
  if (!droneHardwareConnected) {
    addLog({ ... message: "❌ Delivery Drone NOT CONNECTED" })
    return
  }
  
  // ✅ CHECK BATTERY LEVELS
  if (batteryPercent < 30) {
    addLog({ ... message: "⚠️ LOW BATTERY - Unsafe to fly" })
    return
  }
  
  // Now proceed...
}
```

### 2. Fix VTOL Mission to Use Retry Logic
Replace all `sendCommand` with `sendCommandWithRetry` in `startVTOLMission()`

### 3. Remove Force-Setting Armed/Flying States
Don't fake telemetry! Wait for real data from drones.

### 4. Fix TypeScript Types
Add hardware connection fields to `TelemetryState` interface

---

## Expected Sequence (SHOULD BE)

### START MISSION (Corrected)
1. ✅ **Verify VTOL hardware connected**
2. ✅ **Verify Delivery hardware connected**  
3. ✅ **Check battery levels** (both >30%)
4. ✅ **Check GPS lock** (both have valid coordinates)
5. ✅ Send PING to VTOL → **Wait for PONG**
6. ✅ Send ARM to VTOL → **Wait for ARMED**
7. ✅ Send TAKEOFF:10 → **Wait for ACK + altitude telemetry**
8. ✅ Send SCOUT → **Wait for ACK**
9. ✅ Send MODE:AUTO → **Wait for ACK**
10. ✅ Monitor for detections
11. ✅ When VTOL returns → Auto-start Delivery sequence

---

**Status**: Analysis Complete - Fixes Required  
**Next Step**: Implement safety checks and retry logic for VTOL mission
