import { useTelemetryStore } from "@/stores/telemetryStore";

/*
  Telemetry update rate
  Change this later if backend sends faster
*/
const TELEMETRY_HZ = 1;
const INTERVAL_MS = 1000 / TELEMETRY_HZ;

/* Internal simulation state */
let t = 0;
let lastPersonDetected = 0;

export function startMockTelemetryEngine() {
  setInterval(() => {
    t++;

    const store = useTelemetryStore.getState();

    /* ---------------- TIME ---------------- */
    const time = new Date().toLocaleTimeString("en-GB");

    /* ---------------- DRONE MOTION ---------------- */
    const lat = 28.545 + Math.sin(t / 15) * 0.001;
    const lon = 77.192 + Math.cos(t / 15) * 0.001;
    const alt = 120 + Math.sin(t / 6) * 2;

    const roll = Math.sin(t / 3) * 15;
    const pitch = Math.cos(t / 4) * 10;
    const yaw = (t * 5) % 360;

    const speed = 8 + Math.sin(t / 5) * 2;
    const heading = yaw;

    const batteryVoltage = Math.max(12.6 - t * 0.004, 10.8);
    const mode = ["AUTO", "GUIDED", "LOITER"][t % 3];

    /* ---------------- PERSON DETECTION (RAW SENSOR) ---------------- */
    const personDetected = t % 8 === 0 ? 1 : 0;
    const risingEdge = personDetected === 1 && lastPersonDetected === 0;
    lastPersonDetected = personDetected;

    const personLat = risingEdge ? lat + 0.00025 : null;
    const personLon = risingEdge ? lon - 0.00025 : null;
    const detectionConfidence = risingEdge
      ? Number((0.65 + Math.random() * 0.3).toFixed(2))
      : null;

    /* ---------------- UPDATE TELEMETRY STATE ---------------- */
    store.setState({
      time,

      droneGps: {
        lat,
        lon,
        alt,
      },

      roll,
      pitch,
      yaw,

      speed,
      heading,

      batteryVoltage,
      mode,

      personDetected,
      personLat,
      personLon,
      detectionConfidence,
    });

    /* Add regular system logs */
    if (t % 5 === 0) {
      store.addLog({
        time,
        source: "DRONE",
        level: "INFO",
        message: `Drone cruising at altitude ${alt.toFixed(1)}m`,
      });
    }

    if (t % 6 === 0) {
      store.addLog({
        time,
        source: "VTOL",
        level: "INFO",
        message: `VTOL systems online, battery at ${batteryVoltage.toFixed(1)}V`,
      });
    }

    /* ---------------- RISING EDGE → ADD PERSON AND LOG DETECTION ---------------- */
    if (risingEdge && personLat !== null && personLon !== null) {
      store.addPerson(personLat, personLon);

      const newId = store.persons.length;

      store.addLog({
        time,
        source: "DRONE",
        level: "INFO",
        message: `Person ${newId} detected at Lat: ${personLat.toFixed(5)}, Lon: ${personLon.toFixed(5)}`,
      });

      store.addLog({
        time,
        source: "VTOL",
        level: "INFO",
        message: `Person ${newId} detected at Lat: ${personLat.toFixed(5)}, Lon: ${personLon.toFixed(5)}`,
      });
    }

    /* ---------------- SIMULATE DELIVERY (every 20 seconds) ---------------- */
    if (t % 20 === 0) {
      const undelivered = store.persons.find((p) => !p.delivered);

      if (undelivered) {
        store.markDelivered(undelivered.id);

        store.addLog({
          time,
          source: "DRONE",
          level: "INFO",
          message: `Parcel delivered to Person ${undelivered.id}`,
        });

        store.addLog({
          time,
          source: "VTOL",
          level: "INFO",
          message: `Parcel delivered to Person ${undelivered.id}`,
        });
      }
    }

  }, INTERVAL_MS);
}
