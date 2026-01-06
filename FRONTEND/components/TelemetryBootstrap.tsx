"use client";

import { useEffect } from "react";
import { startTelemetrySource } from "@/lib/telemetrySocket";

export default function TelemetryBootstrap() {
  useEffect(() => {
    startTelemetrySource();
  }, []);

  return null;
}
