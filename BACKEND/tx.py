#!/usr/bin/env python3
"""
NIDAR Ground Control Station - Dual Drone Command System via 433MHz Radio

Controls two drones from laptop via 433MHz radio links:
  - VTOL Scout (COM17) - Flies KML boundary, detects humans
  - Delivery Drone (COM19) - Delivers supplies to detected locations

Each drone has its own WebSocket for INDEPENDENT logs:
  - VTOL WebSocket: ws://localhost:8765
  - Delivery WebSocket: ws://localhost:8766

Data Flow:
  VTOL (COM17) → [human detections] → GCS → [GOTO commands] → Delivery (COM19)

Important Notes:
  - Radio Frequency: 433 MHz
  - VTOL RTL: Only when KML mission is complete (NOT on timer)
  - Each drone has completely independent log stream

Commands:
    ARM           - Arm the drone
    DISARM        - Disarm the drone
    TAKEOFF:5     - Takeoff to 5 meters
    LAND          - Land the drone
    RTL           - Return to launch
    KML:file      - Upload KML boundary for scout mission
    MODE:AUTO     - Start uploaded mission
    GOTO:lat,lon,alt - Go to GPS location
    STATUS        - Get drone status
    ABORT         - Emergency abort
    PING          - Test connection
    
Usage:
    python tx.py                    # Use config from radio_config.json
    python tx.py --demo             # Demo mode without hardware
    python tx.py --port COM17 --delivery-port COM19  # Manual port specification
"""

import sys
import time
import argparse
import serial
import threading
import json
import asyncio
import websockets
import os
import re
from collections import deque
from datetime import datetime
from serial.tools import list_ports

# Config file path
CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config", "radio_config.json")


def load_radio_config():
    """Load radio configuration from JSON file."""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                config = json.load(f)
                print(f"[CONFIG] Loaded radio configuration from {CONFIG_FILE}")
                return config
        except Exception as e:
            print(f"[WARN] Failed to load radio config: {e}")
    return None


class DroneCommandSender:
    """
    Dual-drone command sender via 433MHz radio.
    
    Manages two independent radio links:
      - VTOL Scout on COM17 (WebSocket 8765)
      - Delivery Drone on COM19 (WebSocket 8766)
    
    Each drone has COMPLETELY INDEPENDENT logs via separate WebSocket servers.
    """
    
    def __init__(self, vtol_port, baud, delivery_port=None, delivery_baud=None):
        # === VTOL (Scout) Serial Port - COM17 ===
        self.vtol_port = vtol_port
        self.vtol_baud = baud
        self.vtol_serial = None
        self.vtol_connected = False
        
        # === Delivery Drone Serial Port - COM19 ===
        self.delivery_port = delivery_port
        self.delivery_baud = delivery_baud or baud
        self.delivery_serial = None
        self.delivery_connected = False
        
        # === VTOL WebSocket (port 8765) - INDEPENDENT LOG STREAM ===
        self.vtol_ws_clients = set()
        self.vtol_ws_loop = None
        self.vtol_ws_thread = None
        
        # === Delivery WebSocket (port 8766) - INDEPENDENT LOG STREAM ===
        self.delivery_ws_clients = set()
        self.delivery_ws_loop = None
        self.delivery_ws_thread = None
        
        # === General State ===
        self.running = False
        self.demo_mode = False
        self.vtol_receive_thread = None
        self.delivery_receive_thread = None
        
        # === Detection Queue ===
        self.detection_queue = deque(maxlen=100)
        self.detection_queue_lock = threading.Lock()
        
        # === Mission State ===
        self.mission_active = False
        self.vtol_mission_complete = False  # RTL only when this is True
        
    def connect(self):
        """Connect to both VTOL and Delivery drone radios via 433MHz."""
        vtol_ok = False
        delivery_ok = False
        
        # === Connect to VTOL (COM17) ===
        if self.vtol_port and self.vtol_port != "DEMO":
            print(f"\n[VTOL] Connecting to VTOL radio on {self.vtol_port} @ {self.vtol_baud}...")
            try:
                self.vtol_serial = serial.Serial(
                    port=self.vtol_port,
                    baudrate=self.vtol_baud,
                    timeout=0.1
                )
                print(f"[VTOL] ✅ Connected to VTOL radio on {self.vtol_port}")
                vtol_ok = True
                self.vtol_connected = True
            except Exception as e:
                print(f"[VTOL] ❌ Failed to connect: {e}")
                self.vtol_serial = None
        
        # === Connect to Delivery Drone (COM19) ===
        if self.delivery_port and self.delivery_port != "DEMO":
            print(f"\n[DELIVERY] Connecting to Delivery radio on {self.delivery_port} @ {self.delivery_baud}...")
            try:
                self.delivery_serial = serial.Serial(
                    port=self.delivery_port,
                    baudrate=self.delivery_baud,
                    timeout=0.1
                )
                print(f"[DELIVERY] ✅ Connected to Delivery radio on {self.delivery_port}")
                delivery_ok = True
                self.delivery_connected = True
            except Exception as e:
                print(f"[DELIVERY] ❌ Failed to connect: {e}")
                self.delivery_serial = None
        
        # Print connection summary
        print(f"\n" + "=" * 60)
        print(f"  📡 DUAL RADIO CONNECTION STATUS (433MHz)")
        print(f"=" * 60)
        print(f"  VTOL Scout:     {'✅ ' + self.vtol_port + ' → ws://localhost:8765' if vtol_ok else '❌ Not connected'}")
        print(f"  Delivery Drone: {'✅ ' + self.delivery_port + ' → ws://localhost:8766' if delivery_ok else '❌ Not connected'}")
        print(f"=" * 60)
        print(f"\n  Data Flow:")
        print(f"    VTOL ({self.vtol_port}) → [detections] → GCS → [GOTO] → Delivery ({self.delivery_port})")
        print(f"=" * 60 + "\n")
        
        return vtol_ok or delivery_ok or self.demo_mode
    
    # ==========================================
    # VTOL WEBSOCKET (Port 8765) - INDEPENDENT
    # ==========================================
    
    async def vtol_websocket_handler(self, websocket):
        """Handle WebSocket connections for VTOL drone ONLY."""
        self.vtol_ws_clients.add(websocket)
        print(f"[VTOL_WS] Client connected. Total: {len(self.vtol_ws_clients)}")
        
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    if data.get("action") == "command":
                        cmd = data.get("command", "")
                        print(f"[VTOL_WS] Command from frontend: {cmd}")
                        self.send_vtol_command(cmd)
                    elif data.get("action") == "terminal_command":
                        # Direct terminal command for VTOL
                        cmd = data.get("command", "")
                        if cmd:
                            print(f"[VTOL_WS] Terminal command: {cmd}")
                            self.send_vtol_command(cmd)
                except json.JSONDecodeError:
                    # Plain text command
                    cmd = message.strip()
                    if cmd:
                        self.send_vtol_command(cmd)
                except Exception as e:
                    print(f"[VTOL_WS_ERROR] {e}")
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.vtol_ws_clients.discard(websocket)
            print(f"[VTOL_WS] Client disconnected. Total: {len(self.vtol_ws_clients)}")
    
    def start_vtol_websocket_server(self, host="0.0.0.0", port=8765):
        """Start VTOL WebSocket server on port 8765."""
        def run_server():
            self.vtol_ws_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self.vtol_ws_loop)
            
            async def start_and_serve():
                async with websockets.serve(self.vtol_websocket_handler, host, port):
                    print(f"[VTOL_WS] WebSocket server started on ws://{host}:{port}")
                    await asyncio.Event().wait()
            
            self.vtol_ws_loop.run_until_complete(start_and_serve())
        
        self.vtol_ws_thread = threading.Thread(target=run_server, daemon=True)
        self.vtol_ws_thread.start()
    
    def broadcast_vtol_log(self, message: str, level: str = "INFO"):
        """Broadcast log to VTOL WebSocket clients ONLY."""
        log_entry = {
            "action": "log",
            "data": {
                "time": datetime.now().strftime("%H:%M:%S"),
                "source": "VTOL",
                "level": level,
                "message": message
            }
        }
        
        if not self.vtol_ws_loop:
            return
        
        for client in list(self.vtol_ws_clients):
            try:
                asyncio.run_coroutine_threadsafe(
                    client.send(json.dumps(log_entry)),
                    self.vtol_ws_loop
                )
            except:
                self.vtol_ws_clients.discard(client)
    
    def broadcast_vtol_telemetry(self, telemetry_data: dict):
        """Broadcast telemetry to VTOL WebSocket clients ONLY."""
        telemetry_message = {
            "action": "telemetry",
            "data": telemetry_data
        }
        
        if not self.vtol_ws_loop:
            return
        
        for client in list(self.vtol_ws_clients):
            try:
                asyncio.run_coroutine_threadsafe(
                    client.send(json.dumps(telemetry_message)),
                    self.vtol_ws_loop
                )
            except:
                self.vtol_ws_clients.discard(client)
    
    # ==========================================
    # DELIVERY WEBSOCKET (Port 8766) - INDEPENDENT
    # ==========================================
    
    async def delivery_websocket_handler(self, websocket):
        """Handle WebSocket connections for Delivery drone ONLY."""
        self.delivery_ws_clients.add(websocket)
        print(f"[DELIVERY_WS] Client connected. Total: {len(self.delivery_ws_clients)}")
        
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    if data.get("action") == "command":
                        cmd = data.get("command", "")
                        print(f"[DELIVERY_WS] Command from frontend: {cmd}")
                        self.send_delivery_command(cmd)
                    elif data.get("action") == "terminal_command":
                        # Direct terminal command for Delivery drone
                        cmd = data.get("command", "")
                        if cmd:
                            print(f"[DELIVERY_WS] Terminal command: {cmd}")
                            self.send_delivery_command(cmd)
                except json.JSONDecodeError:
                    cmd = message.strip()
                    if cmd:
                        self.send_delivery_command(cmd)
                except Exception as e:
                    print(f"[DELIVERY_WS_ERROR] {e}")
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.delivery_ws_clients.discard(websocket)
            print(f"[DELIVERY_WS] Client disconnected. Total: {len(self.delivery_ws_clients)}")
    
    def start_delivery_websocket_server(self, host="0.0.0.0", port=8766):
        """Start Delivery WebSocket server on port 8766."""
        def run_server():
            self.delivery_ws_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self.delivery_ws_loop)
            
            async def start_and_serve():
                async with websockets.serve(self.delivery_websocket_handler, host, port):
                    print(f"[DELIVERY_WS] WebSocket server started on ws://{host}:{port}")
                    await asyncio.Event().wait()
            
            self.delivery_ws_loop.run_until_complete(start_and_serve())
        
        self.delivery_ws_thread = threading.Thread(target=run_server, daemon=True)
        self.delivery_ws_thread.start()
    
    def broadcast_delivery_log(self, message: str, level: str = "INFO"):
        """Broadcast log to Delivery WebSocket clients ONLY."""
        log_entry = {
            "action": "log",
            "data": {
                "time": datetime.now().strftime("%H:%M:%S"),
                "source": "DRONE",
                "level": level,
                "message": message
            }
        }
        
        if not self.delivery_ws_loop:
            return
        
        for client in list(self.delivery_ws_clients):
            try:
                asyncio.run_coroutine_threadsafe(
                    client.send(json.dumps(log_entry)),
                    self.delivery_ws_loop
                )
            except:
                self.delivery_ws_clients.discard(client)
    
    def broadcast_delivery_telemetry(self, telemetry_data: dict):
        """Broadcast telemetry to Delivery WebSocket clients ONLY."""
        telemetry_message = {
            "action": "telemetry",
            "data": telemetry_data
        }
        
        if not self.delivery_ws_loop:
            return
        
        for client in list(self.delivery_ws_clients):
            try:
                asyncio.run_coroutine_threadsafe(
                    client.send(json.dumps(telemetry_message)),
                    self.delivery_ws_loop
                )
            except:
                self.delivery_ws_clients.discard(client)
    
    def broadcast_reload_timer(self, seconds: int, status: str):
        """Broadcast reload timer to Delivery WebSocket."""
        timer_message = {
            "action": "reload_timer",
            "data": {
                "seconds": seconds,
                "status": status,
                "timestamp": datetime.now().isoformat()
            }
        }
        
        if not self.delivery_ws_loop:
            return
        
        for client in list(self.delivery_ws_clients):
            try:
                asyncio.run_coroutine_threadsafe(
                    client.send(json.dumps(timer_message)),
                    self.delivery_ws_loop
                )
            except:
                self.delivery_ws_clients.discard(client)
    
    # ==========================================
    # SERIAL COMMUNICATION
    # ==========================================
    
    def send_vtol_command(self, cmd: str):
        """Send command to VTOL drone via COM17."""
        cmd = cmd.strip()
        if not cmd:
            return
        
        print(f"[VTOL_TX] >> {cmd}")
        self.broadcast_vtol_log(f"TX: {cmd}", "INFO")
        
        if self.demo_mode:
            self._simulate_vtol_response(cmd)
            return
        
        if self.vtol_serial and self.vtol_serial.is_open:
            try:
                self.vtol_serial.write(f"{cmd}\n".encode('utf-8'))
            except Exception as e:
                print(f"[VTOL_TX] ❌ Error: {e}")
    
    def send_delivery_command(self, cmd: str):
        """Send command to Delivery drone via COM19."""
        cmd = cmd.strip()
        if not cmd:
            return
        
        print(f"[DELIVERY_TX] >> {cmd}")
        self.broadcast_delivery_log(f"TX: {cmd}", "INFO")
        
        if self.demo_mode:
            self._simulate_delivery_response(cmd)
            return
        
        if self.delivery_serial and self.delivery_serial.is_open:
            try:
                self.delivery_serial.write(f"{cmd}\n".encode('utf-8'))
            except Exception as e:
                print(f"[DELIVERY_TX] ❌ Error: {e}")
    
    def receive_vtol_responses(self):
        """Background thread to receive responses from VTOL (COM17)."""
        buffer = ""
        
        while self.running:
            try:
                if self.vtol_serial and self.vtol_serial.is_open and self.vtol_serial.in_waiting > 0:
                    chunk = self.vtol_serial.read(self.vtol_serial.in_waiting).decode('utf-8', errors='ignore')
                    buffer += chunk
                    
                    while '\n' in buffer:
                        line, buffer = buffer.split('\n', 1)
                        data = line.strip()
                        if data:
                            self._process_vtol_data(data)
            except Exception as e:
                print(f"[VTOL_RX_ERROR] {e}")
            time.sleep(0.02)
    
    def receive_delivery_responses(self):
        """Background thread to receive responses from Delivery drone (COM19)."""
        buffer = ""
        
        while self.running:
            try:
                if self.delivery_serial and self.delivery_serial.is_open and self.delivery_serial.in_waiting > 0:
                    chunk = self.delivery_serial.read(self.delivery_serial.in_waiting).decode('utf-8', errors='ignore')
                    buffer += chunk
                    
                    while '\n' in buffer:
                        line, buffer = buffer.split('\n', 1)
                        data = line.strip()
                        if data:
                            self._process_delivery_data(data)
            except Exception as e:
                print(f"[DELIVERY_RX_ERROR] {e}")
            time.sleep(0.02)
    
    def _process_vtol_data(self, data: str):
        """Process data received from VTOL drone - ONLY to VTOL WebSocket."""
        level = "INFO"
        if "[ERROR]" in data or "[CRIT]" in data:
            level = "ERROR"
        elif "[WARN]" in data:
            level = "WARN"
        
        # Broadcast to VTOL WebSocket ONLY
        self.broadcast_vtol_log(data, level)
        
        # Parse telemetry
        telemetry = self._parse_telemetry(data, "vtol")
        if telemetry:
            self.broadcast_vtol_telemetry(telemetry)
        
        # Check for human detection
        self._check_human_detection(data)
        
        # Check for mission complete (triggers RTL)
        self._check_mission_complete(data)
        
        # Console output
        if "PONG" in data or "OK" in data:
            print(f"\n  [VTOL] ✅ {data}")
        elif "HUMAN DETECTED" in data:
            print(f"\n  [VTOL] 🚨 {data}")
        elif "ERROR" in data:
            print(f"\n  [VTOL] ❌ {data}")
        elif "MISSION COMPLETE" in data or "KML COMPLETE" in data:
            print(f"\n  [VTOL] 🏁 {data}")
        else:
            print(f"\n  [VTOL] >> {data}")
        print("CMD> ", end='', flush=True)
    
    def _process_delivery_data(self, data: str):
        """Process data received from Delivery drone - ONLY to Delivery WebSocket."""
        level = "INFO"
        if "[ERROR]" in data or "[CRIT]" in data:
            level = "ERROR"
        elif "[WARN]" in data:
            level = "WARN"
        
        # Broadcast to Delivery WebSocket ONLY
        self.broadcast_delivery_log(data, level)
        
        # Parse telemetry
        telemetry = self._parse_telemetry(data, "delivery")
        if telemetry:
            self.broadcast_delivery_telemetry(telemetry)
        
        # Console output
        if "PONG" in data or "OK" in data:
            print(f"\n  [DELIVERY] ✅ {data}")
        elif "ERROR" in data:
            print(f"\n  [DELIVERY] ❌ {data}")
        else:
            print(f"\n  [DELIVERY] >> {data}")
        print("CMD> ", end='', flush=True)
    
    def _check_mission_complete(self, data: str):
        """
        Check if VTOL mission is complete - triggers RTL.
        
        IMPORTANT: VTOL RTL happens ONLY when the KML survey mission is complete,
        NOT on a timer. This is checked by looking for mission complete messages.
        """
        # Look for mission complete indicators
        mission_complete_indicators = [
            "MISSION COMPLETE",
            "KML COMPLETE",
            "SURVEY COMPLETE",
            "AUTO MODE COMPLETE",
            "REACHED FINAL WAYPOINT",
            "Mission finished"
        ]
        
        data_upper = data.upper()
        for indicator in mission_complete_indicators:
            if indicator.upper() in data_upper:
                self.vtol_mission_complete = True
                print(f"\n[VTOL] 🏁 Mission complete detected!")
                self.broadcast_vtol_log("🏁 KML survey mission complete - initiating RTL", "INFO")
                
                # Trigger VTOL RTL
                def do_rtl():
                    time.sleep(2)  # Brief delay
                    self.send_vtol_command("RTL")
                    self.broadcast_vtol_log("VTOL returning to launch", "INFO")
                
                threading.Thread(target=do_rtl, daemon=True).start()
                break
    
    def _parse_telemetry(self, data: str, drone_type: str) -> dict:
        """Parse telemetry data from drone response."""
        telemetry = {}
        prefix = "vtol" if drone_type == "vtol" else "drone"
        
        try:
            # Parse GPS
            if "GPS:" in data:
                gps_str = data.split("GPS:")[1].split()[0]
                parts = gps_str.split(",")
                if len(parts) >= 3:
                    telemetry[f"{prefix}Gps"] = {
                        "lat": float(parts[0]),
                        "lon": float(parts[1]),
                        "alt": float(parts[2])
                    }
            
            # Parse altitude
            if "ALT:" in data:
                alt_str = data.split("ALT:")[1].split()[0].rstrip(",")
                telemetry["altitude"] = float(alt_str)
            
            # Parse speed
            if "SPEED:" in data:
                speed_str = data.split("SPEED:")[1].split()[0].rstrip(",")
                telemetry["speed"] = float(speed_str)
            
            # Parse heading
            if "HEADING:" in data:
                heading_str = data.split("HEADING:")[1].split()[0].rstrip(",")
                telemetry["heading"] = float(heading_str)
            
            # Parse pitch/roll
            if "PITCH:" in data:
                pitch_str = data.split("PITCH:")[1].split()[0].rstrip(",")
                telemetry["pitch"] = float(pitch_str)
            
            if "ROLL:" in data:
                roll_str = data.split("ROLL:")[1].split()[0].rstrip(",")
                telemetry["roll"] = float(roll_str)
            
            # Parse battery
            if "BATT:" in data:
                batt_str = data.split("BATT:")[1].split()[0]
                parts = batt_str.split(",")
                if len(parts) >= 1:
                    telemetry["batteryVoltage"] = float(parts[0])
                if len(parts) >= 3:
                    telemetry["batteryPercent"] = float(parts[2])
            
            # Parse armed status
            if "ARMED" in data and "DISARMED" not in data:
                telemetry[f"{prefix}Armed"] = True
            elif "DISARMED" in data:
                telemetry[f"{prefix}Armed"] = False
            
        except Exception:
            pass
        
        return telemetry if telemetry else None
    
    def _check_human_detection(self, data: str):
        """Check for human detection in VTOL data and add to queue."""
        # Format: HUMAN DETECTED: {count} person(s), conf={conf}, loc={lat},{lon},{alt}m
        match = re.search(
            r'HUMAN DETECTED:\s*(\d+)\s*person\(s\),\s*conf=([0-9.]+),\s*loc=([0-9.-]+),([0-9.-]+),([0-9.]+)m',
            data
        )
        
        if match:
            detection = {
                "count": int(match.group(1)),
                "confidence": float(match.group(2)),
                "lat": float(match.group(3)),
                "lon": float(match.group(4)),
                "alt": float(match.group(5)),
                "timestamp": datetime.now().isoformat(),
                "dispatched": False
            }
            
            with self.detection_queue_lock:
                # Check for duplicates within 10m
                if not self._is_duplicate_detection(detection["lat"], detection["lon"]):
                    self.detection_queue.append(detection)
                    print(f"\n[QUEUE] ✅ Added detection: {detection['lat']:.6f}, {detection['lon']:.6f}")
                    print(f"[QUEUE] Queue size: {len(self.detection_queue)}")
                    
                    # Broadcast detection event to BOTH WebSockets
                    self._broadcast_detection_event(detection)
    
    def _is_duplicate_detection(self, lat: float, lon: float, radius_m: float = 10.0) -> bool:
        """Check if detection is duplicate (within radius of existing)."""
        from math import radians, sin, cos, sqrt, atan2
        
        for det in self.detection_queue:
            R = 6371000  # Earth radius in meters
            lat1, lon1 = radians(det["lat"]), radians(det["lon"])
            lat2, lon2 = radians(lat), radians(lon)
            
            dlat = lat2 - lat1
            dlon = lon2 - lon1
            
            a = sin(dlat/2)**2 + cos(lat1) * cos(lat2) * sin(dlon/2)**2
            c = 2 * atan2(sqrt(a), sqrt(1-a))
            distance = R * c
            
            if distance < radius_m:
                return True
        return False
    
    def _broadcast_detection_event(self, detection: dict):
        """Broadcast detection event to both WebSockets."""
        event = {
            "action": "detection",
            "event": "human_detected",
            "data": detection
        }
        
        # Broadcast to VTOL (source of detection)
        if self.vtol_ws_loop:
            for client in list(self.vtol_ws_clients):
                try:
                    asyncio.run_coroutine_threadsafe(
                        client.send(json.dumps(event)),
                        self.vtol_ws_loop
                    )
                except:
                    pass
        
        # Also broadcast to Delivery (needs to know about targets)
        if self.delivery_ws_loop:
            for client in list(self.delivery_ws_clients):
                try:
                    asyncio.run_coroutine_threadsafe(
                        client.send(json.dumps(event)),
                        self.delivery_ws_loop
                    )
                except:
                    pass
    
    # ==========================================
    # DEMO MODE SIMULATION
    # ==========================================
    
    def _simulate_vtol_response(self, cmd: str):
        """Simulate VTOL response in demo mode."""
        cmd_upper = cmd.upper()
        
        def delayed_response(msg, delay=0.5):
            def _send():
                time.sleep(delay)
                self.broadcast_vtol_log(msg, "INFO")
                print(f"\n  [VTOL] >> {msg}")
                print("CMD> ", end='', flush=True)
            threading.Thread(target=_send, daemon=True).start()
        
        if cmd_upper == "PING":
            delayed_response("PONG - VTOL connection OK")
        elif cmd_upper == "ARM":
            delayed_response("ARMED - VTOL motors ready")
        elif cmd_upper.startswith("TAKEOFF"):
            alt = cmd.split(":")[1] if ":" in cmd else "10"
            delayed_response(f"TAKEOFF - Ascending to {alt}m")
        elif cmd_upper == "RTL":
            delayed_response("RTL - Returning to launch")
        elif cmd_upper == "LAND":
            delayed_response("LANDING - Descending")
        elif cmd_upper.startswith("KML"):
            delayed_response("KML boundary received, mission uploaded")
        elif cmd_upper == "MODE:AUTO":
            delayed_response("MODE AUTO - Starting survey mission")
            # Simulate mission complete after 30 seconds
            def sim_mission():
                time.sleep(30)
                if self.demo_mode and self.running:
                    self._check_mission_complete("MISSION COMPLETE")
            threading.Thread(target=sim_mission, daemon=True).start()
        else:
            delayed_response(f"ACK: {cmd}")
    
    def _simulate_delivery_response(self, cmd: str):
        """Simulate Delivery drone response in demo mode."""
        cmd_upper = cmd.upper()
        
        def delayed_response(msg, delay=0.5):
            def _send():
                time.sleep(delay)
                self.broadcast_delivery_log(msg, "INFO")
                print(f"\n  [DELIVERY] >> {msg}")
                print("CMD> ", end='', flush=True)
            threading.Thread(target=_send, daemon=True).start()
        
        if cmd_upper == "PING":
            delayed_response("PONG - Delivery drone connection OK")
        elif cmd_upper == "ARM":
            delayed_response("ARMED - Delivery drone ready")
        elif cmd_upper.startswith("TAKEOFF"):
            alt = cmd.split(":")[1] if ":" in cmd else "10"
            delayed_response(f"TAKEOFF - Ascending to {alt}m")
        elif cmd_upper.startswith("GOTO"):
            delayed_response(f"NAVIGATING - {cmd}")
        elif cmd_upper == "DELIVER":
            delayed_response("DELIVERING - Payload released")
        elif cmd_upper == "RTL":
            delayed_response("RTL - Returning to launch")
        else:
            delayed_response(f"ACK: {cmd}")
    
    def start_demo_telemetry(self):
        """Start demo telemetry simulation for both drones."""
        import math
        import random
        
        def simulate():
            start_time = time.time()
            vtol_lat, vtol_lon = 28.5450, 77.1920
            delivery_lat, delivery_lon = 28.5445, 77.1915
            
            while self.running:
                elapsed = time.time() - start_time
                
                # VTOL telemetry - to VTOL WebSocket ONLY
                vtol_telemetry = {
                    "vtolGps": {
                        "lat": vtol_lat + 0.0001 * math.sin(elapsed * 0.1),
                        "lon": vtol_lon + 0.0001 * math.cos(elapsed * 0.1),
                        "alt": 15.0 + math.sin(elapsed * 0.2)
                    },
                    "pitch": 3.0 * math.sin(elapsed * 0.5),
                    "roll": 2.0 * math.sin(elapsed * 0.7),
                    "heading": (elapsed * 5) % 360,
                    "speed": 8.0 + random.uniform(-1, 1),
                    "batteryPercent": max(0, 100 - elapsed * 0.1),
                    "vtolArmed": True
                }
                self.broadcast_vtol_telemetry(vtol_telemetry)
                
                # Delivery telemetry - to Delivery WebSocket ONLY
                delivery_telemetry = {
                    "droneGps": {
                        "lat": delivery_lat + 0.00005 * math.sin(elapsed * 0.15),
                        "lon": delivery_lon + 0.00005 * math.cos(elapsed * 0.15),
                        "alt": 10.0 + 0.5 * math.sin(elapsed * 0.3)
                    },
                    "pitch": 2.0 * math.sin(elapsed * 0.4),
                    "roll": 1.5 * math.sin(elapsed * 0.6),
                    "heading": (elapsed * 3) % 360,
                    "speed": 5.0 + random.uniform(-0.5, 0.5),
                    "batteryPercent": max(0, 95 - elapsed * 0.08),
                    "droneArmed": True
                }
                self.broadcast_delivery_telemetry(delivery_telemetry)
                
                # Simulate human detection every 20 seconds
                if int(elapsed) % 20 == 0 and int(elapsed) > 0:
                    det_lat = 28.5450 + random.uniform(-0.001, 0.001)
                    det_lon = 77.1920 + random.uniform(-0.001, 0.001)
                    detection_msg = f"HUMAN DETECTED: 1 person(s), conf=0.92, loc={det_lat:.6f},{det_lon:.6f},15.0m"
                    self._check_human_detection(detection_msg)
                    self.broadcast_vtol_log(f"🚨 {detection_msg}", "WARN")
                
                time.sleep(0.1)
        
        threading.Thread(target=simulate, daemon=True).start()
    
    # ==========================================
    # INTERACTIVE COMMAND LOOP
    # ==========================================
    
    def run_interactive(self):
        """Run interactive command mode."""
        print("\n" + "=" * 60)
        print("  NIDAR GROUND CONTROL STATION")
        print("  Dual Drone Command System via 433MHz Radio")
        print("=" * 60)
        
        # Start both WebSocket servers
        self.start_vtol_websocket_server(host="0.0.0.0", port=8765)
        time.sleep(0.5)
        self.start_delivery_websocket_server(host="0.0.0.0", port=8766)
        
        print("\n📡 WebSocket Servers (INDEPENDENT LOGS):")
        print(f"  VTOL:     ws://localhost:8765 ← only VTOL logs")
        print(f"  Delivery: ws://localhost:8766 ← only Delivery logs")
        
        if self.demo_mode:
            print("\n🎮 DEMO MODE - Starting telemetry simulation...")
            self.start_demo_telemetry()
        
        print("\n" + "-" * 60)
        print("Commands (prefix with V: or D: for specific drone):")
        print("  V:PING          - Ping VTOL")
        print("  D:ARM           - Arm Delivery drone")
        print("  V:TAKEOFF:10    - VTOL takeoff to 10m")
        print("  D:GOTO:lat,lon,alt - Send Delivery to location")
        print("  QUEUE           - Show detection queue")
        print("  HELP            - Show all commands")
        print("  QUIT            - Exit")
        print("-" * 60)
        
        self.running = True
        
        # Start receive threads
        if self.vtol_serial:
            self.vtol_receive_thread = threading.Thread(
                target=self.receive_vtol_responses, daemon=True
            )
            self.vtol_receive_thread.start()
        
        if self.delivery_serial:
            self.delivery_receive_thread = threading.Thread(
                target=self.receive_delivery_responses, daemon=True
            )
            self.delivery_receive_thread.start()
        
        try:
            while self.running:
                try:
                    cmd_raw = input("CMD> ").strip()
                    cmd = cmd_raw.upper()
                    
                    if not cmd:
                        continue
                    
                    if cmd in ["QUIT", "EXIT", "Q"]:
                        print("Exiting...")
                        break
                    
                    if cmd in ["HELP", "?"]:
                        self.show_help()
                        continue
                    
                    if cmd == "QUEUE":
                        self._show_queue_status()
                        continue
                    
                    # Route command to specific drone
                    if cmd.startswith("V:"):
                        self.send_vtol_command(cmd_raw[2:])
                    elif cmd.startswith("D:"):
                        self.send_delivery_command(cmd_raw[2:])
                    else:
                        # Default to VTOL
                        print("[INFO] No prefix - sending to VTOL (use D: for Delivery)")
                        self.send_vtol_command(cmd_raw)
                    
                except EOFError:
                    break
                    
        except KeyboardInterrupt:
            print("\n[INFO] Interrupted")
        
        self.running = False
        if self.vtol_serial:
            self.vtol_serial.close()
        if self.delivery_serial:
            self.delivery_serial.close()
        print("[INFO] Disconnected")
    
    def _show_queue_status(self):
        """Show detection queue status."""
        with self.detection_queue_lock:
            total = len(self.detection_queue)
            pending = sum(1 for d in self.detection_queue if not d.get("dispatched"))
            dispatched = total - pending
        
        print(f"\n[QUEUE STATUS]")
        print(f"  Total detections: {total}")
        print(f"  Pending delivery: {pending}")
        print(f"  Dispatched:       {dispatched}")
        
        if total > 0:
            print(f"\n  Recent detections:")
            for i, det in enumerate(list(self.detection_queue)[-5:]):
                status = "✅" if det.get("dispatched") else "⏳"
                print(f"    {status} {det['lat']:.6f}, {det['lon']:.6f} (conf: {det['confidence']})")
    
    def show_help(self):
        """Show help message."""
        print("""
NIDAR GCS Commands (433MHz Radio System):
==========================================

=== VTOL COMMANDS (prefix V:) - via ws://localhost:8765 ===
  V:PING            - Test VTOL connection
  V:ARM             - Arm VTOL motors
  V:DISARM          - Disarm VTOL motors
  V:TAKEOFF:15      - VTOL takeoff to 15m
  V:RTL             - VTOL return to launch (only use when mission complete)
  V:LAND            - VTOL land immediately
  V:MODE:AUTO       - Start autonomous KML survey mission
  V:KML:file        - Upload KML boundary for scout mission

=== DELIVERY COMMANDS (prefix D:) - via ws://localhost:8766 ===
  D:PING            - Test Delivery drone connection
  D:ARM             - Arm Delivery drone
  D:DISARM          - Disarm Delivery drone
  D:TAKEOFF:10      - Delivery takeoff to 10m
  D:GOTO:lat,lon,alt- Go to location
  D:DELIVER         - Execute delivery at current location
  D:RTL             - Return to launch
  D:LAND            - Land immediately

=== QUEUE & STATUS ===
  QUEUE             - Show detection queue status
  STATUS            - Get system status

=== GENERAL ===
  HELP              - Show this help
  QUIT              - Exit program

=== IMPORTANT NOTES ===
  - Radio Frequency: 433MHz
  - VTOL RTL: Automatic when KML mission is complete (NOT on timer)
  - Each drone has INDEPENDENT WebSocket & logs:
      VTOL:     ws://localhost:8765 ← only VTOL logs
      Delivery: ws://localhost:8766 ← only Delivery logs
  - Human detections from VTOL are queued for Delivery drone dispatch
""")


def main():
    parser = argparse.ArgumentParser(description='NIDAR GCS - Dual Drone Command via 433MHz Radio')
    parser.add_argument('--port', default=None,
                       help='VTOL serial port (default: from config or COM17)')
    parser.add_argument('--delivery-port', default=None,
                       help='Delivery drone serial port (default: from config or COM19)')
    parser.add_argument('--baud', type=int, default=57600,
                       help='Baud rate (default: 57600)')
    parser.add_argument('--demo', action='store_true',
                       help='Run in demo mode without hardware')
    args = parser.parse_args()
    
    # Demo mode
    if args.demo:
        print("[INFO] Running in DEMO mode - no hardware required")
        sender = DroneCommandSender(
            vtol_port="DEMO",
            baud=args.baud,
            delivery_port="DEMO"
        )
        sender.demo_mode = True
        sender.run_interactive()
        return
    
    # Load config
    vtol_port = args.port
    delivery_port = args.delivery_port
    baud = args.baud
    
    config = load_radio_config()
    if config:
        if not vtol_port and "vtol" in config:
            vtol_port = config["vtol"].get("port", "COM17")
            baud = config["vtol"].get("baud", 57600)
        if not delivery_port and "delivery" in config:
            delivery_port = config["delivery"].get("port", "COM19")
        
        print(f"\n" + "=" * 60)
        print(f"  📋 RADIO CONFIGURATION (433MHz)")
        print(f"=" * 60)
        print(f"  VTOL Port:     {vtol_port} → ws://localhost:8765")
        print(f"  Delivery Port: {delivery_port} → ws://localhost:8766")
        print(f"  Baud Rate:     {baud}")
        print(f"  Frequency:     433 MHz")
        print(f"=" * 60)
    else:
        vtol_port = vtol_port or "COM17"
        delivery_port = delivery_port or "COM19"
        print(f"[WARN] No config file, using defaults: VTOL={vtol_port}, Delivery={delivery_port}")
    
    # Create and connect
    sender = DroneCommandSender(
        vtol_port=vtol_port,
        baud=baud,
        delivery_port=delivery_port,
        delivery_baud=baud
    )
    
    if not sender.connect():
        print(f"\n[ERROR] Failed to connect to radios")
        print("[TIP] Check that:")
        print("  1. Both 433MHz radios are connected")
        print("  2. No other program is using the ports")
        print(f"  3. VTOL on {vtol_port}, Delivery on {delivery_port}")
        sys.exit(1)
    
    sender.run_interactive()


if __name__ == "__main__":
    main()
