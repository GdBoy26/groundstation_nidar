/*
  Telemetry Socket - Abstraction layer for telemetry data source
  
  This module provides a unified interface that can switch between:
  1. Mock Telemetry Engine (for development/testing)
  2. Backend WebSocket connection (for production)
  
  To switch to backend socket when ready:
  - Implement the backendSocketConnect function
  - Change the useBackend flag in startTelemetrySource()
  - Ensure backend sends data in the same format as mockTelemetryEngine
*/

import { startMockTelemetryEngine } from "./mockTelemetryEngine";
import { useTelemetryStore } from "@/stores/telemetryStore";

export interface TelemetryDataPacket {
  time: string;
  droneGps: { lat: number; lon: number; alt: number };
  vtolGps: { lat: number; lon: number; alt: number };
  roll: number;
  pitch: number;
  yaw: number;
  speed: number;
  heading: number;
  batteryVoltage: number;
  mode: string;
  personDetected: 0 | 1;
  personLat: number | null;
  personLon: number | null;
  detectionConfidence: number | null;
}

/* ==================== BACKEND SOCKET CONNECTION ==================== */
/* 
  TODO: Implement when backend is ready
  Expected WebSocket server: ws://localhost:8000/telemetry
  Expected message format: TelemetryDataPacket (JSON)
*/

function backendSocketConnect() {
  try {
    const ws = new WebSocket("ws://localhost:8000/telemetry");

    ws.onopen = () => {
      console.log("Connected to telemetry backend socket");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as TelemetryDataPacket;
        const store = useTelemetryStore.getState();

        // Update telemetry state
        store.setState({
          time: data.time,
          droneGps: data.droneGps,
          vtolGps: data.vtolGps,
          roll: data.roll,
          pitch: data.pitch,
          yaw: data.yaw,
          speed: data.speed,
          heading: data.heading,
          batteryVoltage: data.batteryVoltage,
          mode: data.mode,
          personDetected: data.personDetected,
          personLat: data.personLat,
          personLon: data.personLon,
          detectionConfidence: data.detectionConfidence,
        });
      } catch (error) {
        console.error("Error parsing telemetry data:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("Telemetry socket error:", error);
    };

    ws.onclose = () => {
      console.log("Disconnected from telemetry backend socket");
    };
  } catch (error) {
    console.error("Failed to connect to backend socket:", error);
  }
}

/* ==================== PUBLIC API ==================== */

export function startTelemetrySource() {
  // Set to true when backend is ready
  const useBackend = false;

  if (useBackend) {
    backendSocketConnect();
  } else {
    startMockTelemetryEngine();
  }
}
