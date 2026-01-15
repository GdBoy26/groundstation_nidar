#!/usr/bin/env python3
"""
NIDAR Radio Connection Diagnostic Tool

Tests your 3DR radio connection to verify hardware is working.
"""

import serial
import time
from serial.tools import list_ports

def list_available_ports():
    """List all available COM ports."""
    print("\n" + "="*60)
    print("  Available COM Ports")
    print("="*60)
    ports = list(list_ports.comports())
    if not ports:
        print("  ❌ No COM ports found!")
        return []
    
    for i, port in enumerate(ports, 1):
        print(f"  {i}. {port.device} - {port.description}")
    print("="*60 + "\n")
    return ports

def test_radio_connection(port, baud=57600):
    """Test if we can communicate with the radio."""
    print(f"\n[TEST] Opening {port} at {baud} baud...")
    
    try:
        ser = serial.Serial(port, baud, timeout=2)
        print(f"[TEST] ✅ Port opened successfully")
        
        print(f"[TEST] Listening for incoming data for 5 seconds...")
        print(f"[TEST] (If drone is powered on, you should see MAVLink data)")
        print("-" * 60)
        
        start_time = time.time()
        received_anything = False
        
        while time.time() - start_time < 5:
            if ser.in_waiting > 0:
                data = ser.read(ser.in_waiting)
                received_anything = True
                # Show first 50 bytes as hex
                hex_str = ' '.join(f'{b:02X}' for b in data[:50])
                print(f"[RX] {hex_str}")
                
        print("-" * 60)
        
        if received_anything:
            print("[TEST] ✅ SUCCESS! Radio is receiving data from drone")
            print("[TEST] Your drone is powered on and radios are paired!")
        else:
            print("[TEST] ❌ No data received")
            print("[TEST] Possible issues:")
            print("  1. Drone is powered off")
            print("  2. Air-side radio not connected to drone")
            print("  3. Radios not paired (check NET ID)")
            print("  4. Wrong baud rate")
        
        # Try sending PING
        print(f"\n[TEST] Sending test command: PING")
        ser.write(b"PING\n")
        time.sleep(1)
        
        if ser.in_waiting > 0:
            response = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
            print(f"[RX] Response: {response}")
        else:
            print(f"[RX] No response to PING")
            print(f"[INFO] This is normal if using MAVLink protocol")
        
        ser.close()
        print(f"\n[TEST] Test complete!")
        
    except serial.SerialException as e:
        print(f"[TEST] ❌ Failed to open port: {e}")
        return False
    except Exception as e:
        print(f"[TEST] ❌ Error: {e}")
        return False
    
    return True

def main():
    print("\n" + "="*60)
    print("  NIDAR Radio Connection Diagnostic Tool")
    print("="*60)
    
    # List ports
    ports = list_available_ports()
    if not ports:
        return
    
    # Ask user to select port
    try:
        choice = input("Select port number to test (or 'q' to quit): ").strip()
        if choice.lower() == 'q':
            return
            
        port_index = int(choice) - 1
        if port_index < 0 or port_index >= len(ports):
            print("Invalid selection!")
            return
            
        selected_port = ports[port_index].device
        
        # Ask for baud rate
        baud_input = input(f"Enter baud rate (default: 57600): ").strip()
        baud = int(baud_input) if baud_input else 57600
        
        # Run test
        test_radio_connection(selected_port, baud)
        
    except ValueError:
        print("Invalid input!")
    except KeyboardInterrupt:
        print("\n\nTest cancelled by user")

if __name__ == "__main__":
    main()
