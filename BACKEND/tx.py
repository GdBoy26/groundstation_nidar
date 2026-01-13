#!/usr/bin/env python3
"""
Drone Command Sender via LoRa/3DR Radio

Send commands to drone from laptop via 3DR radio.
This script runs on the REMOTE laptop (ground station).

Commands:
    ARM           - Arm the drone
    DISARM        - Disarm the drone
    TAKEOFF:5     - Takeoff to 5 meters
    LAND          - Land the drone
    RTL           - Return to launch
    SCOUT         - Start KML area survey mission (human detection)
    KML:SURVEY:file,alt - Custom KML survey (e.g. KML:SURVEY:area.kml,20)
    MODE:STABILIZE - Change to stabilize mode
    MODE:LOITER   - Change to loiter mode
    MODE:GUIDED   - Change to guided mode
    MODE:AUTO     - Start uploaded mission (after SCOUT/KML:SURVEY)
    GOTO:lat,lon,alt - Go to GPS location
    STATUS        - Get drone status
    ABORT         - Emergency abort
    PING          - Test connection
    
For dual-drone operation, use dual_drone_controller.py instead.
    
Usage:
    python3 tx.py
    python3 tx.py --port COM3      # Windows
    python3 tx.py --port /dev/ttyUSB0  # Linux
    python3 tx.py --demo           # Demo mode without hardware
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


def auto_detect_port(baud):
    """Auto-detect the serial port with the radio."""
    print("[INFO] Auto-detecting serial port...")
    ports = list_ports.comports()
    
    if not ports:
        print("[ERROR] No serial ports found")
        return None
    
    print(f"[INFO] Found {len(ports)} serial port(s):")
    for port in ports:
        print(f"  - {port.device}: {port.description}")
    
    # Try each port
    for port in ports:
        try:
            print(f"[INFO] Trying {port.device}...", end='', flush=True)
            ser = serial.Serial(port=port.device, baudrate=baud, timeout=0.2)
            time.sleep(0.1)  # Allow port to initialize
            
            # Clear any existing data
            ser.reset_input_buffer()
            ser.reset_output_buffer()
            
            # Send PING to test connection
            ser.write(b"PING\n")
            
            # Wait for response with timeout
            start = time.time()
            while time.time() - start < 0.5:
                if ser.in_waiting > 0:
                    response = ser.read(ser.in_waiting).decode('utf-8', errors='ignore')
                    if "PONG" in response or "OK" in response:
                        print(f" ✓ Found!")
                        print(f"[OK] Using {port.device}")
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
    return ports[0].device if ports else None


class DroneCommandSender:
    """Sends drone commands via LoRa/3DR radio."""
    
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
        self.drone_id = "DRONE"  # Identifier for this drone connection
        
    def connect(self):
        """Connect to 3DR radio."""
        print(f"[INFO] Connecting to radio on {self.port} @ {self.baud}...")
        try:
            self.serial = serial.Serial(
                port=self.port,
                baudrate=self.baud,
                timeout=0.1
            )
            print(f"[OK] Connected to radio")
            return True
        except Exception as e:
            print(f"[ERROR] Failed to connect: {e}")
            return False
    
    def receive_responses(self):
        """Background thread to receive responses from drone."""
        buffer = ""
        while self.running:
            try:
                if self.serial.in_waiting > 0:
                    # Read all available data
                    chunk = self.serial.read(self.serial.in_waiting).decode('utf-8', errors='ignore')
                    buffer += chunk
                    
                    # Process complete lines
                    while '\n' in buffer:
                        line, buffer = buffer.split('\n', 1)
                        data = line.strip()
                        if data:
                            self._display_response(data)
            except Exception as e:
                print(f"[RX_ERROR] {e}")
            time.sleep(0.02)  # Faster polling
    
    def _display_response(self, data):
        """Format and display received response."""
        # Determine log level and source
        source = "DRONE"
        level = "INFO"
        
        if "[ERROR]" in data or "[CRIT]" in data or "[EMERG]" in data:
            level = "ERROR"
        elif "[WARN]" in data:
            level = "WARN"
        else:
            level = "INFO"
        
        # Parse and broadcast telemetry data if present
        self._parse_and_broadcast_telemetry(data)
        
        # Send to frontend via WebSocket as log
        self._broadcast_log(message=data, source=source, level=level)
        
        # ACK responses (PONG, OK, etc)
        if "PONG" in data:
            print(f"\n  ✅ \033[92m{data}\033[0m")  # Green for ACK
        elif "HUMAN DETECTED" in data:
            print(f"\n  🚨 {data}")
        elif "DETECTION:" in data:
            print(f"\n  📷 {data}")
        elif "MISSION" in data:
            print(f"\n  🛫 {data}")
        # Telemetry messages from drone
        elif "[TELEM]" in data:
            # Color-code telemetry by severity
            if "[ERROR]" in data or "[CRIT]" in data or "[EMERG]" in data:
                print(f"\n  ❌ \033[91m{data}\033[0m")  # Red
            elif "[WARN]" in data:
                print(f"\n  ⚠️  \033[93m{data}\033[0m")  # Yellow
            elif "[NOTICE]" in data:
                print(f"\n  📢 \033[94m{data}\033[0m")  # Blue
            else:
                print(f"\n  📡 \033[96m{data}\033[0m")  # Cyan
        elif "ERROR" in data:
            print(f"\n  ❌ \033[91m{data}\033[0m")  # Red for errors
        elif "OK" in data or "SUCCESS" in data or "ARMED" in data or "READY" in data:
            print(f"\n  ✅ \033[92m{data}\033[0m")  # Green for success
        else:
            print(f"\n  >> {data}")
        print("CMD> ", end='', flush=True)
    
    def _broadcast_log(self, message: str, source: str = "DRONE", level: str = "INFO"):
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
        
        print(f"[LOG] Broadcasting: {source} [{level}] {message}")
        print(f"[DEBUG] websocket_loop = {self.websocket_loop}")
        print(f"[DEBUG] websocket_clients count = {len(self.websocket_clients)}")
        
        # Send to all connected clients
        if not hasattr(self, 'websocket_loop') or self.websocket_loop is None:
            print("[LOG] WebSocket loop not ready yet, skipping broadcast")
            return
            
        for client in list(self.websocket_clients):
            try:
                print(f"[DEBUG] Sending to client: {client}")
                asyncio.run_coroutine_threadsafe(
                    client.send(json.dumps(log_entry)),
                    self.websocket_loop
                )
                print(f"[DEBUG] Message queued for client")
            except Exception as e:
                # Client disconnected, remove it
                self.websocket_clients.discard(client)
                print(f"[LOG] Client error: {e}")
    
    def _parse_and_broadcast_telemetry(self, data: str):
        """Parse telemetry data from drone response and broadcast to WebSocket clients."""
        try:
            # Example formats the drone might send:
            # ARMED, DISARMED, FLYING, LANDED
            # SPEED:8.5 HEADING:270 ALT:120.5 PITCH:5.2 ROLL:-2.1
            # GPS:28.545,77.192,120.5
            
            telemetry_update = {}
            
            # Parse armed/disarmed status
            if "ARMED" in data and "DISARMED" not in data:
                telemetry_update["droneArmed"] = True
            elif "DISARMED" in data:
                telemetry_update["droneArmed"] = False
            
            # Parse flying status
            if "FLYING" in data:
                telemetry_update["droneFlying"] = True
            elif "LANDED" in data:
                telemetry_update["droneFlying"] = False
            
            # Parse SPEED:value format
            if "SPEED:" in data:
                try:
                    speed_str = data.split("SPEED:")[1].split()[0].rstrip(",")
                    telemetry_update["speed"] = float(speed_str)
                except:
                    pass
            
            # Parse HEADING:value format
            if "HEADING:" in data:
                try:
                    heading_str = data.split("HEADING:")[1].split()[0].rstrip(",")
                    telemetry_update["heading"] = float(heading_str)
                except:
                    pass
            
            # Parse ALT:value format
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
            
            # Parse PITCH:value and ROLL:value
            if "PITCH:" in data:
                try:
                    pitch_str = data.split("PITCH:")[1].split()[0].rstrip(",")
                    telemetry_update["pitch"] = float(pitch_str)
                except:
                    pass
            
            if "ROLL:" in data:
                try:
                    roll_str = data.split("ROLL:")[1].split()[0].rstrip(",")
                    telemetry_update["roll"] = float(roll_str)
                except:
                    pass
            
            # Parse GPS:lat,lon,alt format
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
            
            # Only send telemetry update if we parsed something
            if telemetry_update:
                telemetry_message = {
                    "action": "telemetry",
                    "data": telemetry_update
                }
                
                print(f"[TELEM] Parsed: {telemetry_update}")
                
                # Broadcast to all connected clients
                for client in list(self.websocket_clients):
                    try:
                        asyncio.run_coroutine_threadsafe(
                            client.send(json.dumps(telemetry_message)),
                            self.websocket_loop
                        )
                    except Exception as e:
                        self.websocket_clients.discard(client)
        except Exception as e:
            pass  # Silently ignore parse errors
    
    async def websocket_handler(self, websocket):
        """Handle WebSocket connections - receive commands from frontend and broadcast telemetry."""
        self.websocket_clients.add(websocket)
        print(f"[WS] Client connected. Total clients: {len(self.websocket_clients)}")
        
        try:
            async for message in websocket:
                # Handle incoming commands from frontend
                try:
                    cmd = message.strip()
                    if cmd and cmd.upper() not in ["", "NULL"]:
                        print(f"[WS_CMD] Received command from frontend: {cmd}")
                        # Send command to drone via serial
                        self.send_command(cmd)
                except Exception as e:
                    print(f"[WS_CMD_ERROR] Failed to process command: {e}")
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.websocket_clients.discard(websocket)
            print(f"[WS] Client disconnected. Total clients: {len(self.websocket_clients)}")
    
    def start_websocket_server(self, host="0.0.0.0", port=8000):
        """Start WebSocket server in separate thread."""
        def run_server():
            self.websocket_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self.websocket_loop)
            
            async def start_and_serve():
                async with websockets.serve(self.websocket_handler, host, port):
                    print(f"[WS] WebSocket server started on ws://{host}:{port}/telemetry")
                    await asyncio.Event().wait()
            
            self.websocket_loop.run_until_complete(start_and_serve())
        
        self.websocket_thread = threading.Thread(target=run_server, daemon=True)
        self.websocket_thread.start()
    
    def send_command(self, cmd):
        """Send a command to the drone."""
        try:
            cmd = cmd.strip()
            if not cmd:
                return
            
            print(f"[DEBUG] send_command called with: {cmd}")
            
            # Send command with newline
            self.serial.write(f"{cmd}\n".encode())
            print(f"[TX] Sent: {cmd}")
            
            # Broadcast the command to WebSocket clients
            print(f"[DEBUG] About to broadcast log")
            self._broadcast_log(message=f"TX: {cmd}", source="GROUND", level="INFO")
            print(f"[DEBUG] Broadcast complete")
            
        except Exception as e:
            print(f"[ERROR] Failed to send: {e}")
            self._broadcast_log(message=f"ERROR: Failed to send '{cmd}': {e}", source="GROUND", level="ERROR")
    
    def send_command_with_ack(self, cmd: str, expected_acks: list = None, timeout: float = 10.0) -> bool:
        """
        Send a command and wait for acknowledgment.
        
        Args:
            cmd: Command to send
            expected_acks: List of strings that count as acknowledgment
            timeout: Timeout in seconds
            
        Returns:
            True if acknowledged, False if timeout
        """
        if expected_acks is None:
            expected_acks = self._get_default_acks(cmd)
        
        # Clear any pending responses
        if self.serial:
            self.serial.reset_input_buffer()
        
        # Send command
        self.send_command(cmd)
        
        # Wait for acknowledgment
        start_time = time.time()
        buffer = ""
        
        while time.time() - start_time < timeout:
            if self.demo_mode:
                time.sleep(0.5)
                return True
                
            if self.serial and self.serial.in_waiting > 0:
                chunk = self.serial.read(self.serial.in_waiting).decode('utf-8', errors='ignore')
                buffer += chunk
                
                # Check for any expected ack
                for ack in expected_acks:
                    if ack.upper() in buffer.upper():
                        print(f"[ACK] Received acknowledgment for '{cmd}'")
                        return True
            
            time.sleep(0.05)
        
        print(f"[TIMEOUT] No acknowledgment received for '{cmd}'")
        return False
    
    def _get_default_acks(self, cmd: str) -> list:
        """Get default acknowledgment patterns for a command."""
        cmd_upper = cmd.upper().strip()
        
        if cmd_upper == "PING":
            return ["PONG"]
        elif cmd_upper == "ARM":
            return ["ARMED", "ARM OK", "OK"]
        elif cmd_upper == "DISARM":
            return ["DISARMED", "DISARM OK", "OK"]
        elif cmd_upper.startswith("TAKEOFF"):
            return ["TAKEOFF OK", "TAKING OFF", "AIRBORNE", "OK"]
        elif cmd_upper == "LAND":
            return ["LANDING", "LAND OK", "OK"]
        elif cmd_upper == "RTL":
            return ["RTL", "RETURNING", "OK"]
        elif cmd_upper == "SCOUT":
            return ["SCOUT", "SCOUTING", "DETECTION", "OK"]
        elif cmd_upper.startswith("GOTO"):
            return ["GOTO OK", "NAVIGATING", "OK"]
        elif cmd_upper.startswith("MODE"):
            return ["MODE", "OK"]
        else:
            return ["OK", "ACK"]
    
    def execute_mission_sequence(self, altitude: float = 10.0) -> bool:
        """
        Execute a standard mission sequence with acknowledgment waiting.
        
        Sequence: PING → ARM → TAKEOFF → SCOUT → MODE:AUTO
        
        Returns:
            True if all steps succeeded
        """
        print("\n" + "="*50)
        print("  EXECUTING MISSION SEQUENCE")
        print("="*50 + "\n")
        
        steps = [
            ("PING", 5.0, "Testing connection..."),
            ("ARM", 10.0, "Arming drone..."),
            (f"TAKEOFF:{altitude}", 30.0, f"Taking off to {altitude}m..."),
            ("SCOUT", 10.0, "Starting scout/detection mode..."),
            ("MODE:AUTO", 10.0, "Setting autonomous mode..."),
        ]
        
        for i, (cmd, timeout, description) in enumerate(steps, 1):
            print(f"[MISSION] Step {i}/{len(steps)}: {description}")
            
            if not self.send_command_with_ack(cmd, timeout=timeout):
                print(f"[MISSION] ❌ Step {i} failed: {cmd}")
                return False
            
            print(f"[MISSION] ✅ Step {i} complete")
            time.sleep(0.5)
        
        print("\n" + "="*50)
        print("  ✅ MISSION SEQUENCE COMPLETE")
        print("="*50 + "\n")
        
        return True

    def run_interactive(self):
        """Run interactive command mode."""
        print("\n" + "=" * 50)
        print("  DRONE SCOUT - Ground Station")
        print("=" * 50)
        
        # Start WebSocket server on port 8765 to avoid conflicts
        self.start_websocket_server(host="0.0.0.0", port=8765)
        
        print("\nQuick start (SCOUT auto-starts detection + recording):")
        print("  1. SCOUT              <- Just this for ground test!")
        print("  2. SCOUT:STOP         <- Stop and save video")
        print("\nFull flight sequence:")
        print("  1. ARM")
        print("  2. TAKEOFF:10")
        print("  3. SCOUT              <- Auto-starts detection + recording")
        print("  4. RTL")
        print("  5. SCOUT:STOP")
        print("\nSequenced mission (auto with ack waiting):")
        print("  MISSION               <- Runs PING→ARM→TAKEOFF→SCOUT→AUTO")
        print("\nDual Drone Mode:")
        print("  python3 dual_drone_controller.py --demo")
        print("\nTelemetry: Real-time logs appear with 📡 prefix")
        print("Type HELP for all commands")
        print("-" * 50)
        
        self.running = True
        
        # Start receive thread
        self.receive_thread = threading.Thread(target=self.receive_responses, daemon=True)
        self.receive_thread.start()
        
        try:
            while self.running:
                try:
                    cmd = input("CMD> ").strip().upper()
                    
                    if cmd == "QUIT" or cmd == "EXIT" or cmd == "Q":
                        print("Exiting...")
                        break
                    
                    if cmd == "HELP" or cmd == "?":
                        self.show_help()
                        continue
                    
                    # Handle MISSION command
                    if cmd == "MISSION" or cmd.startswith("MISSION:"):
                        alt = 10.0
                        if ":" in cmd:
                            try:
                                alt = float(cmd.split(":")[1])
                            except:
                                pass
                        threading.Thread(
                            target=self.execute_mission_sequence,
                            args=(alt,),
                            daemon=True
                        ).start()
                        continue
                    
                    if cmd:
                        self.send_command(cmd)
                        time.sleep(0.1)  # Small delay for response
                        
                except EOFError:
                    break
                    
        except KeyboardInterrupt:
            print("\n[INFO] Interrupted")
        
        self.running = False
        if self.serial:
            self.serial.close()
        print("[INFO] Disconnected")
    
    def show_help(self):
        """Show help message."""
        print("""
Commands:
  === QUICK START (Ground Test) ===
  SCOUT            - Start detection + recording (auto!)
  SCOUT:STOP       - Stop everything and save video
  MISSION          - Execute full sequence: PING→ARM→TAKEOFF→SCOUT→AUTO
  
  === FULL FLIGHT SEQUENCE ===
  1. ARM              - Arm the drone
  2. TAKEOFF:10       - Takeoff to 10 meters
  3. SCOUT            - Auto-starts detection + recording
  4. RTL              - Return home after scouting
  5. SCOUT:STOP       - Stop and save recording
  
  === WITH WAYPOINTS (optional) ===
  WP:lat,lon,alt   - Add waypoint BEFORE SCOUT
  WP:CLEAR         - Clear all waypoints
  WP:LIST          - Show all waypoints
  ALT:15           - Set default altitude (meters)
  Then: SCOUT      - Flies waypoints with detection
  
  === FLIGHT COMMANDS ===
  ARM              - Arm motors
  DISARM           - Disarm motors
  TAKEOFF:10       - Takeoff to 10 meters
  LAND             - Land immediately
  RTL              - Return to launch
  GOTO:lat,lon,alt - Go to single location
  ABORT            - Emergency stop
  
  === DETECTION (manual control) ===
  DETECT:START     - Start camera + detection (no recording)
  DETECT:STOP      - Stop detection
  DETECT:STATUS    - Get detection count + recording status
  DETECT:CONF:0.7  - Set confidence (0.1-1.0)
  
  === SEQUENCED COMMANDS (with ack waiting) ===
  MISSION          - Full mission: PING→ARM→TAKEOFF→SCOUT→AUTO
  MISSION:15       - Mission with 15m altitude
  
  === OTHER ===
  STATUS           - Get drone status
  PING             - Test connection
  MODE:GUIDED      - Set guided mode
  QUIT             - Exit program

  === DUAL DRONE MODE ===
  For coordinating VTOL + Delivery drones, use:
  python3 dual_drone_controller.py --demo

  === TELEMETRY ===
  Real-time logs from drone appear automatically:
  📡 [TELEM][INFO]   - Informational (cyan)
  📢 [TELEM][NOTICE] - Mode changes, arm/disarm (blue)
  ⚠️  [TELEM][WARN]   - Warnings (yellow)
  ❌ [TELEM][ERROR]  - Errors (red)

  === EXAMPLE: GROUND TEST ===
  CMD> SCOUT
  ... Detection running, video recording...
  ... 🚨 HUMAN DETECTED alerts appear ...
  CMD> SCOUT:STOP
  ... Video saved to recordings/scout_YYYYMMDD_HHMMSS.mp4

  === EXAMPLE: FULL FLIGHT ===
  CMD> MISSION
  ... Executes PING→ARM→TAKEOFF→SCOUT→AUTO automatically
  CMD> RTL
  CMD> SCOUT:STOP
""")


def main():
    parser = argparse.ArgumentParser(description='Drone Command Sender via LoRa/3DR Radio')
    parser.add_argument('--port', default=None,
                       help='Serial port (auto-detect if not specified, Windows: COM3, Linux: /dev/ttyUSB0)')
    parser.add_argument('--baud', type=int, default=57600,
                       help='Baud rate (default: 57600)')
    parser.add_argument('--demo', action='store_true',
                       help='Run in demo mode without serial connection')
    args = parser.parse_args()
    
    # In demo mode, skip serial connection
    if args.demo:
        print("[INFO] Running in DEMO mode - no serial connection required")
        sender = DroneCommandSender(port="DEMO", baud=args.baud)
        sender.demo_mode = True
        sender.run_interactive()
        return
    
    # Auto-detect port if not specified
    port = args.port if args.port else auto_detect_port(args.baud)
    
    if not port:
        print("[ERROR] Could not find serial port")
        sys.exit(1)
    
    sender = DroneCommandSender(port=port, baud=args.baud)
    
    if not sender.connect():
        sys.exit(1)
    
    sender.run_interactive()


if __name__ == "__main__":
    main()
