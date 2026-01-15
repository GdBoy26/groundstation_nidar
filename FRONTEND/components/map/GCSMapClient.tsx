"use client";

import { MapContainer, TileLayer, Marker, Polyline, Tooltip } from "react-leaflet";
import { useTelemetryStore } from "@/stores/telemetryStore";
import { useEffect, useState } from "react";
import L from "leaflet";

/* ---------- Icons ---------- */

const droneIcon = new L.Icon({
  iconUrl: "/markers/drone.png",
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

const vtolIcon = new L.Icon({
  iconUrl: "/markers/vtol.png",
  iconSize: [36, 36],
  iconAnchor: [18, 18],
});

const personPendingIcon = new L.Icon({
  iconUrl: "/markers/person.png",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const personDeliveredIcon = new L.Icon({
  iconUrl: "/markers/person-green.png",
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

/* ---------- Default GPS ---------- */
const DEFAULT_GPS = { lat: 28.545, lon: 77.192, alt: 0 };

/* ---------- Component ---------- */

export default function GCSMapClient() {
  const droneGps = useTelemetryStore((s) => s.droneGps);
  const vtolGps = useTelemetryStore((s) => s.vtolGps);
  const persons = useTelemetryStore((s) => s.persons);

  // Safe GPS with defaults
  const safeDroneGps = droneGps || DEFAULT_GPS;
  const safeVtolGps = vtolGps || DEFAULT_GPS;

  const [dronePath, setDronePath] = useState<[number, number][]>([]);

  useEffect(() => {
    if (safeDroneGps.lat && safeDroneGps.lon) {
      setDronePath((prev) => [...prev, [safeDroneGps.lat, safeDroneGps.lon]]);
    }
  }, [safeDroneGps.lat, safeDroneGps.lon]);

  return (
    <MapContainer
      center={[safeDroneGps.lat, safeDroneGps.lon]}
      zoom={16}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap"
      />

      {/* Persons (persistent) */}
      {persons.map((p) => (
        <Marker
          key={p.id}
          position={[p.lat, p.lon]}
          icon={p.delivered ? personDeliveredIcon : personPendingIcon}
        >
          <Tooltip permanent direction="top">
            Person {p.id}
          </Tooltip>
        </Marker>
      ))}

      {/* Drone */}
      <Marker position={[safeDroneGps.lat, safeDroneGps.lon]} icon={droneIcon} />
      <Polyline positions={dronePath} />

      {/* VTOL */}
      <Marker position={[safeVtolGps.lat, safeVtolGps.lon]} icon={vtolIcon} />
    </MapContainer>
  );
}
