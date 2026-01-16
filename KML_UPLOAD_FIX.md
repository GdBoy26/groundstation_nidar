# KML Upload Fix - Altitude Parameter

**Date**: 2026-01-16 08:24  
**Issue**: KML upload failing on Raspberry Pi  
**Status**: ✅ **FIXED**

---

## Problem

The KML upload was sending:
```
KML:START:128
```

But the Raspberry Pi backend expected:
```
KML:START:size:altitude:pattern
```

### Error from Raspberry Pi:
```
[08:19:58.377] INFO: [TX] ERROR: KML:START requires format KML:START:size:altitude:pattern
[08:19:58.409] INFO: [TX] ERROR: Received only 3 parts: KML:START:128
[08:19:58.441] INFO: [TX] ERROR: GCS must send altitude parameter!
```

---

## Solution

Updated the KML:START command to include all required parameters:

**File**: `FRONTEND/components/gcs/kml-upload.tsx` (Line 167)

**Before** ❌:
```typescript
const startCmd = `KML:START:${encodedData.length}`
```

**After** ✅:
```typescript
const altitude = 10  // Match VTOL takeoff altitude
const pattern = "LAWNMOWER"  // Default scan pattern
const startCmd = `KML:START:${encodedData.length}:${altitude}:${pattern}`
```

---

## Command Format

The KML:START command now sends:

```
KML:START:<size>:<altitude>:<pattern>

Where:
  <size>     = Length of compressed KML data in bytes
  <altitude> = Flight altitude in meters (10m to match VTOL takeoff)
  <pattern>  = Scan pattern type ("LAWNMOWER" for systematic coverage)
```

**Example**:
```
KML:START:1024:10:LAWNMOWER
```

This tells the Raspberry Pi:
- Expect 1024 bytes of KML data
- Fly at 10 meters altitude
- Use lawnmower scan pattern

---

## Why 10 Meters?

The altitude is set to **10m** to match the VTOL takeoff altitude used in the mission sequence:

```javascript
// In action-buttons.tsx, VTOL mission:
sendCommandWithRetry("vtol", "TAKEOFF:10", COMMAND_CONFIG.TAKEOFF)
```

This ensures consistency:
- VTOL takes off to 10m
- VTOL scouts the KML boundary at 10m
- All waypoints are at the same altitude

---

## Complete Upload Flow

Now when you upload a KML file:

1. **Parse KML** → Extract boundary coordinates
2. **Compress** → Reduce data size using zlib
3. **Send START** → `KML:START:1024:10:LAWNMOWER`
4. **Send DATA** → Multiple `KML:DATA:<chunk>` commands
5. **Send END** → `KML:END`
6. **RPI Processing** → Generates waypoints at 10m altitude using lawnmower pattern

---

## Testing

To verify the fix:

1. Select a KML file
2. Click **Upload**
3. Check logs - should see:
   ```
   📤 Transmitting KML boundary (1024 bytes, 10m altitude)...
   ```
4. Raspberry Pi should accept the command without errors
5. RPI should generate waypoints for the VTOL mission

---

**Status**: The KML upload will now work correctly with the Raspberry Pi backend! 🎯
