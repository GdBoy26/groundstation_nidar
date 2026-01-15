#!/usr/bin/env python3
"""
Quick test to see raw data from COM27 (Delivery Drone)
"""
import serial
import time

print("Testing COM27 for delivery drone data...")
print("Listening for 15 seconds...\n")

try:
    ser = serial.Serial('COM27', 57600, timeout=1)
    print("✅ COM27 opened")
    print("-" * 60)
    
    start = time.time()
    byte_count = 0
    
    while time.time() - start < 15:
        if ser.in_waiting > 0:
            data = ser.read(ser.in_waiting)
            byte_count += len(data)
            
            # Try to decode as text
            try:
                text = data.decode('utf-8', errors='replace')
                if text.strip():
                    print(f"[TEXT] {text}")
            except:
                pass
            
            # Show as hex (binary MAVLink data)
            hex_str = data[:50].hex()
            print(f"[HEX] {hex_str}")
    
    print("\n" + "-" * 60)
    print(f"Total bytes received: {byte_count}")
    
    if byte_count > 0:
        print("✅ Delivery drone IS sending data!")
        print("   It might be binary MAVLink format")
    else:
        print("❌ NO data received")
        print("   Check:")
        print("   - Is delivery drone powered ON?")
        print("   - Is air-side radio connected to TELEM port?")
        print("   - Are radios paired (green LEDs)?")
    
    ser.close()
    
except Exception as e:
    print(f"❌ Error: {e}")
