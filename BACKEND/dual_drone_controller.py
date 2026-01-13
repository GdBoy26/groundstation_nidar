#!/usr/bin/env python3
"""
Dual Drone Coordination System

Controls two drones via separate 3DR radios:
1. VTOL (Scout Drone) - Performs area survey and human detection
2. Delivery Drone - Responds to human detection events

The system coordinates missions with proper acknowledgment sequencing.

Usage:
    python3 dual_drone_controller.py
    python3 dual_drone_controller.py --vtol-port COM3 --delivery-port COM4
    python3 dual_drone_controller.py --demo  # Demo mode without hardware
"""

import sys
import time
import argparse
import serial
import threading
import json
import asyncio
import websockets
import queue
from queue import Queue 
import re
from datetime import datetime
from enum import Enum
from dataclasses import dataclass, field
from typing import Optional, Callable, List, Dict, Any
from serial.tools import list_ports
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

class DroneState(Enum):
    """Drone state machine states."""
    DISCONNECTED = "disconnected"
    CONNECTED = "connected"
    ARMED = "armed"
    FLYING = "flying"
    SCOUTING = "scouting"
    DELIVERING = "delivering"
    LANDING = "landing"
    LANDED = "landed"
    ERROR = "error"


# Add this after your imports and before the DroneState class

@dataclass
class DroneConfig:
    """Configuration for a drone connection."""
    name: str
    port: str
    baudrate: int = 57600
    timeout: float = 1.0

class CommandStatus(Enum):
    """Status of a sent command."""
    PENDING = "PENDING"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    TIMEOUT = "TIMEOUT"
    ERROR = "ERROR"


@dataclass
class HumanDetection:
    """Represents a human detection event."""
    latitude: float
    longitude: float
    timestamp: str
    confidence: float = 0.0
    
    def to_dict(self) -> dict:
        return {
            "latitude": self.latitude,
            "longitude": self.longitude,
            "timestamp": self.timestamp.isoformat(),
            "confidence": self.confidence
        }


@dataclass
class PendingCommand:
    """Tracks a pending command awaiting acknowledgment."""
    command: str
    sent_time: float
    timeout: float = 10.0
    expected_ack: List[str] = field(default_factory=list)
    status: CommandStatus = CommandStatus.PENDING
    response: str = ""


class DroneConnection:
    """Handles serial communication with a single drone."""
    
    def __init__(self, config: DroneConfig, on_message: Callable[[str], None]):
        self.config = config
        self.serial: Optional[serial.Serial] = None
        self.state = DroneState.DISCONNECTED
        self.on_message = on_message
        self.ack_queue = Queue()
        self.running = False
        self.read_thread: Optional[threading.Thread] = None
        self.logger = logging.getLogger(f"Drone-{config.name}")
        
    def connect(self) -> bool:
        """Establish serial connection."""
        try:
            self.serial = serial.Serial(
                port=self.config.port,
                baudrate=self.config.baudrate,
                timeout=self.config.timeout
            )
            self.running = True
            self.read_thread = threading.Thread(target=self._read_loop, daemon=True)
            self.read_thread.start()
            self.state = DroneState.CONNECTED
            self.logger.info(f"Connected to {self.config.port}")
            return True
        except serial.SerialException as e:
            self.logger.error(f"Connection failed: {e}")
            return False
    
    def disconnect(self):
        """Close serial connection."""
        self.running = False
        if self.read_thread:
            self.read_thread.join(timeout=2.0)
        if self.serial and self.serial.is_open:
            self.serial.close()
        self.state = DroneState.DISCONNECTED
        self.logger.info("Disconnected")
    
    def _read_loop(self):
        """Continuously read from serial port."""
        while self.running and self.serial and self.serial.is_open:
            try:
                if self.serial.in_waiting > 0:
                    line = self.serial.readline().decode('utf-8').strip()
                    if line:
                        self.logger.debug(f"Received: {line}")
                        self.on_message(line)
                        self.ack_queue.put(line)
                time.sleep(0.01)
            except Exception as e:
                self.logger.error(f"Read error: {e}")
                break
    
    def send_command(self, command: str) -> bool:
        """Send command to drone."""
        if not self.serial or not self.serial.is_open:
            self.logger.error("Not connected")
            return False
        try:
            self.serial.write(f"{command}\n".encode('utf-8'))
            self.logger.info(f"Sent: {command}")
            return True
        except Exception as e:
            self.logger.error(f"Send error: {e}")
            return False
    
    def wait_for_ack(self, expected: str, timeout: float = 10.0) -> bool:
        """Wait for specific acknowledgment."""
        start_time = time.time()
        while time.time() - start_time < timeout:
            try:
                msg = self.ack_queue.get(timeout=0.5)
                if expected in msg:
                    self.logger.info(f"Received ACK: {msg}")
                    return True
            except:
                continue
        self.logger.warning(f"Timeout waiting for: {expected}")
        return False
    
    def send_and_wait(self, command: str, expected_ack: str, timeout: float = 10.0) -> bool:
        """Send command and wait for acknowledgment."""
        # Clear queue before sending
        while not self.ack_queue.empty():
            self.ack_queue.get_nowait()
        
        if not self.send_command(command):
            return False
        return self.wait_for_ack(expected_ack, timeout)


class VTOLDrone:
    """VTOL Scout Drone controller."""
    
    def __init__(self, config: DroneConfig, on_detection: Callable[[HumanDetection], None]):
        self.on_detection = on_detection
        self.connection = DroneConnection(config, self._handle_message)
        self.logger = logging.getLogger("VTOL")
        self.is_scouting = False
        
    def _handle_message(self, message: str):
        """Process incoming messages from VTOL."""
        # Check for human detection message
        # Format: DETECTED:lat,lon,timestamp,confidence
        if message.startswith("DETECTED:"):
            try:
                parts = message[9:].split(",")
                detection = HumanDetection(
                    latitude=float(parts[0]),
                    longitude=float(parts[1]),
                    timestamp=parts[2] if len(parts) > 2 else datetime.now().isoformat(),
                    confidence=float(parts[3]) if len(parts) > 3 else 0.9
                )
                self.logger.info(f"Human detected at: {detection.latitude}, {detection.longitude}")
                self.on_detection(detection)
            except Exception as e:
                self.logger.error(f"Failed to parse detection: {e}")
    
    def connect(self) -> bool:
        return self.connection.connect()
    
    def disconnect(self):
        self.is_scouting = False
        self.connection.disconnect()
    
    def start_mission(self) -> bool:
        """Execute VTOL mission sequence."""
        self.logger.info("Starting VTOL mission sequence")
        
        # Step 1: PING -> wait for PONG
        self.logger.info("Step 1: PING")
        if not self.connection.send_and_wait("PING", "PONG", timeout=5.0):
            self.logger.error("PING failed")
            return False
        
        # Step 2: ARM -> wait for ACK
        self.logger.info("Step 2: ARM")
        if not self.connection.send_and_wait("ARM", "ACK:ARM", timeout=10.0):
            self.logger.error("ARM failed")
            return False
        self.connection.state = DroneState.ARMED
        
        # Step 3: TAKEOFF -> wait for ACK
        self.logger.info("Step 3: TAKEOFF")
        if not self.connection.send_and_wait("TAKEOFF", "ACK:TAKEOFF", timeout=15.0):
            self.logger.error("TAKEOFF failed")
            return False
        self.connection.state = DroneState.FLYING
        
        # Step 4: SCOUT -> start human detection
        self.logger.info("Step 4: SCOUT")
        if not self.connection.send_and_wait("SCOUT", "ACK:SCOUT", timeout=10.0):
            self.logger.error("SCOUT failed")
            return False
        self.is_scouting = True
        self.connection.state = DroneState.SCOUTING
        
        # Step 5: MODE:AUTO -> autonomous flight
        self.logger.info("Step 5: MODE:AUTO")
        if not self.connection.send_and_wait("MODE:AUTO", "ACK:MODE", timeout=10.0):
            self.logger.error("MODE:AUTO failed")
            return False
        
        self.logger.info("VTOL mission sequence complete - now scouting")
        return True
    
    def abort_mission(self) -> bool:
        """Abort current mission and return to launch."""
        self.is_scouting = False
        return self.connection.send_and_wait("RTL", "ACK:RTL", timeout=10.0)


class DeliveryDrone:
    """Delivery Drone controller."""
    
    def __init__(self, config: DroneConfig):
        self.connection = DroneConnection(config, self._handle_message)
        self.logger = logging.getLogger("Delivery")
        self.is_delivering = False
        self.current_target: Optional[HumanDetection] = None
        
    def _handle_message(self, message: str):
        """Process incoming messages from Delivery drone."""
        if message.startswith("STATUS:"):
            self.logger.info(f"Delivery status: {message}")
        elif message == "DELIVERED":
            self.logger.info("Delivery complete!")
            self.is_delivering = False
    
    def connect(self) -> bool:
        return self.connection.connect()
    
    def disconnect(self):
        self.is_delivering = False
        self.connection.disconnect()
    
    def deliver_to(self, detection: HumanDetection, altitude: float = 20.0) -> bool:
        """Execute delivery mission to detected human location."""
        self.logger.info(f"Starting delivery to: {detection.latitude}, {detection.longitude}")
        self.current_target = detection
        
        # Step 1: PING -> wait for PONG
        self.logger.info("Step 1: PING")
        if not self.connection.send_and_wait("PING", "PONG", timeout=5.0):
            self.logger.error("PING failed")
            return False
        
        # Step 2: ARM -> wait for ACK
        self.logger.info("Step 2: ARM")
        if not self.connection.send_and_wait("ARM", "ACK:ARM", timeout=10.0):
            self.logger.error("ARM failed")
            return False
        self.connection.state = DroneState.ARMED
        
        # Step 3: TAKEOFF -> wait for ACK
        self.logger.info("Step 3: TAKEOFF")
        if not self.connection.send_and_wait("TAKEOFF", "ACK:TAKEOFF", timeout=15.0):
            self.logger.error("TAKEOFF failed")
            return False
        self.connection.state = DroneState.FLYING
        
        # Step 4: GOTO -> navigate to detection coordinates
        self.logger.info("Step 4: GOTO target location")
        goto_cmd = f"GOTO:{detection.latitude},{detection.longitude},{altitude}"
        if not self.connection.send_and_wait(goto_cmd, "ACK:GOTO", timeout=10.0):
            self.logger.error("GOTO failed")
            return False
        
        self.is_delivering = True
        self.connection.state = DroneState.DELIVERING
        self.logger.info("Delivery mission started - en route to target")
        return True
    
    def abort_mission(self) -> bool:
        """Abort current mission and return to launch."""
        self.is_delivering = False
        self.current_target = None
        return self.connection.send_and_wait("RTL", "ACK:RTL", timeout=10.0)


class DualDroneController:
    """Main controller coordinating both drones."""
    
    def __init__(self, vtol_config: DroneConfig, delivery_config: DroneConfig):
        self.vtol = VTOLDrone(vtol_config, self._on_human_detected)
        self.delivery = DeliveryDrone(delivery_config)
        self.logger = logging.getLogger("DualDrone")
        self.detection_queue: Queue[HumanDetection] = Queue()
        self.auto_delivery = True
        self.running = False
        self.delivery_thread: Optional[threading.Thread] = None
        self.status_callbacks: list[Callable[[dict], None]] = []
        
    def add_status_callback(self, callback: Callable[[dict], None]):
        """Add callback for status updates."""
        self.status_callbacks.append(callback)
    
    def _broadcast_status(self, status: dict):
        """Broadcast status to all callbacks."""
        for callback in self.status_callbacks:
            try:
                callback(status)
            except Exception as e:
                self.logger.error(f"Status callback error: {e}")
    
    def _on_human_detected(self, detection: HumanDetection):
        """Handle human detection from VTOL."""
        self.logger.info(f"Human detected! Lat: {detection.latitude}, Lon: {detection.longitude}")
        self.detection_queue.put(detection)
        
        self._broadcast_status({
            "event": "human_detected",
            "latitude": detection.latitude,
            "longitude": detection.longitude,
            "timestamp": detection.timestamp,
            "confidence": detection.confidence
        })
        
        if self.auto_delivery and not self.delivery.is_delivering:
            threading.Thread(target=self._trigger_delivery, args=(detection,), daemon=True).start()
    
    def _trigger_delivery(self, detection: HumanDetection):
        """Trigger delivery drone to detected location."""
        self.logger.info("Triggering delivery drone")
        self._broadcast_status({"event": "delivery_started", "target": detection.__dict__})
        
        success = self.delivery.deliver_to(detection)
        if success:
            self._broadcast_status({"event": "delivery_en_route"})
        else:
            self._broadcast_status({"event": "delivery_failed"})
    
    def connect_all(self) -> bool:
        """Connect to both drones."""
        vtol_ok = self.vtol.connect()
        delivery_ok = self.delivery.connect()
        
        self._broadcast_status({
            "event": "connection_status",
            "vtol_connected": vtol_ok,
            "delivery_connected": delivery_ok
        })
        
        return vtol_ok and delivery_ok
    
    def disconnect_all(self):
        """Disconnect from both drones."""
        self.running = False
        self.vtol.disconnect()
        self.delivery.disconnect()
        self._broadcast_status({"event": "disconnected"})
    
    def start_mission(self) -> bool:
        """Start the complete dual-drone mission."""
        self.logger.info("Starting dual-drone mission")
        self.running = True
        
        # Start VTOL scouting mission
        if not self.vtol.start_mission():
            self.logger.error("Failed to start VTOL mission")
            self._broadcast_status({"event": "vtol_mission_failed"})
            return False
        
        self._broadcast_status({"event": "vtol_mission_started"})
        self.logger.info("VTOL mission started - awaiting human detection")
        return True
    
    def abort_all(self):
        """Abort all missions."""
        self.logger.info("Aborting all missions")
        self.vtol.abort_mission()
        self.delivery.abort_mission()
        self._broadcast_status({"event": "missions_aborted"})
    
    def get_status(self) -> dict:
        """Get current status of both drones."""
        return {
            "vtol": {
                "state": self.vtol.connection.state.value,
                "is_scouting": self.vtol.is_scouting
            },
            "delivery": {
                "state": self.delivery.connection.state.value,
                "is_delivering": self.delivery.is_delivering,
                "current_target": self.delivery.current_target.__dict__ if self.delivery.current_target else None
            },
            "pending_detections": self.detection_queue.qsize()
        }


def auto_detect_ports(baud: int) -> tuple:
    """Auto-detect two serial ports for dual drone setup."""
    print("[INFO] Auto-detecting serial ports...")
    ports = list_ports.comports()
    
    if len(ports) < 2:
        print(f"[WARN] Found only {len(ports)} port(s), need 2 for dual drone")
        return (ports[0].device if ports else None, None)
    
    print(f"[INFO] Found {len(ports)} serial port(s):")
    for i, port in enumerate(ports):
        print(f"  {i+1}. {port.device}: {port.description}")
    
    # Return first two ports
    return (ports[0].device, ports[1].device)


def main():
    parser = argparse.ArgumentParser(
        description='Dual Drone Coordination System (VTOL Scout + Delivery)'
    )
    parser.add_argument('--vtol-port', default=None,
                       help='Serial port for VTOL drone')
    parser.add_argument('--delivery-port', default=None,
                       help='Serial port for Delivery drone')
    parser.add_argument('--baud', type=int, default=57600,
                       help='Baud rate (default: 57600)')
    parser.add_argument('--demo', action='store_true',
                       help='Run in demo mode without hardware')
    args = parser.parse_args()
    
    if args.demo:
        print("[INFO] Running in DEMO mode - no hardware required")
        controller = DualDroneController("DEMO_VTOL", "DEMO_DELIVERY", args.baud)
        controller.vtol.demo_mode = True
        controller.delivery.demo_mode = True
        controller.connect_all()
        controller.run_interactive()
        return
    
    # Get ports
    vtol_port = args.vtol_port
    delivery_port = args.delivery_port
    
    if not vtol_port or not delivery_port:
        detected = auto_detect_ports(args.baud)
        vtol_port = vtol_port or detected[0]
        delivery_port = delivery_port or detected[1]
    
    if not vtol_port:
        print("[ERROR] No VTOL port specified or detected")
        sys.exit(1)
    
    if not delivery_port:
        print("[ERROR] No Delivery port specified or detected")
        print("[INFO] You can run with --demo for testing without hardware")
        sys.exit(1)
    
    print(f"[INFO] VTOL Port: {vtol_port}")
    print(f"[INFO] Delivery Port: {delivery_port}")
    
    controller = DualDroneController(vtol_port, delivery_port, args.baud)
    
    if not controller.connect_all():
        print("[ERROR] Failed to connect to one or more drones")
        sys.exit(1)
    
    controller.run_interactive()


if __name__ == "__main__":
    main()
