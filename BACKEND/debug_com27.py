import serial
import time
import binascii

PORT = "COM27"
BAUD = 57600

print(f"\n========================================")
print(f"  DEEP DEBUG: {PORT} @ {BAUD}")
print(f"========================================")
print("1. Please ensure ALL other terminals using this port are CLOSED.")
print("2. Trying to open port...")

try:
    ser = serial.Serial(PORT, BAUD, timeout=1)
    print(f"✅ Success! Port opened.")
    
    print("\nListening for raw data (10 seconds)...")
    print("-" * 40)
    
    start_time = time.time()
    total_bytes = 0
    
    while time.time() - start_time < 10:
        if ser.in_waiting > 0:
            raw_chunk = ser.read(ser.in_waiting)
            total_bytes += len(raw_chunk)
            
            # Print analysis of this chunk
            hex_data = binascii.hexlify(raw_chunk).decode('ascii')
            
            # Try to see if it looks like MAVLink (starts with FE or FD)
            is_mav = False
            if raw_chunk.startswith(b'\xfe') or raw_chunk.startswith(b'\xfd'):
                is_mav = True
                
            # Try to decode as text
            text_rep = ""
            try:
                text_rep = raw_chunk.decode('utf-8', errors='ignore').strip()
            except:
                pass
                
            print(f"\n📦 Received {len(raw_chunk)} bytes")
            if is_mav:
                print(f"   🚩 LOOKS LIKE MAVLINK PACKET! (Starts with {hex_data[:2]})")
            
            if text_rep and len(text_rep) > 1:
                print(f"   📝 Text Content: {text_rep}")
            else:
                print(f"   🔢 HEX: {hex_data[:60]}...")
            
        time.sleep(0.1)
        
    print("-" * 40)
    if total_bytes == 0:
        print("❌ TIMEOUT: No data received in 10 seconds.")
        print("   - Check TX/RX wiring")
        print("   - Check drone power")
        print("   - Try swapping TX/RX on the radio")
    else:
        print(f"✅ DATA FLOW CONFIRMED: Received {total_bytes} bytes total.")
        print("   If you see 'HEX' but no 'Text Content', the drone is sending binary MAVLink.")
        print("   Our backend expects TEXT. We may need to switch to MAVLink backend.")

    ser.close()

except serial.SerialException as e:
    print(f"\n❌ ERROR: Could not open {PORT}")
    print(f"   Reason: {e}")
    print("   👉 TIP: Close all other terminal windows and try again!")

except Exception as e:
    print(f"\n❌ UNEXPECTED ERROR: {e}")
