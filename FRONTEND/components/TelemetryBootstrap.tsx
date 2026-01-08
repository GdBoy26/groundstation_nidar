"use client";

import { useEffect } from "react";
import { startTelemetrySource } from "@/lib/telemetrySocket";
import { initTelemetryWebSocket } from "@/lib/telemetryWebSocket";

export default function TelemetryBootstrap() {
  useEffect(() => {
    // Only use real backend data via WebSocket
    // Mock engine is disabled - all data comes from drone via tx.py
    initTelemetryWebSocket();
  }, []);

  return null;
}
