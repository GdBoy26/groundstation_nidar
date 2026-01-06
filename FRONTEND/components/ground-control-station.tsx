"use client"

import { useMemo } from "react"
import { useTelemetryStore } from "@/stores/telemetryStore"
import { useLatestPersonDetectionLog } from "@/hooks/use-person-logs"
import { ArtificialHorizon } from "./gcs/artificial-horizon"
import { CompassIndicator } from "./gcs/compass-indicator"
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
  const heading = useTelemetryStore((s) => s.heading)
  const batteryVoltage = useTelemetryStore((s) => s.batteryVoltage)
  const mode = useTelemetryStore((s) => s.mode)
  const persons = useTelemetryStore((s) => s.persons)

  // Memoized telemetry object for easy passing to components
  const telemetry = useMemo(() => ({
    time,
    droneGps,
    vtolGps,
    roll,
    pitch,
    yaw,
    speed,
    heading,
    batteryVoltage,
    mode,
    persons,
  }), [time, droneGps, vtolGps, roll, pitch, yaw, speed, heading, batteryVoltage, mode, persons])

  // Calculate derived values
  const personDelivered = useMemo(() => {
    return telemetry.persons.filter(p => p.delivered).length
  }, [telemetry.persons])

  const batteryPercent = useMemo(() => {
    // Assuming 12V = 100%, 10V = 0%
    const percent = Math.max(0, Math.min(100, (telemetry.batteryVoltage - 10) / 2 * 100))
    return Math.round(percent)
  }, [telemetry.batteryVoltage])

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

  const droneCoords = formatCoordinate(telemetry.droneGps.lat, telemetry.droneGps.lon)
  const vtolCoords = formatCoordinate(telemetry.vtolGps.lat, telemetry.vtolGps.lon)

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-white overflow-hidden">
      {/* Header */}
      <header className="bg-[#1a1a3a] h-14 flex items-center justify-center relative border-b border-[#2a2a5a]">
        <h1 className="text-xl font-bold tracking-wide text-cyan-100">ASTRA - NIDAR :PHINEAS AND FERB</h1>
        <div className="absolute right-4 flex items-center gap-2">
          <div className="w-8 h-6 flex flex-col">
            <div className="h-1/3 bg-[#FF9933]"></div>
            <div className="h-1/3 bg-white flex items-center justify-center">
              <div className="w-2 h-2 rounded-full border border-[#000080]"></div>
            </div>
            <div className="h-1/3 bg-[#138808]"></div>
          </div>
        </div>
      </header>

      {/* Main Content - Fixed height grid */}
      <div className="grid grid-cols-[1fr_2fr_1fr] h-[calc(100vh-56px)] gap-0 overflow-hidden">
        {/* Left Panel - VTOL */}
        <div className="bg-[#0a0a1a] flex flex-col border-r border-[#2a2a5a] h-full overflow-hidden">
          <div className="p-2 flex-shrink-0">
            <CompassIndicator heading={telemetry.heading} />
            <ArtificialHorizon
              pitch={telemetry.pitch}
              roll={telemetry.roll}
              altitude={telemetry.vtolGps.alt}
              airspeed={telemetry.speed}
              groundSpeed={telemetry.speed}
              armed={telemetry.vtolArmed}
              flying={telemetry.vtolFlying}
              batteryVoltage={telemetry.batteryVoltage}
              batteryCurrent={0.0}
              batteryPercent={batteryPercent}
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
              speed={telemetry.speed}
              heading={telemetry.heading}
              altitude={telemetry.vtolGps.alt}
              vtolAltitude={telemetry.vtolGps.alt}
              droneAltitude={telemetry.droneGps.alt}
            />
          </div>
          <div className="h-auto flex-shrink-0">
            <StatusBar
              personCount={telemetry.persons.length}
              vtolBattery={batteryPercent}
              droneBattery={batteryPercent}
              personDelivered={personDelivered}
              latitude={vtolCoords.latitude}
              longitude={vtolCoords.longitude}
              cog={telemetry.heading}
              sog={telemetry.speed}
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
            <CompassIndicator heading={telemetry.heading} />
            <ArtificialHorizon
              pitch={telemetry.pitch}
              roll={telemetry.roll}
              altitude={telemetry.droneGps.alt}
              airspeed={telemetry.speed}
              groundSpeed={telemetry.speed}
              armed={telemetry.droneArmed}
              flying={telemetry.droneFlying}
              batteryVoltage={telemetry.batteryVoltage}
              batteryCurrent={0.0}
              batteryPercent={batteryPercent}
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
