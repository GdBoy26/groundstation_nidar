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
    KML:file      - Upload KML boundary (e.g. KML:survey_area.kml)
    SCOUT         - [DEPRECATED] Use KML:file instead
    MODE:STABILIZE - Change to stabilize mode
    MODE:LOITER   - Change to loiter mode
    MODE:GUIDED   - Change to guided mode
    MODE:AUTO     - Start uploaded mission (after KML upload)
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
        self.hardware_connected = False  # True only when receiving valid data from real hardware
        self.last_telemetry_time = 0  # Timestamp of last received telemetry
        
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
            self.hardware_connected = False  # Not confirmed until we receive valid telemetry
            self._broadcast_hardware_status(False)  # Notify frontend we're not confirmed yet
            return True
        except Exception as e:
            print(f"[ERROR] Failed to connect to serial port {self.port}: {e}")
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
                    # Read all available data
                    chunk = self.serial.read(self.serial.in_waiting).decode('utf-8', errors='ignore')
                    buffer += chunk
                    consecutive_errors = 0  # Reset error counter on successful read
                    
                    # Process complete lines
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
                    time.sleep(2)  # Longer delay on permission errors
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
                    # Serial error - hardware may have disconnected
                    if self.hardware_connected:
                        self.hardware_connected = False
                        self._broadcast_hardware_status(False)
                        print(f"[WARN] ❌ Hardware disconnected - Serial error")
                    consecutive_errors = 0
            time.sleep(0.02)  # Faster polling
    
    def _display_response(self, data):
        """Format and display received response."""
        # Determine log level and source
        source = "VTOL"  # This is the VTOL scout drone
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
    
    def _broadcast_log(self, message: str, source: str = "VTOL", level: str = "INFO"):
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
            # Example formats the drone/flight computer might send:
            # ARMED, DISARMED, FLYING, LANDED
            # SPEED:8.5 HEADING:270 ALT:120.5 PITCH:5.2 ROLL:-2.1 YAW:180
            # GPS:28.545,77.192,120.5
            # BATT:12.6,15.2,85  (voltage, current, percent)
            # AIRSPEED:12.5 GROUNDSPEED:10.2
            # MODE:AUTO or MODE:GUIDED etc.
            
            telemetry_update = {}
            
            # Parse armed/disarmed status
            if "ARMED" in data and "DISARMED" not in data:
                telemetry_update["vtolArmed"] = True  # For VTOL
            elif "DISARMED" in data:
                telemetry_update["vtolArmed"] = False
            
            # Parse flying status
            if "FLYING" in data or "AIRBORNE" in data:
                telemetry_update["vtolFlying"] = True
            elif "LANDED" in data:
                telemetry_update["vtolFlying"] = False
            
            # Parse SPEED:value format (ground speed)
            if "SPEED:" in data:
                try:
                    speed_str = data.split("SPEED:")[1].split()[0].rstrip(",")
                    telemetry_update["speed"] = float(speed_str)
                except:
                    pass
            
            # Parse GROUNDSPEED:value format
            if "GROUNDSPEED:" in data:
                try:
                    gs_str = data.split("GROUNDSPEED:")[1].split()[0].rstrip(",")
                    telemetry_update["speed"] = float(gs_str)
                except:
                    pass
            
            # Parse AIRSPEED:value format
            if "AIRSPEED:" in data:
                try:
                    as_str = data.split("AIRSPEED:")[1].split()[0].rstrip(",")
                    telemetry_update["airspeed"] = float(as_str)
                except:
                    pass
            
            # Parse HEADING:value format (compass)
            if "HEADING:" in data:
                try:
                    heading_str = data.split("HEADING:")[1].split()[0].rstrip(",")
                    telemetry_update["heading"] = float(heading_str)
                except:
                    pass
            
            # Parse YAW:value format (also used for compass)
            if "YAW:" in data:
                try:
                    yaw_str = data.split("YAW:")[1].split()[0].rstrip(",")
                    yaw_val = float(yaw_str)
                    telemetry_update["yaw"] = yaw_val
                    # Yaw can also be used as heading if heading not present
                    if "heading" not in telemetry_update:
                        telemetry_update["heading"] = yaw_val
                except:
                    pass
            
            # Parse ALT:value format
            if "ALT:" in data:
                try:
                    alt_str = data.split("ALT:")[1].split()[0].rstrip(",")
                    alt_val = float(alt_str)
                    telemetry_update["vtolGps"] = {
                        "lat": telemetry_update.get("vtolGps", {}).get("lat", 28.545),
                        "lon": telemetry_update.get("vtolGps", {}).get("lon", 77.192),
                        "alt": alt_val
                    }
                except:
                    pass
            
            # Parse PITCH:value format (attitude for artificial horizon)
            if "PITCH:" in data:
                try:
                    pitch_str = data.split("PITCH:")[1].split()[0].rstrip(",")
                    telemetry_update["pitch"] = float(pitch_str)
                except:
                    pass
            
            # Parse ROLL:value format (attitude for artificial horizon)
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
                        telemetry_update["vtolGps"] = {
                            "lat": float(parts[0]),
                            "lon": float(parts[1]),
                            "alt": float(parts[2])
                        }
                except:
                    pass
            
            # Parse BATT:voltage,current,percent format (battery)
            if "BATT:" in data:
                try:
                    batt_str = data.split("BATT:")[1].split()[0]
                    parts = batt_str.split(",")
                    if len(parts) >= 1:
                        telemetry_update["batteryVoltage"] = float(parts[0])
                    if len(parts) >= 2:
                        telemetry_update["batteryCurrent"] = float(parts[1])
                    if len(parts) >= 3:
                        telemetry_update["batteryPercent"] = float(parts[2])
                except:
                    pass
            
            # Parse VOLTAGE:value format
            if "VOLTAGE:" in data:
                try:
                    volt_str = data.split("VOLTAGE:")[1].split()[0].rstrip(",")
                    telemetry_update["batteryVoltage"] = float(volt_str)
                except:
                    pass
            
            # Parse CURRENT:value format
            if "CURRENT:" in data:
                try:
                    curr_str = data.split("CURRENT:")[1].split()[0].rstrip(",")
                    telemetry_update["batteryCurrent"] = float(curr_str)
                except:
                    pass
            
            # Parse MODE:value format
            if "MODE:" in data:
                try:
                    mode_str = data.split("MODE:")[1].split()[0].rstrip(",")
                    telemetry_update["mode"] = mode_str.upper()
                except:
                    pass
            
            # Only send telemetry update if we parsed something
            if telemetry_update:
                # Include hardware connection status in telemetry
                telemetry_update["hardwareConnected"] = self.hardware_connected
                
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
    
    def _simulate_demo_response(self, cmd):
        """Simulate drone response in demo mode for VTOL."""
        cmd_upper = cmd.upper().strip()
        
        def send_delayed_response(response, delay=0.5):
            """Helper to send delayed response."""
            def _send():
                time.sleep(delay)
                self._display_response(response)
            threading.Thread(target=_send, daemon=True).start()
        
        if cmd_upper == "PING":
            send_delayed_response("PONG - VTOL connection OK")
        elif cmd_upper == "ARM":
            send_delayed_response("ARMED OK - VTOL motors ready")
        elif cmd_upper.startswith("TAKEOFF"):
            alt = cmd.split(":")[1] if ":" in cmd else "10"
            send_delayed_response(f"TAKEOFF - VTOL ascending to {alt}m")
            send_delayed_response(f"AIRBORNE - VTOL at altitude {alt}m", 1.5)
        elif cmd_upper == "SCOUT":
            send_delayed_response("SCOUT - VTOL starting human detection scan")
            send_delayed_response("SCOUTING - Detection + Recording active", 1.0)
            # Simulate human detection after a few seconds
            self._start_demo_detection_simulation()
        elif cmd_upper.startswith("MODE"):
            mode = cmd.split(":")[1] if ":" in cmd else "AUTO"
            send_delayed_response(f"MODE:{mode} - VTOL autonomous mode enabled")
        elif cmd_upper == "LAND":
            send_delayed_response("LANDING - VTOL descending")
            send_delayed_response("LANDED - VTOL on ground", 2.0)
        elif cmd_upper == "RTL":
            send_delayed_response("RTL - VTOL returning to launch")
        elif cmd_upper == "DISARM":
            send_delayed_response("DISARMED - VTOL motors safe")
        else:
            send_delayed_response(f"ACK: {cmd}")
    
    def _start_demo_detection_simulation(self):
        """Simulate human detection events in demo mode."""
        def simulate_detections():
            # Wait a bit then simulate detections
            detections = [
                (28.5451, 77.1921, 8),    # Detection after 8 seconds
                (28.5453, 77.1925, 15),   # Another after 15 seconds
                (28.5448, 77.1918, 25),   # Another after 25 seconds
            ]
            
            for lat, lon, delay in detections:
                time.sleep(delay)
                if not self.running:
                    break
                    
                detection_msg = f"DETECTED:{lat},{lon},{datetime.now().isoformat()},0.92"
                self._display_response(f"🚨 HUMAN DETECTED at LAT:{lat}, LON:{lon}")
                
                # Broadcast detection event to frontend
                if self.websocket_loop:
                    detection_event = {
                        "action": "detection",
                        "event": "human_detected",
                        "data": {
                            "lat": lat,
                            "lon": lon,
                            "confidence": 0.92,
                            "timestamp": datetime.now().isoformat()
                        }
                    }
                    for client in list(self.websocket_clients):
                        try:
                            asyncio.run_coroutine_threadsafe(
                                client.send(json.dumps(detection_event)),
                                self.websocket_loop
                            )
                        except:
                            pass
                    
                print(f"\n  🚨 \033[93mHUMAN DETECTED at {lat}, {lon}\033[0m")
                print("CMD> ", end='', flush=True)
        
        threading.Thread(target=simulate_detections, daemon=True).start()
    
    def _start_demo_telemetry_simulation(self):
        """Simulate continuous telemetry data for testing UI instruments."""
        import math
        import random
        
        def simulate_telemetry():
            """Continuously broadcast simulated telemetry at 10Hz."""
            start_time = time.time()
            base_lat = 28.5450
            base_lon = 77.1920
            altitude = 0.0
            heading = 0.0
            speed = 0.0
            battery_percent = 100.0
            battery_voltage = 12.6
            is_armed = False
            is_flying = False
            
            while self.running:
                elapsed = time.time() - start_time
                
                # Simulate realistic flight dynamics
                # Gentle oscillation for pitch and roll (like wind effect)
                pitch = 3.0 * math.sin(elapsed * 0.5) + random.uniform(-1, 1)
                roll = 2.0 * math.sin(elapsed * 0.7 + 1.5) + random.uniform(-0.5, 0.5)
                
                # Heading slowly rotates (simulating gentle turns)
                heading = (heading + 0.5 + random.uniform(-0.2, 0.2)) % 360
                
                # Yaw matches heading
                yaw = heading
                
                # Speed varies
                if is_flying:
                    speed = 8.0 + 2.0 * math.sin(elapsed * 0.3) + random.uniform(-0.5, 0.5)
                    airspeed = speed + random.uniform(-1, 1)
                else:
                    speed = 0.0
                    airspeed = 0.0
                
                # Altitude stays relatively stable once at target
                if is_flying:
                    altitude = 15.0 + 0.5 * math.sin(elapsed * 0.2) + random.uniform(-0.2, 0.2)
                else:
                    altitude = 0.0
                
                # Battery slowly drains
                battery_percent = max(0, 100.0 - (elapsed * 0.1))  # ~10% per 100 seconds
                battery_voltage = 11.1 + (battery_percent / 100.0) * 1.5  # 11.1V - 12.6V
                battery_current = 15.0 + random.uniform(-2, 2) if is_flying else 0.5
                
                # GPS position slowly drifts (simulating flight)
                if is_flying:
                    lat = base_lat + 0.0001 * math.sin(elapsed * 0.1)
                    lon = base_lon + 0.0001 * math.cos(elapsed * 0.1)
                else:
                    lat = base_lat
                    lon = base_lon
                
                # Build telemetry update
                telemetry_update = {
                    "pitch": round(pitch, 1),
                    "roll": round(roll, 1),
                    "yaw": round(yaw, 1),
                    "heading": round(heading, 1),
                    "speed": round(speed, 1),
                    "airspeed": round(airspeed, 1),
                    "batteryVoltage": round(battery_voltage, 2),
                    "batteryCurrent": round(battery_current, 1),
                    "batteryPercent": round(battery_percent, 0),
                    "vtolGps": {
                        "lat": round(lat, 6),
                        "lon": round(lon, 6),
                        "alt": round(altitude, 1)
                    },
                    "vtolArmed": is_armed,
                    "vtolFlying": is_flying
                }
                
                # Broadcast telemetry
                if self.websocket_loop and self.websocket_clients:
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
                        except:
                            self.websocket_clients.discard(client)
                
                # After 5 seconds, arm
                if elapsed > 5 and not is_armed:
                    is_armed = True
                    print("[DEMO_TELEM] VTOL armed")
                
                # After 10 seconds, start flying
                if elapsed > 10 and not is_flying:
                    is_flying = True
                    print("[DEMO_TELEM] VTOL flying")
                
                time.sleep(0.1)  # 10Hz update rate
        
        print("[DEMO_TELEM] Starting telemetry simulation (10Hz)")
        threading.Thread(target=simulate_telemetry, daemon=True).start()
    
    def send_command(self, cmd):
        """Send a command to the drone."""
        try:
            cmd = cmd.strip()
            if not cmd:
                return
            
            print(f"[DEBUG] send_command called with: {cmd}")
            
            if self.demo_mode:
                # In demo mode, simulate response
                print(f"[DEMO_TX] VTOL Sent: {cmd}")
                self._broadcast_log(message=f"TX: {cmd}", source="GROUND", level="INFO")
                self._simulate_demo_response(cmd)
                return
            
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

    def compress_kml_boundary(self, kml_file):
        """
        Extract and compress polygon boundary coordinates from KML file.
        
        Args:
            kml_file: Path to KML file
            
        Returns:
            Base64-encoded compressed coordinate string
            
        Process:
            1. Parse KML XML to extract <Polygon><coordinates> text
            2. Compress using zlib
            3. Base64 encode for safe transmission over radio
            4. Return encoded string
        """
        import xml.etree.ElementTree as ET
        import base64
        import zlib
        import os
        
        # Resolve file path
        if not os.path.isabs(kml_file):
            # Try current directory first
            if os.path.exists(kml_file):
                kml_file = os.path.abspath(kml_file)
            # Then try missions directory
            elif os.path.exists(os.path.join("/home/dart/quadtest/missions/", kml_file)):
                kml_file = os.path.join("/home/dart/quadtest/missions/", kml_file)
            else:
                raise FileNotFoundError(f"KML file not found: {kml_file}")
        
        if not os.path.exists(kml_file):
            raise FileNotFoundError(f"KML file not found: {kml_file}")
        
        print(f"[KML] Parsing KML file: {kml_file}")
        
        # Parse KML
        tree = ET.parse(kml_file)
        root = tree.getroot()
        
        # Find coordinates (handle KML namespace)
        ns = {'kml': 'http://www.opengis.net/kml/2.2'}
        coords = root.find('.//kml:Polygon//kml:coordinates', ns)
        
        if coords is None:
            # Try without namespace
            coords = root.find('.//Polygon//coordinates')
        
        if coords is None:
            # Try LinearRing within Polygon
            coords = root.find('.//kml:Polygon//kml:LinearRing//kml:coordinates', ns)
        
        if coords is None:
            coords = root.find('.//Polygon//LinearRing//coordinates')
        
        if coords is None:
            raise ValueError("No polygon coordinates found in KML file")
        
        coord_text = coords.text.strip()
        print(f"[KML] Found {len(coord_text.split())} coordinate points")
        
        # Compress and encode
        print("[KML] Compressing boundary data...")
        compressed = zlib.compress(coord_text.encode('utf-8'), level=9)
        encoded = base64.b64encode(compressed).decode('ascii')
        
        original_size = len(coord_text.encode('utf-8'))
        compressed_size = len(encoded)
        ratio = (1 - compressed_size / original_size) * 100
        
        print(f"[KML] Original: {original_size} bytes, Compressed: {compressed_size} bytes ({ratio:.1f}% reduction)")
        
        return encoded
    
    def send_kml_mission(self, kml_file):
        """
        Send compressed KML boundary to drone.
        RPI will handle waypoint generation with its own altitude/pattern settings.
        
        Protocol:
            1. Send: "KML:START:{data_size}"
            2. Wait 200ms for drone to prepare
            3. Send boundary data in 64-byte chunks as "KML:DATA:{chunk}"
            4. Wait 100ms between chunks (respect 3DR radio buffer)
            5. Send: "KML:END" to trigger processing
            
        Args:
            kml_file: Path to KML file
        """
        try:
            # Step 1: Compress KML boundary
            print(f"\n{'='*50}")
            print(f"  KML BOUNDARY UPLOAD")
            print(f"{'='*50}")
            print(f"[KML] File: {kml_file}")
            print(f"{'='*50}\n")
            
            encoded_boundary = self.compress_kml_boundary(kml_file)
            data_size = len(encoded_boundary)
            
            # Step 2: Send START command with data size, altitude and pattern
            # Altitude: 30 feet, Pattern: curved (always)
            altitude = 30  # feet
            pattern = "curved"
            start_cmd = f"KML:START:{data_size}:{altitude}:{pattern}"
            print(f"[KML] Sending start command (altitude: {altitude}ft, pattern: {pattern})...")
            self.send_command(
                
            )
            time.sleep(0.2)  # Wait 200ms for drone to prepare
            
            # Step 3: Send data in 64-byte chunks
            chunk_size = 64
            total_chunks = (data_size + chunk_size - 1) // chunk_size
            
            print(f"[KML] Sending {data_size} bytes in {total_chunks} chunks...")
            
            for i in range(0, data_size, chunk_size):
                chunk = encoded_boundary[i:i + chunk_size]
                chunk_num = i // chunk_size + 1
                
                # Send chunk
                chunk_cmd = f"KML:DATA:{chunk}"
                
                if self.demo_mode:
                    # In demo mode, just simulate sending
                    pass
                else:
                    if self.serial:
                        self.serial.write(f"{chunk_cmd}\n".encode())
                
                # Calculate and display progress
                progress = ((i + chunk_size) / data_size) * 100
                progress = min(progress, 100)  # Cap at 100%
                
                # Print progress at 0%, 25%, 50%, 75%, 100%
                if chunk_num == 1:
                    print(f"[KML] Sending 0%...", end='', flush=True)
                elif progress >= 25 and progress < 50 and (i - chunk_size) / data_size * 100 < 25:
                    print(f" 25%...", end='', flush=True)
                elif progress >= 50 and progress < 75 and (i - chunk_size) / data_size * 100 < 50:
                    print(f" 50%...", end='', flush=True)
                elif progress >= 75 and progress < 100 and (i - chunk_size) / data_size * 100 < 75:
                    print(f" 75%...", end='', flush=True)
                
                # Wait 100ms between chunks for radio buffer
                time.sleep(0.1)
            
            print(f" 100%")
            
            # Step 4: Send END command to trigger processing
            print(f"[KML] Sending end command...")
            self.send_command("KML:END")
            
            print(f"\n[KML] ✅ KML boundary transmission complete!")
            print(f"[KML] RPI will generate waypoints and upload mission to Pixhawk.")
            print(f"[KML] Watch for [DRONE] responses below.")
            print(f"{'='*50}\n")
            
            # Broadcast to WebSocket clients
            self._broadcast_log(
                message=f"KML boundary uploaded: {kml_file}",
                source="GROUND",
                level="INFO"
            )
            
            return True
            
        except FileNotFoundError as e:
            print(f"[KML] ❌ ERROR: {e}")
            self._broadcast_log(message=f"KML ERROR: {e}", source="GROUND", level="ERROR")
            return False
        except ValueError as e:
            print(f"[KML] ❌ ERROR: {e}")
            self._broadcast_log(message=f"KML ERROR: {e}", source="GROUND", level="ERROR")
            return False
        except Exception as e:
            print(f"[KML] ❌ ERROR: Failed to send KML mission: {e}")
            self._broadcast_log(message=f"KML ERROR: {e}", source="GROUND", level="ERROR")
            return False

    def run_interactive(self):
        """Run interactive command mode."""
        print("\n" + "=" * 50)
        print("  DRONE SCOUT - Ground Station")
        print("=" * 50)
        
        # Start WebSocket server on port 8765 to avoid conflicts
        self.start_websocket_server(host="0.0.0.0", port=8765)
        
        # In demo mode, start telemetry simulation for testing UI
        if self.demo_mode:
            print("\n📡 [DEMO MODE] Starting telemetry simulation...")
            self._start_demo_telemetry_simulation()
        
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
                    cmd_raw = input("CMD> ").strip()
                    cmd = cmd_raw.upper()
                    
                    if cmd == "QUIT" or cmd == "EXIT" or cmd == "Q":
                        print("Exiting...")
                        break
                    
                    if cmd == "HELP" or cmd == "?":
                        self.show_help()
                        continue
                    
                    # Handle KML: command - KML:filename
                    if cmd.startswith("KML:") and not cmd.startswith("KML:START") and not cmd.startswith("KML:DATA") and not cmd.startswith("KML:END"):
                        try:
                            # Parse KML:file
                            # Use raw input to preserve case for filename
                            kml_file = cmd_raw.split(":", 1)[1].strip()
                            
                            if not kml_file:
                                print("[ERROR] Usage: KML:filename")
                                print("        Example: KML:survey_area.kml")
                                continue
                            
                            # Execute in thread to not block
                            threading.Thread(
                                target=self.send_kml_mission,
                                args=(kml_file,),
                                daemon=True
                            ).start()
                            continue
                            
                        except Exception as e:
                            print(f"[ERROR] KML command failed: {e}")
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
  === KML BOUNDARY UPLOAD ===
  KML:file             - Upload KML boundary coordinates
                         Example: KML:survey_area.kml
                         RPI handles waypoint generation
  
  === FLIGHT SEQUENCE (after KML upload) ===
  PING             - Test connection
  ARM              - Arm motors
  TAKEOFF:15       - Takeoff to 15m
  MODE:AUTO        - Start uploaded mission
  RTL              - Return to launch
  LAND             - Land immediately
  ABORT            - Emergency abort
  
  === QUICK START (Ground Test) ===
  SCOUT            - [DEPRECATED] Use KML:file instead
  SCOUT:STOP       - Stop everything and save video
  MISSION          - Execute full sequence: PING→ARM→TAKEOFF→SCOUT→AUTO
  
  === FULL FLIGHT SEQUENCE ===
  1. ARM              - Arm the drone
  2. TAKEOFF:10       - Takeoff to 10 meters
  3. MODE:AUTO        - Start uploaded KML mission
  4. RTL              - Return home after mission
  
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
    parser.add_argument('--port', default='COM17',
                       help='Serial port (default: COM17 for 3DR radio, Linux: /dev/ttyUSB0)')
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
    
    # Use specified port directly (no auto-detect unless explicitly requested)
    port = args.port
    
    print(f"[INFO] Using serial port: {port}")
    
    if not port:
        print("[ERROR] Could not find serial port")
        sys.exit(1)
    
    sender = DroneCommandSender(port=port, baud=args.baud)
    
    if not sender.connect():
        print(f"[ERROR] Failed to connect to {port}")
        print("[TIP] Check that:")
        print("  1. The 3DR radio is connected and powered")
        print("  2. No other program is using the port (Mission Planner, etc)")
        print("  3. The correct COM port is specified (--port COM17)")
        sys.exit(1)
    
    sender.run_interactive()


if __name__ == "__main__":
    main()
