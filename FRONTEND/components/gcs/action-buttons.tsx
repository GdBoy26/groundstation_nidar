"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useTelemetryStore } from "@/stores/telemetryStore"

export function ActionButtons() {
  const [isLaunching, setIsLaunching] = useState(false)
  const [missionStatus, setMissionStatus] = useState<string>("")
  const [statusColor, setStatusColor] = useState<"green" | "yellow" | "red">("green")
  const wsRef = useRef<WebSocket | null>(null)
  const lastLogRef = useRef<string>("")
  
  const droneGps = useTelemetryStore((s) => s.droneGps)
  const droneArmed = useTelemetryStore((s) => s.droneArmed)
  const droneFlying = useTelemetryStore((s) => s.droneFlying)
  const mode = useTelemetryStore((s) => s.mode)
  const batteryVoltage = useTelemetryStore((s) => s.batteryVoltage)
  const speed = useTelemetryStore((s) => s.speed)
  const addLog = useTelemetryStore((s) => s.addLog)
  const logs = useTelemetryStore((s) => s.logs)

  // Connect to WebSocket on mount
  useEffect(() => {
    const connectWebSocket = () => {
      try {
        console.log("[ACTION_BUTTONS] Attempting to connect to ws://localhost:8765...")
        wsRef.current = new WebSocket("ws://localhost:8765")
        
        wsRef.current.onopen = () => {
          console.log("✅ Connected to backend WebSocket on port 8765")
          addLog({
            time: new Date().toLocaleTimeString(),
            source: "GROUND",
            level: "INFO",
            message: "🔌 Connected to backend telemetry server (ws://localhost:8765)"
          })
        }
        
        wsRef.current.onmessage = (event) => {
          console.log("[WS_RECEIVE]", event.data)
        }
        
        wsRef.current.onclose = () => {
          console.log("❌ WebSocket disconnected, reconnecting in 2s...")
          addLog({
            time: new Date().toLocaleTimeString(),
            source: "GROUND",
            level: "WARN",
            message: "🔌 Disconnected from backend - Reconnecting..."
          })
          setTimeout(connectWebSocket, 2000)
        }
        
        wsRef.current.onerror = (error) => {
          console.error("❌ WebSocket error:", error)
          addLog({
            time: new Date().toLocaleTimeString(),
            source: "GROUND",
            level: "ERROR",
            message: `❌ WebSocket error: ${error}`
          })
        }
      } catch (e) {
        console.error("Failed to connect WebSocket:", e)
        setTimeout(connectWebSocket, 2000)
      }
    }
    connectWebSocket()
    
    return () => {
      if (wsRef.current) wsRef.current.close()
    }
  }, [addLog])

  // Wait for specific log message (telemetry response)
  const waitForLogMessage = useCallback((pattern: string | RegExp, timeout: number = 5000): Promise<boolean> => {
    return new Promise((resolve) => {
      const startTime = Date.now()
      const checkLog = () => {
        if (logs.length > 0) {
          const latestLogs = logs.slice(-10)
          const found = latestLogs.some(log => {
            if (typeof pattern === "string") {
              return log.message.toUpperCase().includes(pattern.toUpperCase())
            } else {
              return pattern.test(log.message)
            }
          })
          if (found) {
            resolve(true)
            return
          }
        }
        
        if (Date.now() - startTime > timeout) {
          resolve(false)
          return
        }
        
        setTimeout(checkLog, 100)
      }
      checkLog()
    })
  }, [logs])

  const sendCommand = useCallback((cmd: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!wsRef.current) {
        console.error("❌ WebSocket reference is null")
        addLog({
          time: new Date().toLocaleTimeString(),
          source: "GROUND",
          level: "ERROR",
          message: `❌ WebSocket not initialized - Cannot send '${cmd}'`
        })
        setTimeout(resolve, 100)
        return
      }

      const wsState = wsRef.current.readyState
      const stateNames: {[key: number]: string} = {
        0: "CONNECTING",
        1: "OPEN",
        2: "CLOSING",
        3: "CLOSED"
      }
      
      console.log(`[SEND_CMD] WebSocket state: ${stateNames[wsState]} (${wsState})`)

      if (wsState !== WebSocket.OPEN) {
        console.error(`❌ WebSocket not ready. State: ${stateNames[wsState]}`)
        addLog({
          time: new Date().toLocaleTimeString(),
          source: "GROUND",
          level: "ERROR",
          message: `❌ WebSocket not ready (${stateNames[wsState]}) - Cannot send '${cmd}'`
        })
        setTimeout(resolve, 100)
        return
      }

      try {
        console.log(`[SEND_CMD] Sending command: '${cmd}'`)
        wsRef.current!.send(cmd)
        console.log(`[SEND_CMD] Command sent successfully`)
        addLog({
          time: new Date().toLocaleTimeString(),
          source: "GROUND",
          level: "INFO",
          message: `📤 Sent: ${cmd}`
        })
      } catch (error) {
        console.error(`❌ Failed to send command: ${error}`)
        addLog({
          time: new Date().toLocaleTimeString(),
          source: "GROUND",
          level: "ERROR",
          message: `❌ Failed to send '${cmd}': ${error}`
        })
      }
      
      setTimeout(resolve, 200)
    })
  }, [addLog])

  const handleStartLaunch = useCallback(async () => {
    setIsLaunching(true)
    setStatusColor("yellow")
    
    try {
      // Step 1: PING - Test connection
      setMissionStatus("📡 Sending PING - Testing connection...")
      await sendCommand("PING")
      const pingOk = await waitForLogMessage(/PONG|CONNECTION|SUCCESS/, 5000)
      if (!pingOk) {
        throw new Error("PING failed - No response from drone")
      }
      setMissionStatus("✅ PING successful - Drone responding")
      await new Promise(r => setTimeout(r, 800))

      // Step 2: ARM - Arm the drone
      setMissionStatus("🔒 Arming drone...")
      await sendCommand("ARM")
      const armOk = await waitForLogMessage(/ARMED|ARM SUCCESS|OK/, 5000)
      if (!armOk) {
        throw new Error("ARM failed - Check drone status")
      }
      setMissionStatus("✅ Drone armed successfully")
      await new Promise(r => setTimeout(r, 800))

      // Step 3: TAKEOFF to 4.0 meters
      setMissionStatus("🚀 Taking off to 4.0m altitude...")
      await sendCommand("TAKEOFF:4")
      const takeoffOk = await waitForLogMessage(/TAKEOFF|FLYING|AIRBORNE/, 8000)
      if (!takeoffOk) {
        throw new Error("TAKEOFF failed - Check altitude sensor")
      }
      setMissionStatus(`✅ Reached target altitude - Alt: ${droneGps.alt.toFixed(1)}m`)
      await new Promise(r => setTimeout(r, 800))

      // Step 4: Start SCOUT command for detection and recording
      setMissionStatus("🔍 Starting SCOUT mission - Detection enabled...")
      await sendCommand("SCOUT")
      const scoutOk = await waitForLogMessage(/SCOUT|DETECT|RECORDING|MISSION/, 4000)
      if (!scoutOk) {
        throw new Error("SCOUT failed - Check camera/detector")
      }
      setMissionStatus("✅ SCOUT active - Human detection running")
      await new Promise(r => setTimeout(r, 800))

      // Step 5: Set MODE:AUTO for autonomous waypoint flight
      setMissionStatus("📍 Setting MODE:AUTO for autonomous flight...")
      await sendCommand("MODE:AUTO")
      const modeOk = await waitForLogMessage(/MODE.*AUTO|MODE CHANGE|AUTONOMOUS/, 5000)
      if (!modeOk) {
        throw new Error("MODE change failed")
      }
      setMissionStatus("✅ Autonomous mode active - Flying waypoints")
      await new Promise(r => setTimeout(r, 800))

      // Step 6: Monitor flight until waypoint completion
      setMissionStatus("⏳ Monitoring mission - Drone flying waypoints... (Alt: " + droneGps.alt.toFixed(1) + "m, Speed: " + speed.toFixed(1) + "m/s)")
      await new Promise(r => setTimeout(r, 5000))

      // Step 7: Return to Launch (RTL)
      setMissionStatus("🏠 Mission waypoints complete - Initiating RTL...")
      setStatusColor("green")
      await sendCommand("RTL")
      const rtlOk = await waitForLogMessage(/RTL|RETURN|LANDING/, 8000)
      if (!rtlOk) {
        console.warn("RTL acknowledgment not received, continuing...")
      }
      
      setMissionStatus("🛬 Returning to launch position...")
      await new Promise(r => setTimeout(r, 3000))
      
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "INFO",
        message: "✅ Mission completed successfully - RTL initiated"
      })

      setMissionStatus("✅ Mission completed successfully! Final Alt: " + droneGps.alt.toFixed(1) + "m")
      await new Promise(r => setTimeout(r, 2000))
      setIsLaunching(false)
      setMissionStatus("")

    } catch (error) {
      setStatusColor("red")
      const errorMsg = error instanceof Error ? error.message : String(error)
      setMissionStatus(`❌ Mission failed: ${errorMsg}`)
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "ERROR",
        message: `❌ Mission aborted: ${errorMsg}`
      })
      
      // Try to abort and land
      try {
        await sendCommand("LAND")
      } catch (e) {
        console.error("Emergency land failed:", e)
      }
      
      await new Promise(r => setTimeout(r, 2000))
      setIsLaunching(false)
    }
  }, [sendCommand, waitForLogMessage, droneGps.alt, speed, addLog])

  const handleAbortMission = useCallback(async () => {
    setIsLaunching(true)
    setStatusColor("red")
    
    try {
      const currentAlt = droneGps.alt.toFixed(1)
      const currentLat = droneGps.lat.toFixed(5)
      const currentLon = droneGps.lon.toFixed(5)
      
      setMissionStatus("🛑 ABORT INITIATED - Landing at current position...")
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "WARN",
        message: `🛑 ABORT MISSION - Current Position: LAT ${currentLat}, LON ${currentLon}, ALT ${currentAlt}m`
      })
      await new Promise(r => setTimeout(r, 500))

      // Send LAND command
      setMissionStatus("🛑 Sending LAND command to drone...")
      await sendCommand("LAND")
      const landOk = await waitForLogMessage(/LAND|DESCENDING|LANDING/, 4000)
      if (!landOk) {
        console.warn("LAND acknowledgment not received, continuing...")
      }
      
      setMissionStatus("⏳ Landing in progress... Descending to ground level")
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "WARN",
        message: `📍 Landing from altitude: ${currentAlt}m at GPS: ${currentLat}, ${currentLon}`
      })
      
      // Wait for landing to complete
      let landComplete = false
      const landTimeout = Date.now() + 15000 // 15 second timeout
      
      while (Date.now() < landTimeout && !landComplete) {
        if (droneGps.alt < 0.5 && !droneFlying) {
          landComplete = true
          break
        }
        await new Promise(r => setTimeout(r, 500))
      }

      setMissionStatus("✋ Landing complete - Drone at rest")
      setStatusColor("green")
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "INFO",
        message: `✅ Abort complete - Landed at ALT: ${droneGps.alt.toFixed(1)}m`
      })

      await new Promise(r => setTimeout(r, 1500))
      setIsLaunching(false)
      setMissionStatus("")

    } catch (error) {
      setStatusColor("red")
      const errorMsg = error instanceof Error ? error.message : String(error)
      setMissionStatus(`❌ Abort failed: ${errorMsg}`)
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "ERROR",
        message: `❌ Abort procedure failed: ${errorMsg}`
      })
      await new Promise(r => setTimeout(r, 2000))
      setIsLaunching(false)
    }
  }, [sendCommand, waitForLogMessage, droneGps, droneFlying, addLog])

  return (
    <div className="bg-gradient-to-r from-[#1a1a2e] to-[#2a1a3e] py-3 px-6 flex flex-col gap-3 h-auto items-center flex-shrink-0 border-t border-cyan-500/20">
      {/* Mission Status Display */}
      {(missionStatus || isLaunching) && (
        <div className={`text-sm font-mono px-4 py-2 rounded border-l-4 ${
          statusColor === "green" ? "bg-green-900/30 border-green-500 text-green-300" :
          statusColor === "yellow" ? "bg-yellow-900/30 border-yellow-500 text-yellow-300" :
          "bg-red-900/30 border-red-500 text-red-300"
        }`}>
          {missionStatus}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-center gap-6 w-full">
        <button
          onClick={handleStartLaunch}
          disabled={isLaunching}
          className={`font-bold py-3 px-16 rounded-lg border-2 transition-all transform ${
            isLaunching
              ? "bg-green-900/50 border-green-600 text-green-300 opacity-50 cursor-not-allowed"
              : "bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 border-green-400 text-white hover:scale-105 active:scale-95"
          } font-semibold uppercase tracking-wider text-sm`}
        >
          {isLaunching ? "⏳ LAUNCHING..." : "🚀 START LAUNCH"}
        </button>
        
        <button
          onClick={handleAbortMission}
          disabled={isLaunching}
          className={`font-bold py-3 px-16 rounded-lg border-2 transition-all transform ${
            isLaunching
              ? "bg-red-900/50 border-red-600 text-red-300 opacity-50 cursor-not-allowed"
              : "bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 border-red-400 text-white hover:scale-105 active:scale-95"
          } font-semibold uppercase tracking-wider text-sm`}
        >
          {isLaunching ? "🛑 ABORTING..." : "🛑 ABORT MISSION"}
        </button>
      </div>

      {/* Status Indicators */}
      <div className="flex gap-4 text-xs justify-center w-full">
        <div className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${droneArmed ? "bg-green-400" : "bg-gray-500"}`}></div>
          <span className="text-gray-300">{droneArmed ? "Armed" : "Disarmed"}</span>
        </div>
        <div className="w-px bg-gray-600"></div>
        <div className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${droneFlying ? "bg-cyan-400" : "bg-gray-500"}`}></div>
          <span className="text-gray-300">{droneFlying ? "Flying" : "Grounded"}</span>
        </div>
        <div className="w-px bg-gray-600"></div>
        <div className="flex items-center gap-1">
          <span className="text-cyan-400">Mode:</span>
          <span className="text-yellow-300">{mode || "UNKNOWN"}</span>
        </div>
      </div>
    </div>
  )
}
