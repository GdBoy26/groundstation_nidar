#!/usr/bin/env python3
"""
Delivery Drone Command Sender via LoRa/3DR Radio

Send commands to DELIVERY drone from laptop via 3DR radio.
This script runs on the REMOTE laptop (ground station) for the DELIVERY DRONE.

Commands:
    ARM           - Arm the drone
    DISARM        - Disarm the drone
    TAKEOFF:5     - Takeoff to 5 meters
    LAND          - Land the drone
    RTL           - Return to launch
    GOTO:lat,lon,alt - Go to GPS location (waypoint delivery)
    STATUS        - Get drone status
    ABORT         - Emergency abort
    PING          - Test connection
    
This is the DELIVERY DRONE server - runs on port 8766
For VTOL scouting, use tx.py on port 8765
    
Usage:
    python3 tx_delivery.py
    python3 tx_delivery.py --port COM4      # Windows
    python3 tx_delivery.py --port /dev/ttyUSB1  # Linux
    python3 tx_delivery.py --demo           # Demo mode without hardware
"""

import sys
import time
import argparse
import serial
import threading
import json
import asyncio
import websockets
from datetime import datetime
from serial.tools import list_ports


def auto_detect_port(baud, exclude_ports=None):
    """Auto-detect the serial port with the radio, excluding already used ports."""
    if exclude_ports is None:
        exclude_ports = []
        
    print("[INFO] Auto-detecting serial port for DELIVERY drone...")
    ports = list_ports.comports()
    
    if not ports:
        print("[ERROR] No serial ports found")
        return None
    
    # Filter out excluded ports
    available_ports = [p for p in ports if p.device not in exclude_ports]
    
    print(f"[INFO] Found {len(available_ports)} available serial port(s):")
    for port in available_ports:
        print(f"  - {port.device}: {port.description}")
    
    # Try each port
    for port in available_ports:
        try:
            print(f"[INFO] Trying {port.device}...", end='', flush=True)
            ser = serial.Serial(port=port.device, baudrate=baud, timeout=0.2)
            time.sleep(0.1)
            
            ser.reset_input_buffer()
            ser.reset_output_buffer()
            
            ser.write(b"PING\n")
            
            start = time.time()
            while time.time() - start < 0.5:
                if ser.in_waiting > 0:
                    response = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
                    if "PONG" in response or "OK" in response:
                        print(f" ✓ Found!")
                        print(f"[OK] Using {port.device} for DELIVERY drone")
                        ser.close()
                        return port.device
                    break
                time.sleep(0.05)
            
            print(" ✗")
            ser.close()
        except Exception as e:
            print(f" ✗ (Error: {str(e)[:30]})")
            continue
    
    print("[WARN] Could not detect radio, using first available port")
    return available_ports[0].device if available_ports else None


class DeliveryDroneCommandSender:
    """Sends commands to DELIVERY drone via LoRa/3DR radio."""
    
    def __init__(self, port, baud):
        self.port = port
        self.baud = baud
        self.serial = None
        self.running = False
        self.receive_thread = None
        self.websocket_clients = set()
        self.websocket_thread = None
        self.demo_mode = False
        self.websocket_loop = None
        self.drone_id = "DELIVERY"
        self.hardware_connected = False  # True only when receiving valid data from real hardware
        self.last_telemetry_time = 0  # Timestamp of last received telemetry
        
        # Delivery mission state
        self.is_armed = False
        self.is_flying = False
        self.current_waypoint = None
        self.waypoint_queue = []
        
    def connect(self):
        """Connect to 3DR radio."""
        print(f"[INFO] Connecting DELIVERY drone to radio on {self.port} @ {self.baud}...")
        try:
            self.serial = serial.Serial(
                port=self.port,
                baudrate=self.baud,
                timeout=0.1
            )
            print(f"[OK] DELIVERY drone connected to radio")
            self.hardware_connected = False  # Not confirmed until we receive valid telemetry
            self._broadcast_hardware_status(False)
            return True
        except Exception as e:
            print(f"[ERROR] Failed to connect DELIVERY drone to serial port {self.port}: {e}")
            print(f"[ERROR] Check that the 3DR radio is connected and the COM port is correct.")
            print(f"[HINT] You can specify a different port with --port COMxx")
            self.hardware_connected = False
            self._broadcast_hardware_status(False)
            return False
    
    def _broadcast_hardware_status(self, connected: bool):
        """Broadcast hardware connection status to frontend."""
        self.hardware_connected = connected
        status_message = {
            "action": "status",
            "data": {
                "hardwareConnected": connected,
                "port": self.port if connected else None,
                "timestamp": datetime.now().isoformat()
            }
        }
        
        if not hasattr(self, 'websocket_loop') or self.websocket_loop is None:
            return
            
        for client in list(self.websocket_clients):
            try:
                asyncio.run_coroutine_threadsafe(
                    client.send(json.dumps(status_message)),
                    self.websocket_loop
                )
            except Exception as e:
                self.websocket_clients.discard(client)
    
    def receive_responses(self):
        """Background thread to receive responses from drone."""
        buffer = ""
        consecutive_errors = 0
        max_consecutive_errors = 10
        
        while self.running:
            try:
                if self.serial and self.serial.is_open and self.serial.in_waiting > 0:
                    chunk = self.serial.read(self.serial.in_waiting).decode('utf-8', errors='ignore')
                    buffer += chunk
                    consecutive_errors = 0  # Reset error counter on successful read
                    
                    while '\n' in buffer:
                        line, buffer = buffer.split('\n', 1)
                        data = line.strip()
                        if data:
                            # Valid data received from hardware!
                            self.last_telemetry_time = time.time()
                            if not self.hardware_connected:
                                self.hardware_connected = True
                                self._broadcast_hardware_status(True)
                                print(f"[OK] ✅ HARDWARE CONNECTED - Receiving real telemetry from {self.port}")
                            self._display_response(data)
            except PermissionError as e:
                consecutive_errors += 1
                if consecutive_errors >= max_consecutive_errors:
                    print(f"\n[ERROR] ❌ COM port access denied - Port may be in use by another application")
                    print(f"[HINT] Close any other applications using {self.port} (Mission Planner, etc.)")
                    if self.hardware_connected:
                        self.hardware_connected = False
                        self._broadcast_hardware_status(False)
                    time.sleep(2)
                    consecutive_errors = 0
            except serial.SerialException as e:
                consecutive_errors += 1
                if consecutive_errors >= max_consecutive_errors:
                    print(f"\n[ERROR] ❌ Serial port error: {e}")
                    if self.hardware_connected:
                        self.hardware_connected = False
                        self._broadcast_hardware_status(False)
                    time.sleep(2)
                    consecutive_errors = 0
            except Exception as e:
                consecutive_errors += 1
                if consecutive_errors >= max_consecutive_errors:
                    print(f"[RX_ERROR] {e}")
                    if self.hardware_connected:
                        self.hardware_connected = False
                        self._broadcast_hardware_status(False)
                        print(f"[WARN] ❌ Hardware disconnected - Serial error")
                    consecutive_errors = 0
            time.sleep(0.02)
    
    def _display_response(self, data):
        """Format and display received response."""
        source = "DELIVERY"
        level = "INFO"
        
        if "[ERROR]" in data or "[CRIT]" in data or "[EMERG]" in data:
            level = "ERROR"
        elif "[WARN]" in data:
            level = "WARN"
        
        # Parse telemetry
        self._parse_and_broadcast_telemetry(data)
        
        # Broadcast log
        self._broadcast_log(message=data, source=source, level=level)
        
        # Console output
        if "PONG" in data:
            print(f"\n  ✅ \033[92m[DELIVERY] {data}\033[0m")
        elif "ARMED" in data:
            self.is_armed = True
            print(f"\n  ✅ \033[92m[DELIVERY] {data}\033[0m")
        elif "DISARMED" in data:
            self.is_armed = False
            print(f"\n  ✅ \033[93m[DELIVERY] {data}\033[0m")
        elif "TAKEOFF" in data or "AIRBORNE" in data or "FLYING" in data:
            self.is_flying = True
            print(f"\n  🚀 \033[96m[DELIVERY] {data}\033[0m")
        elif "LANDED" in data or "LANDING" in data:
            self.is_flying = False
            print(f"\n  🛬 \033[93m[DELIVERY] {data}\033[0m")
        elif "GOTO" in data or "NAVIGATING" in data:
            print(f"\n  📍 \033[94m[DELIVERY] {data}\033[0m")
        elif "DELIVERED" in data or "ARRIVED" in data:
            print(f"\n  ✅ \033[92m[DELIVERY] {data}\033[0m")
        elif "ERROR" in data:
            print(f"\n  ❌ \033[91m[DELIVERY] {data}\033[0m")
        else:
            print(f"\n  >> [DELIVERY] {data}")
        print("DELIVERY_CMD> ", end='', flush=True)
    
    def _broadcast_log(self, message: str, source: str = "DELIVERY", level: str = "INFO"):
        """Broadcast log to all connected WebSocket clients."""
        log_entry = {
            "action": "log",
            "data": {
                "time": datetime.now().strftime("%H:%M:%S"),
                "source": source,
                "level": level,
                "message": message
            }
        }
        
        if not hasattr(self, 'websocket_loop') or self.websocket_loop is None:
            return
            
        for client in list(self.websocket_clients):
            try:
                asyncio.run_coroutine_threadsafe(
                    client.send(json.dumps(log_entry)),
                    self.websocket_loop
                )
            except Exception as e:
                self.websocket_clients.discard(client)
    
    def _parse_and_broadcast_telemetry(self, data: str):
        """Parse telemetry data and broadcast to WebSocket clients."""
        try:
            telemetry_update = {}
            
            if "ARMED" in data and "DISARMED" not in data:
                telemetry_update["droneArmed"] = True
            elif "DISARMED" in data:
                telemetry_update["droneArmed"] = False
            
            if "FLYING" in data or "AIRBORNE" in data:
                telemetry_update["droneFlying"] = True
            elif "LANDED" in data:
                telemetry_update["droneFlying"] = False
            
            if "SPEED:" in data:
                try:
                    speed_str = data.split("SPEED:")[1].split()[0].rstrip(",")
                    telemetry_update["speed"] = float(speed_str)
                except:
                    pass
            
            if "HEADING:" in data:
                try:
                    heading_str = data.split("HEADING:")[1].split()[0].rstrip(",")
                    telemetry_update["heading"] = float(heading_str)
                except:
                    pass
            
            if "ALT:" in data:
                try:
                    alt_str = data.split("ALT:")[1].split()[0].rstrip(",")
                    alt_val = float(alt_str)
                    telemetry_update["droneGps"] = {
                        "lat": telemetry_update.get("droneGps", {}).get("lat", 28.545),
                        "lon": telemetry_update.get("droneGps", {}).get("lon", 77.192),
                        "alt": alt_val
                    }
                except:
                    pass
            
            if "GPS:" in data:
                try:
                    gps_str = data.split("GPS:")[1].split()[0]
                    parts = gps_str.split(",")
                    if len(parts) >= 3:
                        telemetry_update["droneGps"] = {
                            "lat": float(parts[0]),
                            "lon": float(parts[1]),
                            "alt": float(parts[2])
                        }
                except:
                    pass
            
            if telemetry_update:
                telemetry_message = {
                    "action": "telemetry",
                    "data": telemetry_update
                }
                
                for client in list(self.websocket_clients):
                    try:
                        asyncio.run_coroutine_threadsafe(
                            client.send(json.dumps(telemetry_message)),
                            self.websocket_loop
                        )
                    except Exception:
                        self.websocket_clients.discard(client)
        except Exception:
            pass
    
    async def websocket_handler(self, websocket):
        """Handle WebSocket connections."""
        self.websocket_clients.add(websocket)
        print(f"[WS] DELIVERY client connected. Total clients: {len(self.websocket_clients)}")
        
        try:
            async for message in websocket:
                try:
                    cmd = message.strip()
                    if cmd and cmd.upper() not in ["", "NULL"]:
                        print(f"[WS_CMD] DELIVERY received command: {cmd}")
                        self.send_command(cmd)
                except Exception as e:
                    print(f"[WS_CMD_ERROR] Failed to process command: {e}")
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.websocket_clients.discard(websocket)
            print(f"[WS] DELIVERY client disconnected. Total clients: {len(self.websocket_clients)}")
    
    def start_websocket_server(self, host="0.0.0.0", port=8766):
        """Start WebSocket server on port 8766 for delivery drone."""
        def run_server():
            self.websocket_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self.websocket_loop)
            
            async def start_and_serve():
                async with websockets.serve(self.websocket_handler, host, port):
                    print(f"[WS] DELIVERY WebSocket server started on ws://{host}:{port}")
                    await asyncio.Event().wait()
            
            self.websocket_loop.run_until_complete(start_and_serve())
        
        self.websocket_thread = threading.Thread(target=run_server, daemon=True)
        self.websocket_thread.start()
    
    def send_command(self, cmd):
        """Send a command to the delivery drone."""
        try:
            cmd = cmd.strip()
            if not cmd:
                return
            
            if self.demo_mode:
                print(f"[DEMO_TX] DELIVERY Sent: {cmd}")
                self._simulate_demo_response(cmd)
            else:
                self.serial.write(f"{cmd}\n".encode())
                print(f"[TX] DELIVERY Sent: {cmd}")
            
            self._broadcast_log(message=f"TX: {cmd}", source="GROUND", level="INFO")
            
        except Exception as e:
            print(f"[ERROR] Failed to send to DELIVERY: {e}")
            self._broadcast_log(message=f"ERROR: Failed to send '{cmd}': {e}", source="GROUND", level="ERROR")
    
    def _simulate_demo_response(self, cmd):
        """Simulate drone response in demo mode."""
        cmd_upper = cmd.upper().strip()
        
        async def send_response(response, delay=0.5):
            await asyncio.sleep(delay)
            self._display_response(response)
        
        if self.websocket_loop:
            if cmd_upper == "PING":
                asyncio.run_coroutine_threadsafe(send_response("PONG"), self.websocket_loop)
            elif cmd_upper == "ARM":
                asyncio.run_coroutine_threadsafe(send_response("ARMED OK - DELIVERY drone ready"), self.websocket_loop)
            elif cmd_upper.startswith("TAKEOFF"):
                asyncio.run_coroutine_threadsafe(send_response("TAKEOFF - DELIVERY ascending"), self.websocket_loop)
                asyncio.run_coroutine_threadsafe(send_response("AIRBORNE - DELIVERY flying"), self.websocket_loop)
            elif cmd_upper.startswith("GOTO"):
                asyncio.run_coroutine_threadsafe(send_response("GOTO OK - DELIVERY navigating to waypoint"), self.websocket_loop)
            elif cmd_upper == "LAND":
                asyncio.run_coroutine_threadsafe(send_response("LANDING - DELIVERY descending"), self.websocket_loop)
            elif cmd_upper == "RTL":
                asyncio.run_coroutine_threadsafe(send_response("RTL - DELIVERY returning to launch"), self.websocket_loop)
    
    def run_interactive(self):
        """Run interactive command mode."""
        print("\n" + "=" * 50)
        print("  DELIVERY DRONE - Ground Station")
        print("  WebSocket Server: ws://0.0.0.0:8766")
        print("=" * 50)
        
        self.start_websocket_server(host="0.0.0.0", port=8766)
        
        print("\nDelivery Drone Commands:")
        print("  PING         - Test connection")
        print("  ARM          - Arm motors")
        print("  TAKEOFF:10   - Takeoff to 10m")
        print("  GOTO:lat,lon,alt - Go to waypoint")
        print("  LAND         - Land immediately")
        print("  RTL          - Return to launch")
        print("  QUIT         - Exit")
        print("-" * 50)
        
        self.running = True
        
        if not self.demo_mode:
            self.receive_thread = threading.Thread(target=self.receive_responses, daemon=True)
            self.receive_thread.start()
        
        try:
            while self.running:
                try:
                    cmd = input("DELIVERY_CMD> ").strip().upper()
                    
                    if cmd == "QUIT" or cmd == "EXIT" or cmd == "Q":
                        print("Exiting DELIVERY drone controller...")
                        break
                    
                    if cmd:
                        self.send_command(cmd)
                        time.sleep(0.1)
                        
                except EOFError:
                    break
                    
        except KeyboardInterrupt:
            print("\n[INFO] DELIVERY controller interrupted")
        
        self.running = False
        if self.serial:
            self.serial.close()
        print("[INFO] DELIVERY drone disconnected")


def main():
    parser = argparse.ArgumentParser(description='DELIVERY Drone Command Sender via LoRa/3DR Radio')
    parser.add_argument('--port', default='COM22',
                       help='Serial port (default: COM22 for delivery quadcopter)')
    parser.add_argument('--baud', type=int, default=57600,
                       help='Baud rate (default: 57600)')
    parser.add_argument('--demo', action='store_true',
                       help='Run in demo mode without serial connection')
    parser.add_argument('--exclude-port', default=None,
                       help='Port to exclude (already used by VTOL)')
    args = parser.parse_args()
    
    if args.demo:
        print("[INFO] DELIVERY drone running in DEMO mode")
        sender = DeliveryDroneCommandSender(port="DEMO", baud=args.baud)
        sender.demo_mode = True
        sender.run_interactive()
        return
    
    # Use specified port directly
    port = args.port
    
    print(f"[INFO] DELIVERY drone using serial port: {port}")
    
    if not port:
        print("[ERROR] Could not find serial port for DELIVERY drone")
        sys.exit(1)
    
    sender = DeliveryDroneCommandSender(port=port, baud=args.baud)
    
    if not sender.connect():
        print(f"[ERROR] Failed to connect to {port}")
        print("[TIP] Check that:")
        print("  1. The 3DR radio is connected and powered")
        print("  2. No other program is using the port")
        print("  3. The correct COM port is specified (--port COM22)")
        sys.exit(1)
    
    sender.run_interactive()


if __name__ == "__main__":
    main()
