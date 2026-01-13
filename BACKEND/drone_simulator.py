"""
Drone Simulator for testing dual-drone system without actual hardware.
Creates virtual serial ports that respond to commands.
"""

import serial
import threading
import time
import random
from datetime import datetime
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("DroneSimulator")

class SimulatedDrone:
    """Simulates drone responses for testing."""
    
    def __init__(self, name: str, port: str, is_vtol: bool = False):
        self.name = name
        self.port = port
        self.is_vtol = is_vtol
        self.serial: serial.Serial = None
        self.running = False
        self.armed = False
        self.flying = False
        self.scouting = False
        
    def start(self):
        """Start simulator (for use with virtual serial ports)."""
        self.running = True
        logger.info(f"{self.name} simulator started")
        
        # Simulate detection events if VTOL and scouting
        if self.is_vtol:
            threading.Thread(target=self._detection_loop, daemon=True).start()
    
    def stop(self):
        self.running = False
        
    def process_command(self, command: str) -> str:
        """Process incoming command and return response."""
        command = command.strip().upper()
        
        if command == "PING":
            return "PONG"
        
        elif command == "ARM":
            self.armed = True
            return "ACK:ARM"
        
        elif command == "TAKEOFF":
            if self.armed:
                self.flying = True
                return "ACK:TAKEOFF"
            return "ERROR:NOT_ARMED"
        
        elif command == "SCOUT":
            if self.flying and self.is_vtol:
                self.scouting = True
                return "ACK:SCOUT"
            return "ERROR:NOT_FLYING"
        
        elif command.startswith("MODE:"):
            return "ACK:MODE"
        
        elif command.startswith("GOTO:"):
            if self.flying:
                return "ACK:GOTO"
            return "ERROR:NOT_FLYING"
        
        elif command == "RTL":
            self.flying = False
            self.scouting = False
            return "ACK:RTL"
        
        return f"ERROR:UNKNOWN_CMD:{command}"
    
    def _detection_loop(self):
        """Simulate human detection events."""
        while self.running:
            if self.scouting:
                # Random detection every 10-30 seconds
                time.sleep(random.uniform(10, 30))
                if self.scouting:
                    # Generate random coordinates near a base location
                    lat = 28.6139 + random.uniform(-0.01, 0.01)
                    lon = 77.2090 + random.uniform(-0.01, 0.01)
                    timestamp = datetime.now().isoformat()
                    confidence = random.uniform(0.7, 0.99)
                    detection = f"DETECTED:{lat:.6f},{lon:.6f},{timestamp},{confidence:.2f}"
                    logger.info(f"{self.name} detected human: {detection}")
                    # In real implementation, this would be sent over serial
                    print(f"\n[SIMULATION] {detection}")
            else:
                time.sleep(1)


def create_test_session():
    """Create a test session with simulated drones."""
    print("=== NIDAR Dual Drone Simulator ===")
    print("This simulates drone responses for testing.\n")
    
    vtol = SimulatedDrone("VTOL", "SIM_VTOL", is_vtol=True)
    delivery = SimulatedDrone("Delivery", "SIM_DELIVERY", is_vtol=False)
    
    vtol.start()
    delivery.start()
    
    print("Commands: PING, ARM, TAKEOFF, SCOUT, MODE:AUTO, GOTO:lat,lon,alt, RTL")
    print("Type 'vtol <cmd>' or 'delivery <cmd>' to send commands")
    print("Type 'quit' to exit\n")
    
    try:
        while True:
            user_input = input("> ").strip()
            
            if user_input.lower() == "quit":
                break
            
            parts = user_input.split(" ", 1)
            if len(parts) < 2:
                print("Usage: vtol <command> or delivery <command>")
                continue
            
            drone_name, command = parts
            
            if drone_name.lower() == "vtol":
                response = vtol.process_command(command)
                print(f"VTOL Response: {response}")
            elif drone_name.lower() == "delivery":
                response = delivery.process_command(command)
                print(f"Delivery Response: {response}")
            else:
                print("Unknown drone. Use 'vtol' or 'delivery'")
                
    except KeyboardInterrupt:
        pass
    finally:
        vtol.stop()
        delivery.stop()
        print("\nSimulator stopped.")


if __name__ == "__main__":
    create_test_session()
