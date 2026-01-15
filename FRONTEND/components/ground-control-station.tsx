"use client"

import { useMemo, useState, useEffect } from "react"
import { useTelemetryStore } from "@/stores/telemetryStore"
import { useLatestPersonDetectionLog } from "@/hooks/use-person-logs"
import { ArtificialHorizon } from "./gcs/artificial-horizon"
import { LogPanel } from "./gcs/log-panel"
import { MapView } from "./gcs/map-view"
import { ControlGauges } from "./gcs/control-gauges"
import { StatusBar } from "./gcs/status-bar"
import { ActionButtons } from "./gcs/action-buttons"

export default function GroundControlStation() {
  const latestPersonLog = useLatestPersonDetectionLog()
  
  // Subscribe to telemetry data using individual selectors to avoid infinite loop
  const time = useTelemetryStore((s) => s.time)
  const droneGps = useTelemetryStore((s) => s.droneGps)
  const vtolGps = useTelemetryStore((s) => s.vtolGps)
  const roll = useTelemetryStore((s) => s.roll)
  const pitch = useTelemetryStore((s) => s.pitch)
  const yaw = useTelemetryStore((s) => s.yaw)
  const speed = useTelemetryStore((s) => s.speed)
  const airspeed = useTelemetryStore((s) => s.airspeed)
  const heading = useTelemetryStore((s) => s.heading)
  const batteryVoltage = useTelemetryStore((s) => s.batteryVoltage)
  const batteryCurrent = useTelemetryStore((s) => s.batteryCurrent)
  const batteryPercent = useTelemetryStore((s) => s.batteryPercent)
  const mode = useTelemetryStore((s) => s.mode)
  const persons = useTelemetryStore((s) => s.persons)
  const vtolArmed = useTelemetryStore((s) => s.vtolArmed)
  const vtolFlying = useTelemetryStore((s) => s.vtolFlying)
  const droneArmed = useTelemetryStore((s) => s.droneArmed)
  const droneFlying = useTelemetryStore((s) => s.droneFlying)
  const vtolHardwareConnected = useTelemetryStore((s) => s.vtolHardwareConnected)
  const droneHardwareConnected = useTelemetryStore((s) => s.droneHardwareConnected)

  // Memoized telemetry object for easy passing to components
  const telemetry = useMemo(() => ({
    time,
    droneGps,
    vtolGps,
    roll,
    pitch,
    yaw,
    speed,
    airspeed,
    heading,
    batteryVoltage,
    batteryCurrent,
    batteryPercent,
    mode,
    persons,
    vtolArmed,
    vtolFlying,
    droneArmed,
    droneFlying,
    vtolHardwareConnected,
    droneHardwareConnected,
  }), [time, droneGps, vtolGps, roll, pitch, yaw, speed, airspeed, heading, batteryVoltage, batteryCurrent, batteryPercent, mode, persons, vtolArmed, vtolFlying, droneArmed, droneFlying, vtolHardwareConnected, droneHardwareConnected])

  // Calculate derived values
  const personDelivered = useMemo(() => {
    return telemetry.persons.filter(p => p.delivered).length
  }, [telemetry.persons])

  // Format coordinates for display
  const formatCoordinate = (lat: number, lon: number) => {
    const latDir = lat >= 0 ? "N" : "S"
    const lonDir = lon >= 0 ? "E" : "W"
    const latDeg = Math.abs(lat)
    const lonDeg = Math.abs(lon)
    
    const latMin = (latDeg % 1) * 60
    const lonMin = (lonDeg % 1) * 60
    
    return {
      latitude: `${Math.floor(latDeg)}° ${latMin.toFixed(4)}' ${latDir}`,
      longitude: `${Math.floor(lonDeg)}° ${lonMin.toFixed(4)}' ${lonDir}`
    }
  }

  // Safe GPS access with defaults
  const safeVtolGps = telemetry.vtolGps || { lat: 0, lon: 0, alt: 0 }
  const safeDroneGps = telemetry.droneGps || { lat: 0, lon: 0, alt: 0 }

  const droneCoords = formatCoordinate(safeDroneGps.lat, safeDroneGps.lon)
  const vtolCoords = formatCoordinate(safeVtolGps.lat, safeVtolGps.lon)

  // Track latest detection for visual alert
  const [showDetectionAlert, setShowDetectionAlert] = useState(false)
  const [latestDetection, setLatestDetection] = useState<{lat: number, lon: number} | null>(null)
  
  // Watch for new person detections
  useEffect(() => {
    if (telemetry.persons.length > 0) {
      const lastPerson = telemetry.persons[telemetry.persons.length - 1]
      if (!lastPerson.delivered) {
        setLatestDetection({ lat: lastPerson.lat, lon: lastPerson.lon })
        setShowDetectionAlert(true)
        // Hide alert after 5 seconds
        const timer = setTimeout(() => setShowDetectionAlert(false), 5000)
        return () => clearTimeout(timer)
      }
    }
  }, [telemetry.persons.length])

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-white overflow-hidden">
      {/* Detection Alert Overlay */}
      {showDetectionAlert && latestDetection && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-pulse">
          <div className="bg-red-600/90 border-2 border-red-400 px-6 py-3 rounded-lg shadow-lg shadow-red-500/50 flex items-center gap-3">
            <div className="w-4 h-4 bg-red-300 rounded-full animate-ping"></div>
            <div>
              <div className="text-white font-bold text-lg">🚨 HUMAN DETECTED</div>
              <div className="text-red-200 text-sm font-mono">
                LAT: {latestDetection.lat.toFixed(6)} | LON: {latestDetection.lon.toFixed(6)}
              </div>
            </div>
            <div className="w-4 h-4 bg-red-300 rounded-full animate-ping"></div>
          </div>
        </div>
      )}

      {/* Main Content - Full height grid (no header) */}
      <div className="grid grid-cols-[1fr_3fr_1fr] h-screen gap-0 overflow-hidden">
        {/* Left Panel - VTOL */}
        <div className="bg-[#0a0a1a] flex flex-col border-r border-[#2a2a5a] h-full overflow-hidden">
          <div className="p-2 flex-shrink-0">
            <ArtificialHorizon
              pitch={telemetry.pitch}
              roll={telemetry.roll}
              altitude={safeVtolGps.alt}
              airspeed={telemetry.airspeed || telemetry.speed}
              groundSpeed={telemetry.speed}
              armed={telemetry.vtolArmed}
              flying={telemetry.vtolFlying}
              batteryVoltage={telemetry.batteryVoltage}
              batteryCurrent={telemetry.batteryCurrent}
              batteryPercent={telemetry.batteryPercent}
            />
          </div>
          <div className="text-center text-sm font-semibold text-gray-300 py-2 flex-shrink-0">VTOL - LOG</div>
          <div className="flex-1 overflow-hidden">
            <LogPanel type="vtol" />
          </div>
        </div>

        {/* Center Panel - Map & Controls */}
        <div className="flex flex-col bg-[#0a0a1a] h-full overflow-hidden">
          <div className="flex-1 min-h-0 overflow-hidden">
            <MapView />
          </div>
          <div className="h-36 flex-shrink-0 overflow-hidden">
            <ControlGauges 
              vtolSpeed={telemetry.speed}
              vtolHeading={telemetry.heading}
              vtolAltitude={safeVtolGps.alt}
              droneSpeed={telemetry.speed}
              droneHeading={telemetry.heading}
              droneAltitude={safeDroneGps.alt}
            />
          </div>
          <div className="h-auto flex-shrink-0">
            <StatusBar
              personCount={telemetry.persons.length}
              vtolBattery={telemetry.batteryPercent}
              droneBattery={telemetry.batteryPercent}
              personDelivered={personDelivered}
              latitude={vtolCoords.latitude}
              longitude={vtolCoords.longitude}
              cog={telemetry.heading}
              sog={telemetry.speed}
              vtolHardwareConnected={telemetry.vtolHardwareConnected}
              droneHardwareConnected={telemetry.droneHardwareConnected}
            />
          </div>
          <div className="flex-shrink-0">
            <ActionButtons />
          </div>
          <div className="bg-[#0a0a1a] text-center py-2 text-sm flex-shrink-0">
            <span className="text-cyan-400">LOG: </span>
            <span className="text-yellow-400">
              {latestPersonLog ? latestPersonLog.replace("Person ", "Person ").replace(" detected", " detected") : "No detections yet"}
            </span>
          </div>
        </div>

        {/* Right Panel - DRONE */}
        <div className="bg-[#0a0a1a] flex flex-col border-l border-[#2a2a5a] h-full overflow-hidden">
          <div className="p-2 flex-shrink-0">
            <ArtificialHorizon
              pitch={telemetry.pitch}
              roll={telemetry.roll}
              altitude={safeDroneGps.alt}
              airspeed={telemetry.airspeed || telemetry.speed}
              groundSpeed={telemetry.speed}
              armed={telemetry.droneArmed}
              flying={telemetry.droneFlying}
              batteryVoltage={telemetry.batteryVoltage}
              batteryCurrent={telemetry.batteryCurrent}
              batteryPercent={telemetry.batteryPercent}
            />
          </div>
          <div className="text-center text-sm font-semibold text-gray-300 py-2 flex-shrink-0">DRONE - LOG</div>
          <div className="flex-1 overflow-hidden">
            <LogPanel type="drone" />
          </div>
        </div>
      </div>
    </div>
  )
}
