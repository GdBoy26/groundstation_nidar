# COM Port Configuration - REVERSED

## Current Configuration (SWAPPED)

| Drone Type | COM Port | Baud Rate | WebSocket Port |
|------------|----------|-----------|----------------|
| VTOL Scout | COM22    | 57600     | 8765           |
| Delivery   | COM17    | 57600     | 8766           |

## Update History

### Latest Change (2026-01-16 07:37)
**Ports SWAPPED at user request:**
- VTOL: COM17 → **COM22**
- Delivery: COM22 → **COM17**

### Initial Fix (2026-01-16 07:31)
**Fixed non-existent COM27:**
- Delivery: COM27 → COM22
- VTOL: Remained on COM17

## Files Updated

### Python Backend Files
1. **`vtol_backend.py`** - Now uses COM22
2. **`delivery_backend.py`** - Now uses COM17

### Batch Launcher Files
3. **`start_all.bat`** - Updated all references
4. **`start_backends.bat`** - Updated all references

## Next Steps
1. **Close all backend terminal windows** (if running)
2. **Restart the system**: Run `.\start_all.bat`
3. **Verify connections**:
   - `[VTOL] ✅ Connected to COM22`
   - `[DELIVERY] ✅ Connected to COM17`

## Troubleshooting
If you need to check which physical devices are on which ports:
```powershell
python -c "import serial.tools.list_ports; [print(f'{p.device}: {p.description}') for p in serial.tools.list_ports.comports()]"
```

---
**Status**: ✅ Ports Swapped  
**Last Updated**: 2026-01-16 07:37  
**Current Config**: VTOL=COM22, Delivery=COM17
