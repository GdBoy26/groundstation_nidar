import { create } from "zustand";

/* ---------- Types ---------- */

type GPS = {
  lat: number;
  lon: number;
  alt: number;
};

type Person = {
  id: number;
  lat: number;
  lon: number;
  delivered: boolean;
};

type LogSource = "DRONE" | "VTOL" | "SYSTEM"|"GROUND";
type LogLevel = "INFO" | "WARN" | "ERROR";

type LogEntry = {
  time: string;
  source: LogSource;
  level: LogLevel;
  message: string;
};

type TelemetryState = {
  /* Time */
  time: string;

  /* Position */
  droneGps: GPS;
  vtolGps: GPS;

  /* Attitude */
  roll: number;
  pitch: number;
  yaw: number;

  /* Motion */
  speed: number;
  heading: number;

  /* Power */
  batteryVoltage: number;
  mode: string;

  /* Status */
  vtolArmed: boolean;
  droneArmed: boolean;
  vtolFlying: boolean;
  droneFlying: boolean;

  /* Raw person detection (from backend) */
  personDetected: 0 | 1;
  personLat: number | null;
  personLon: number | null;
  detectionConfidence: number | null;

  /* Mission-level persons (persistent) */
  persons: Person[];

  /* Logs */
  logs: LogEntry[];
  addLog: (log: LogEntry) => void;


  /* Actions */
  setState: (p: Partial<TelemetryState>) => void;
  addPerson: (lat: number, lon: number) => void;
  markDelivered: (id: number) => void;
};

/* ---------- Store ---------- */

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  /* Time */
  time: "",

  /* Position */
  droneGps: { lat: 28.545, lon: 77.192, alt: 120 },
  vtolGps: { lat: 28.546, lon: 77.191, alt: 0 },

  /* Attitude */
  roll: 0,
  pitch: 0,
  yaw: 0,

  /* Motion */
  speed: 0,
  heading: 0,

  /* Power */
  batteryVoltage: 12.6,
  mode: "AUTO",

  /* Status */
  vtolArmed: false,
  droneArmed: false,
  vtolFlying: false,
  droneFlying: false,

  /* Raw person detection */
  personDetected: 0,
  personLat: null,
  personLon: null,
  detectionConfidence: null,

  /* Mission persons */
  persons: [],

  /* Logs */
  logs: [],

  addLog: (log) =>
    set((state) => ({
      logs: [...state.logs, log].slice(-200),
    })),


  /* Generic backend-style updater */
  setState: (p) =>
    set((state) => ({
      ...state,
      ...p,
    })),
  
  
  /* Add persistent person */
  addPerson: (lat, lon) =>
    set((state) => ({
      persons: [
        ...state.persons,
        {
          id: state.persons.length + 1,
          lat,
          lon,
          delivered: false,
        },
      ],
    })),

  /* Mark delivery complete */
  markDelivered: (id) =>
    set((state) => ({
      persons: state.persons.map((p) =>
        p.id === id ? { ...p, delivered: true } : p
      ),
    })),
}));
