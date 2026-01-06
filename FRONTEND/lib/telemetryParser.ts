export function parseTelemetryString(csv: string) {
  const [
    TIME, LAT, LON, ALT,
    ROLL, PITCH, YAW,
    SPD, VOLT, MODE,
    PERSON_STATUS, PLAT, PLON, CONF,
  ] = csv.split(",");

  const detected = PERSON_STATUS === "1";

  return {
    time: TIME,

    droneGps: {
      lat: parseFloat(LAT),
      lon: parseFloat(LON),
      alt: parseFloat(ALT),
    },

    roll: parseFloat(ROLL),
    pitch: parseFloat(PITCH),
    yaw: parseFloat(YAW),

    speed: parseFloat(SPD),
    heading: parseFloat(YAW),

    batteryVoltage: parseFloat(VOLT),
    mode: MODE,

    personDetected: detected ? 1 : 0,
    personLat: detected ? parseFloat(PLAT) : null,
    personLon: detected ? parseFloat(PLON) : null,
    detectionConfidence: detected ? parseFloat(CONF) : null,
  };
}
