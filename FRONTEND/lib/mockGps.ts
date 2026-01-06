import { useTelemetryStore } from "@/stores/telemetryStore";

let angle = 0;

export function startMockGps() {
  setInterval(() => {
    angle += 0.0001;

    useTelemetryStore.getState().setDroneGps({
      lat: 28.545 + Math.sin(angle) * 0.001,
      lon: 77.192 + Math.cos(angle) * 0.001,
      alt: 120,
    });

    // VTOL marker only (static or slow)
    useTelemetryStore.getState().setVtolGps({
      lat: 28.546,
      lon: 77.191,
      alt: 0,
    });
  }, 500);
}
