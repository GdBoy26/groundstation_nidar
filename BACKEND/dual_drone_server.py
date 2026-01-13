import asyncio
import json
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import uvicorn
import threading

from dual_drone_controller import DualDroneController, DroneConfig, HumanDetection

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("DualDroneServer")

app = FastAPI(title="NIDAR Dual Drone Controller")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global controller instance
controller: Optional[DualDroneController] = None
connected_websockets: list[WebSocket] = []

class DroneConfigModel(BaseModel):
    vtol_port: str = "COM3"
    vtol_baudrate: int = 57600
    delivery_port: str = "COM4"
    delivery_baudrate: int = 57600

class ManualDeliveryModel(BaseModel):
    latitude: float
    longitude: float
    altitude: float = 20.0

async def broadcast_to_clients(message: dict):
    """Broadcast message to all connected WebSocket clients."""
    for ws in connected_websockets:
        try:
            await ws.send_json(message)
        except Exception as e:
            logger.error(f"Failed to send to client: {e}")

def sync_broadcast(message: dict):
    """Synchronous wrapper for broadcasting."""
    asyncio.run(broadcast_to_clients(message))

@app.post("/api/connect")
async def connect_drones(config: DroneConfigModel):
    """Initialize and connect to both drones."""
    global controller
    
    vtol_config = DroneConfig(
        name="VTOL",
        port=config.vtol_port,
        baudrate=config.vtol_baudrate
    )
    
    delivery_config = DroneConfig(
        name="Delivery",
        port=config.delivery_port,
        baudrate=config.delivery_baudrate
    )
    
    controller = DualDroneController(vtol_config, delivery_config)
    controller.add_status_callback(lambda msg: asyncio.create_task(broadcast_to_clients(msg)))
    
    success = controller.connect_all()
    return {"success": success, "message": "Connected" if success else "Connection failed"}

@app.post("/api/disconnect")
async def disconnect_drones():
    """Disconnect from all drones."""
    global controller
    if controller:
        controller.disconnect_all()
        controller = None
    return {"success": True, "message": "Disconnected"}

@app.post("/api/start-mission")
async def start_mission():
    """Start the VTOL scouting mission."""
    if not controller:
        return {"success": False, "message": "Not connected"}
    
    success = controller.start_mission()
    return {"success": success, "message": "Mission started" if success else "Mission start failed"}

@app.post("/api/abort")
async def abort_mission():
    """Abort all missions."""
    if not controller:
        return {"success": False, "message": "Not connected"}
    
    controller.abort_all()
    return {"success": True, "message": "Missions aborted"}

@app.post("/api/manual-delivery")
async def manual_delivery(target: ManualDeliveryModel):
    """Manually trigger delivery to specific coordinates."""
    if not controller:
        return {"success": False, "message": "Not connected"}
    
    detection = HumanDetection(
        latitude=target.latitude,
        longitude=target.longitude,
        timestamp="manual"
    )
    
    success = controller.delivery.deliver_to(detection, target.altitude)
    return {"success": success, "message": "Delivery started" if success else "Delivery failed"}

@app.get("/api/status")
async def get_status():
    """Get current status of both drones."""
    if not controller:
        return {"connected": False}
    
    return {"connected": True, **controller.get_status()}

@app.post("/api/vtol/command/{command}")
async def send_vtol_command(command: str):
    """Send raw command to VTOL drone."""
    if not controller:
        return {"success": False, "message": "Not connected"}
    
    success = controller.vtol.connection.send_command(command)
    return {"success": success}

@app.post("/api/delivery/command/{command}")
async def send_delivery_command(command: str):
    """Send raw command to delivery drone."""
    if not controller:
        return {"success": False, "message": "Not connected"}
    
    success = controller.delivery.connection.send_command(command)
    return {"success": success}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for real-time updates."""
    await websocket.accept()
    connected_websockets.append(websocket)
    logger.info("WebSocket client connected")
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Handle WebSocket commands
            if message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
            elif message.get("type") == "get_status":
                if controller:
                    await websocket.send_json({"type": "status", **controller.get_status()})
                else:
                    await websocket.send_json({"type": "status", "connected": False})
                    
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    finally:
        connected_websockets.remove(websocket)

@app.get("/api/ports")
async def list_serial_ports():
    """List available serial ports."""
    import serial.tools.list_ports
    ports = [{"port": p.device, "description": p.description} for p in serial.tools.list_ports.comports()]
    return {"ports": ports}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
