#!/usr/bin/env python3
"""
NIDAR VTOL Scout Backend - Standalone
Handles ONLY the VTOL drone on COM17 → WebSocket 8765
"""

import sys
import os

# Add parent directory to path to import from tx.py
sys.path.insert(0, os.path.dirname(__file__))

import time
import serial
import threading
import json
import asyncio
import websockets
from datetime import datetime
from collections import deque
import re

class VTOLBackend:
    """Standalone VTOL Scout backend"""
    
    def __init__(self, port="COM17", baud=57600):
        self.port = port
        self.baud = baud
        self.serial = None
        self.connected = False
        
        # WebSocket
        self.ws_clients = set()
        self.ws_loop = None
        self.ws_thread = None
        
        # Detection queue
        self.detection_queue = deque(maxlen=100)
        self.detection_lock = threading.Lock()
        
        self.running = False
        self.receive_thread = None
        self.mission_complete = False
    
    def connect(self):
        """Connect to VTOL radio"""
        print(f"\n[VTOL] Connecting to {self.port} @ {self.baud}...")
        try:
            self.serial = serial.Serial(
                port=self.port,
                baudrate=self.baud,
                timeout=0.1
            )
            print(f"[VTOL] ✅ Connected to {self.port}")
            self.connected = True
            return True
        except Exception as e:
            print(f"[VTOL] ❌ Failed: {e}")
            return False
    
    async def websocket_handler(self, websocket):
        """Handle WebSocket connections"""
        self.ws_clients.add(websocket)
        print(f"[VTOL_WS] Client connected. Total: {len(self.ws_clients)}")
        
        try:
            async for message in websocket:
                try:
                    data = json.loads(message)
                    if data.get("action") == "command":
                        cmd = data.get("command", "")
                        print(f"[VTOL_WS] Command: {cmd}")
                        self.send_command(cmd)
                except json.JSONDecodeError:
                    cmd = message.strip()
                    if cmd:
                        self.send_command(cmd)
                except Exception as e:
                    print(f"[VTOL_WS_ERROR] {e}")
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.ws_clients.discard(websocket)
            print(f"[VTOL_WS] Client disconnected. Total: {len(self.ws_clients)}")
    
    def start_websocket_server(self, host="0.0.0.0", port=8765):
        """Start WebSocket server"""
        def run_server():
            self.ws_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self.ws_loop)
            
            async def start_and_serve():
                async with websockets.serve(self.websocket_handler, host, port):
                    print(f"[VTOL_WS] WebSocket server started on ws://{host}:{port}")
                    await asyncio.Event().wait()
            
            self.ws_loop.run_until_complete(start_and_serve())
        
        self.ws_thread = threading.Thread(target=run_server, daemon=True)
        self.ws_thread.start()
    
    def broadcast_log(self, message: str, level: str = "INFO"):
        """Broadcast log to WebSocket clients"""
        log_entry = {
            "action": "log",
            "data": {
                "time": datetime.now().strftime("%H:%M:%S"),
                "source": "VTOL",
                "level": level,
                "message": message
            }
        }
        
        if not self.ws_loop:
            return
        
        for client in list(self.ws_clients):
            try:
                asyncio.run_coroutine_threadsafe(
                    client.send(json.dumps(log_entry)),
                    self.ws_loop
                )
            except:
                self.ws_clients.discard(client)
    
    def send_command(self, cmd: str):
        """Send command to VTOL"""
        cmd = cmd.strip()
        if not cmd:
            return
        
        print(f"[VTOL_TX] >> {cmd}")
        self.broadcast_log(f"TX: {cmd}", "INFO")
        
        if self.serial and self.serial.is_open:
            try:
                self.serial.write(f"{cmd}\n".encode('utf-8'))
            except Exception as e:
                print(f"[VTOL_TX] ❌ Error: {e}")
    
    def receive_responses(self):
        """Background thread to receive responses"""
        buffer = ""
        
        while self.running:
            try:
                if self.serial and self.serial.is_open and self.serial.in_waiting > 0:
                    chunk = self.serial.read(self.serial.in_waiting).decode('utf-8', errors='ignore')
                    buffer += chunk
                    
                    while '\n' in buffer:
                        line, buffer = buffer.split('\n', 1)
                        data = line.strip()
                        if data:
                            self.process_data(data)
            except Exception as e:
                print(f"[VTOL_RX_ERROR] {e}")
            time.sleep(0.02)
    
    def process_data(self, data: str):
        """Process received data"""
        level = "INFO"
        if "[ERROR]" in data or "[CRIT]" in data:
            level = "ERROR"
        elif "[WARN]" in data:
            level = "WARN"
        
        self.broadcast_log(data, level)
        
        # Console output
        if "PONG" in data or "OK" in data:
            print(f"  [VTOL] ✅ {data}")
        elif "HUMAN DETECTED" in data:
            print(f"  [VTOL] 🚨 {data}")
        elif "ERROR" in data:
            print(f"  [VTOL] ❌ {data}")
        else:
            print(f"  [VTOL] >> {data}")
        print("CMD> ", end='', flush=True)
    
    def run_interactive(self):
        """Interactive command mode"""
        print("\n" + "="*60)
        print("  VTOL SCOUT TERMINAL")
        print("="*60)
        print("Commands: PING, ARM, TAKEOFF:X, MODE:AUTO, RTL, QUIT")
        print("="*60 + "\n")
        
        while self.running:
            try:
                cmd = input("CMD> ").strip()
                if cmd.upper() == "QUIT":
                    break
                if cmd:
                    self.send_command(cmd)
            except KeyboardInterrupt:
                break
            except EOFError:
                break
        
        print("\n[INFO] Shutting down VTOL backend...")
        self.running = False
    
    def start(self):
        """Start the backend"""
        if not self.connect():
            return
        
        self.running = True
        
        # Start WebSocket server
        self.start_websocket_server()
        time.sleep(0.5)
        
        # Start receive thread
        self.receive_thread = threading.Thread(target=self.receive_responses, daemon=True)
        self.receive_thread.start()
        
        # Run interactive mode
        self.run_interactive()
        
        # Cleanup
        if self.serial:
            self.serial.close()

if __name__ == "__main__":
    vtol = VTOLBackend(port="COM17", baud=57600)
    vtol.start()
