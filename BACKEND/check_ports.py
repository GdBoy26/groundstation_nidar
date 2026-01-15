#!/usr/bin/env python3
"""
Diagnostic tool to check available COM ports and test drone connections
"""

import serial.tools.list_ports
import serial
import time

def list_available_ports():
    """List all available COM ports"""
    print("\n" + "="*60)
    print("  AVAILABLE COM PORTS")
    print("="*60)
    
    ports = serial.tools.list_ports.comports()
    
    if not ports:
        print("❌ No COM ports found!")
        return []
    
    available_ports = []
    for port in ports:
        print(f"\n📍 Port: {port.device}")
        print(f"   Description: {port.description}")
        print(f"   Hardware ID: {port.hwid}")
        available_ports.append(port.device)
    
    print("\n" + "="*60)
    return available_ports

def test_port(port, baud_rates=[9600, 57600, 115200]):
    """Test a COM port at different baud rates"""
    print(f"\n🔍 Testing {port}...")
    print("-" * 60)
    
    for baud in baud_rates:
        print(f"\n  Trying {port} @ {baud} baud...", end=" ")
        try:
            ser = serial.Serial(
                port=port,
                baudrate=baud,
                timeout=2
            )
            
            # Wait a moment for connection
            time.sleep(0.5)
            
            # Check if there's any data
            if ser.in_waiting > 0:
                data = ser.read(ser.in_waiting)
                print(f"✅ CONNECTED! Receiving data ({len(data)} bytes)")
                print(f"     First 50 bytes: {data[:50]}")
                
                # Try to decode
                try:
                    decoded = data.decode('utf-8', errors='ignore')
                    if decoded.strip():
                        print(f"     Decoded: {decoded[:100]}")
                except:
                    print(f"     (Binary data - likely MAVLink)")
                
                ser.close()
                return baud
            else:
                # Send a PING to test
                ser.write(b"PING\n")
                time.sleep(0.5)
                
                if ser.in_waiting > 0:
                    response = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
                    print(f"✅ CONNECTED! Response: {response.strip()}")
                    ser.close()
                    return baud
                else:
                    print("⚠️  Connected but no data")
            
            ser.close()
            
        except serial.SerialException as e:
            print(f"❌ Failed: {e}")
        except Exception as e:
            print(f"❌ Error: {e}")
    
    print(f"\n  ⚠️  No successful connection at any baud rate")
    return None

def main():
    print("\n" + "="*60)
    print("  NIDAR DRONE CONNECTION DIAGNOSTIC")
    print("="*60)
    
    # List all ports
    ports = list_available_ports()
    
    if not ports:
        print("\n❌ No COM ports detected!")
        print("\nTroubleshooting:")
        print("  1. Check if 3DR radios are plugged in via USB")
        print("  2. Check Device Manager for COM port assignments")
        print("  3. Try unplugging and re-plugging the radios")
        return
    
    # Test each port
    print("\n" + "="*60)
    print("  TESTING CONNECTIONS")
    print("="*60)
    
    results = {}
    for port in ports:
        baud = test_port(port)
        results[port] = baud
    
    # Summary
    print("\n" + "="*60)
    print("  SUMMARY")
    print("="*60)
    
    for port, baud in results.items():
        if baud:
            print(f"✅ {port} - Working at {baud} baud")
        else:
            print(f"❌ {port} - Not responding")
    
    print("\n" + "="*60)
    print("  RECOMMENDATIONS")
    print("="*60)
    
    # Give recommendations based on config
    print("\nCurrent configuration (radio_config.json):")
    print("  VTOL:     COM17 @ 57600 baud")
    print("  Delivery: COM27 @ 115200 baud")
    print("\nIf ports or baud rates don't match, update:")
    print("  BACKEND/config/radio_config.json")
    print("  BACKEND/vtol_backend.py (line ~215)")
    print("  BACKEND/delivery_backend.py (line ~215)")
    
    print("\n" + "="*60)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n⚠️  Diagnostic interrupted by user")
    except Exception as e:
        print(f"\n❌ Diagnostic failed: {e}")
    
    print("\nPress Enter to exit...")
    input()
