import serial
import time

print("Testing COM17 for incoming data...")
print("If your drone is ON, you should see data within 2 seconds.")
print("-" * 60)

try:
    ser = serial.Serial('COM17', 57600, timeout=1)
    print("✅ COM17 opened successfully")
    print("Listening for 10 seconds...\n")
    
    start = time.time()
    data_count = 0
    
    while time.time() - start < 10:
        if ser.in_waiting > 0:
            data = ser.read(ser.in_waiting)
            data_count += len(data)
            print(f"📡 Received {len(data)} bytes: {data[:20].hex()}...")
    
    print("\n" + "-" * 60)
    if data_count > 0:
        print(f"✅ SUCCESS! Received {data_count} total bytes")
        print("✅ Your drone IS powered on and transmitting!")
        print("✅ The radio link IS working!")
    else:
        print("❌ NO DATA RECEIVED")
        print("Check:")
        print("  1. Is drone powered ON?")
        print("  2. Is air-side radio connected to drone's telemetry port?")
        print("  3. Is air-side radio getting power from drone?")
    
    ser.close()
    
except Exception as e:
    print(f"❌ Error: {e}")
