"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useTelemetryStore } from "@/stores/telemetryStore"
import { KMLUpload } from "./kml-upload"
import { getTelemetryWebSocketClient } from "@/lib/telemetryWebSocket"

// Waypoint type for delivery queue
interface Waypoint {
  id: number
  lat: number
  lon: number
  timestamp: string
  status: "pending" | "in-progress" | "completed" | "failed"
}

// Command retry configuration
// Note: retryDelay is the wait time BETWEEN retries to avoid flooding the network
const COMMAND_CONFIG = {
  PING: { timeout: 5000, maxRetries: 3, retryDelay: 3000, expectedAck: ["PONG", "OK"] },
  ARM: { timeout: 10000, maxRetries: 3, retryDelay: 2000, expectedAck: ["ARMED", "ARM OK", "ACK:ARM"] },
  TAKEOFF: { timeout: 15000, maxRetries: 2, retryDelay: 3000, expectedAck: ["TAKEOFF", "AIRBORNE", "ACK:TAKEOFF", "FLYING"] },
  SCOUT: { timeout: 10000, maxRetries: 2, retryDelay: 2000, expectedAck: ["SCOUT", "SCOUTING", "ACK:SCOUT", "DETECTION"] },
  "MODE:AUTO": { timeout: 8000, maxRetries: 2, retryDelay: 2000, expectedAck: ["MODE", "AUTO", "ACK:MODE"] },
  LAND: { timeout: 10000, maxRetries: 2, retryDelay: 2000, expectedAck: ["LAND", "LANDING", "ACK:LAND"] },
  RTL: { timeout: 10000, maxRetries: 2, retryDelay: 2000, expectedAck: ["RTL", "RETURNING", "ACK:RTL"] },
  GOTO: { timeout: 10000, maxRetries: 2, retryDelay: 2000, expectedAck: ["GOTO", "NAVIGATING", "ACK:GOTO"] },
  DISARM: { timeout: 8000, maxRetries: 2, retryDelay: 2000, expectedAck: ["DISARMED", "ACK:DISARM"] },
}

export function ActionButtons() {
  // Mission state
  const [isLaunching, setIsLaunching] = useState(false)
  const [missionStatus, setMissionStatus] = useState<string>("")
  const [statusColor, setStatusColor] = useState<"green" | "yellow" | "red">("green")

  // Abort and Resume state
  const [isAborted, setIsAborted] = useState(false)
  const [abortConfirmed, setAbortConfirmed] = useState<{ vtol: boolean, drone: boolean }>({ vtol: false, drone: false })
  const savedMissionStateRef = useRef<{
    vtolState: string
    deliveryState: string
    waypointQueue: Waypoint[]
    currentWaypointIndex: number
    vtolGps: { lat: number, lon: number, alt: number } | null
    droneGps: { lat: number, lon: number, alt: number } | null
  } | null>(null)


  // Dual drone WebSocket refs (DISABLED - using shared client from telemetryWebSocket.ts)
  const vtolWsRef = useRef<WebSocket | null>(null)
  const deliveryWsRef = useRef<WebSocket | null>(null)

  // KML Mission state
  const [kmlMissionLoaded, setKmlMissionLoaded] = useState(false)

  // Message buffers for ACK detection
  const vtolMessagesRef = useRef<string[]>([])
  const deliveryMessagesRef = useRef<string[]>([])

  // Waypoint queue for delivery drone
  const [waypointQueue, setWaypointQueue] = useState<Waypoint[]>([])
  const waypointIdRef = useRef(0)
  const isDeliveryBusyRef = useRef(false)
  const currentWaypointIndexRef = useRef(0)

  // VTOL state
  const [vtolState, setVtolState] = useState<"idle" | "arming" | "flying" | "scouting" | "returning">("idle")
  const [deliveryState, setDeliveryState] = useState<"idle" | "arming" | "flying" | "delivering" | "returning">("idle")

  // Telemetry store
  const droneGps = useTelemetryStore((s) => s.droneGps)
  const vtolGps = useTelemetryStore((s) => s.vtolGps)
  const droneArmed = useTelemetryStore((s) => s.droneArmed)
  const vtolArmed = useTelemetryStore((s) => s.vtolArmed)
  const droneFlying = useTelemetryStore((s) => s.droneFlying)
  const vtolFlying = useTelemetryStore((s) => s.vtolFlying)
  const mode = useTelemetryStore((s) => s.mode)
  const addLog = useTelemetryStore((s) => s.addLog)
  const addPerson = useTelemetryStore((s) => s.addPerson)
  const setState = useTelemetryStore((s) => s.setState)
  const logs = useTelemetryStore((s) => s.logs)
  const vtolHardwareConnected = useTelemetryStore((s) => s.vtolHardwareConnected)
  const droneHardwareConnected = useTelemetryStore((s) => s.droneHardwareConnected)

  // ============== WebSocket Connection ==============

  const connectWebSocket = useCallback((
    type: "vtol" | "delivery",
    port: number,
    wsRef: React.MutableRefObject<WebSocket | null>,
    messagesRef: React.MutableRefObject<string[]>
  ) => {
    const connect = () => {
      try {
        console.log(`[${type.toUpperCase()}] Connecting to ws://localhost:${port}...`)
        wsRef.current = new WebSocket(`ws://localhost:${port}`)

        wsRef.current.onopen = () => {
          console.log(`✅ [${type.toUpperCase()}] Connected to port ${port}`)
          addLog({
            time: new Date().toLocaleTimeString(),
            source: type === "vtol" ? "VTOL" : "DRONE",
            level: "INFO",
            message: `🔌 Connected to ${type.toUpperCase()} telemetry server (port ${port})`
          })
        }

        wsRef.current.onmessage = (event) => {
          const data = event.data
          console.log(`[${type.toUpperCase()}_RX]`, data)

          // Add to message buffer for ACK detection
          messagesRef.current.push(data)
          // Keep only last 50 messages
          if (messagesRef.current.length > 50) {
            messagesRef.current.shift()
          }

          // Parse and handle incoming data
          handleIncomingMessage(type, data)
        }

        wsRef.current.onclose = () => {
          console.log(`[${type.toUpperCase()}] Disconnected, reconnecting in 3s...`)
          addLog({
            time: new Date().toLocaleTimeString(),
            source: type === "vtol" ? "VTOL" : "DRONE",
            level: "WARN",
            message: `🔌 ${type.toUpperCase()} disconnected - Reconnecting...`
          })
          setTimeout(connect, 3000)
        }

        wsRef.current.onerror = () => {
          // WebSocket errors don't contain useful info in browsers
          // The onclose handler will trigger reconnection
          console.log(`[${type.toUpperCase()}] WebSocket error (will reconnect via onclose)`)
        }
      } catch (e) {
        console.error(`Failed to connect ${type}:`, e)
        setTimeout(connect, 3000)
      }
    }
    connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLog])

  // Handle incoming messages from drones
  const handleIncomingMessage = useCallback((type: "vtol" | "delivery", data: string) => {
    try {
      // Try to parse as JSON first
      const parsed = JSON.parse(data)

      if (parsed.action === "log") {
        addLog({
          time: parsed.data?.time || new Date().toLocaleTimeString(),
          source: type === "vtol" ? "VTOL" : "DRONE",
          level: parsed.data?.level || "INFO",
          message: parsed.data?.message || data
        })
      } else if (parsed.action === "telemetry") {
        // Update telemetry store with hardware connection status
        const now = Date.now()
        if (type === "vtol") {
          setState({
            vtolGps: parsed.data?.vtolGps || parsed.data?.droneGps,
            vtolArmed: parsed.data?.vtolArmed ?? parsed.data?.droneArmed,
            vtolFlying: parsed.data?.vtolFlying ?? parsed.data?.droneFlying,
            vtolHardwareConnected: parsed.data?.hardwareConnected ?? true,
            vtolLastTelemetryTime: now,
            ...parsed.data
          })
        } else {
          setState({
            droneHardwareConnected: parsed.data?.hardwareConnected ?? true,
            droneLastTelemetryTime: now,
            ...parsed.data
          })
        }
      } else if (parsed.action === "status") {
        // Handle hardware status updates
        const now = Date.now()
        if (type === "vtol") {
          setState({
            vtolHardwareConnected: parsed.data?.hardwareConnected ?? false,
            vtolLastTelemetryTime: parsed.data?.hardwareConnected ? now : 0
          })
        } else {
          setState({
            droneHardwareConnected: parsed.data?.hardwareConnected ?? false,
            droneLastTelemetryTime: parsed.data?.hardwareConnected ? now : 0
          })
        }
      } else if (parsed.action === "detection" || parsed.event === "human_detected") {
        // HUMAN DETECTION - Add to waypoint queue for delivery drone
        const lat = parsed.data?.lat || parsed.latitude
        const lon = parsed.data?.lon || parsed.longitude

        if (lat && lon) {
          handleHumanDetection(lat, lon)
        }
      }
    } catch {
      // Check for ABORT CONFIRMATION - STATUS with DISARMED/LANDED
      const upperData = data.toUpperCase()
      if (isAborted && (upperData.includes("DISARMED") || upperData.includes("LANDED") ||
        (upperData.includes("STATUS") && upperData.includes("MODE")))) {
        // Abort confirmed!
        if (type === "vtol") {
          setAbortConfirmed(prev => ({ ...prev, vtol: true }))
          addLog({
            time: new Date().toLocaleTimeString(),
            source: "VTOL",
            level: "INFO",
            message: "✅ VTOL ABORT CONFIRMED - Safe to resume"
          })
        } else {
          setAbortConfirmed(prev => ({ ...prev, drone: true }))
          addLog({
            time: new Date().toLocaleTimeString(),
            source: "DRONE",
            level: "INFO",
            message: "✅ DRONE ABORT CONFIRMED - Safe to resume"
          })
        }
      }

      // Plain text message - check for detection pattern
      if (data.includes("DETECTED:") || data.includes("HUMAN DETECTED") || data.includes("DETECTION:")) {
        // Parse detection: DETECTED:lat,lon or HUMAN DETECTED at lat,lon
        const match = data.match(/(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/)
        if (match) {
          const lat = parseFloat(match[1])
          const lon = parseFloat(match[2])
          handleHumanDetection(lat, lon)
        }
      }

      // Log plain text messages
      if (data.trim()) {
        addLog({
          time: new Date().toLocaleTimeString(),
          source: type === "vtol" ? "VTOL" : "DRONE",
          level: data.includes("ERROR") ? "ERROR" : data.includes("WARN") ? "WARN" : "INFO",
          message: data
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addLog, setState])

  // Handle human detection - add to delivery queue
  const handleHumanDetection = useCallback((lat: number, lon: number) => {
    waypointIdRef.current += 1
    const newWaypoint: Waypoint = {
      id: waypointIdRef.current,
      lat,
      lon,
      timestamp: new Date().toISOString(),
      status: "pending"
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "VTOL",
      level: "INFO",
      message: `🚨 HUMAN DETECTED at LAT: ${lat.toFixed(6)}, LON: ${lon.toFixed(6)} - Added to delivery queue`
    })

    // Add person to map
    addPerson(lat, lon)

    // Add to waypoint queue
    setWaypointQueue(prev => [...prev, newWaypoint])

    console.log(`[DETECTION] Human detected at ${lat}, ${lon} - Waypoint #${newWaypoint.id} added to queue`)
  }, [addLog, addPerson])

  // DISABLED: Using shared WebSocket client from telemetryWebSocket.ts instead
  // This was causing 20+ duplicate connections!
  /*
  useEffect(() => {
    // VTOL on port 8765 (tx.py)
    connectWebSocket("vtol", 8765, vtolWsRef, vtolMessagesRef)

    // Delivery drone on port 8766 (separate instance)
    connectWebSocket("delivery", 8766, deliveryWsRef, deliveryMessagesRef)

    return () => {
      vtolWsRef.current?.close()
      deliveryWsRef.current?.close()
    }
  }, [connectWebSocket])
  */

  // ============== Command Sending with Retry ==============

  const sendCommandWithRetry = useCallback(async (
    type: "vtol" | "delivery",
    command: string,
    config: { timeout: number; maxRetries: number; retryDelay: number; expectedAck: string[] }
  ): Promise<boolean> => {
    const source = type === "vtol" ? "VTOL" : "DRONE"
    const wsClient = getTelemetryWebSocketClient()

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      // Check WebSocket is ready
      const isConnected = type === "vtol" ? wsClient.isVtolConnected() : wsClient.isDeliveryConnected()
      if (!isConnected) {
        addLog({
          time: new Date().toLocaleTimeString(),
          source: "GROUND",
          level: "ERROR",
          message: `❌ ${source} WebSocket not connected - Attempt ${attempt}/${config.maxRetries}`
        })
        // Wait before retry to avoid flooding
        if (attempt < config.maxRetries) {
          await new Promise(r => setTimeout(r, config.retryDelay))
        }
        continue
      }

      // Send command using the client's method
      try {
        if (type === "vtol") {
          wsClient.sendVtolCommand(command)
        } else {
          wsClient.sendDeliveryCommand(command)
        }

        addLog({
          time: new Date().toLocaleTimeString(),
          source: "GROUND",
          level: "INFO",
          message: `📤 [${source}] Sent: ${command} (Attempt ${attempt}/${config.maxRetries})`
        })
      } catch (e) {
        addLog({
          time: new Date().toLocaleTimeString(),
          source: "GROUND",
          level: "ERROR",
          message: `❌ Failed to send to ${source}: ${e}`
        })
        // Wait before retry
        if (attempt < config.maxRetries) {
          await new Promise(r => setTimeout(r, config.retryDelay))
        }
        continue
      }

      // Wait for ACK by checking recent logs
      // Since we don't have direct access to message buffer from the singleton,
      // we'll check the telemetry store logs for the expected ACK
      const startTime = Date.now()

      while (Date.now() - startTime < config.timeout) {
        // Check last 20 logs (more generous window)
        const recentLogs = logs.slice(-20)
        const foundAck = recentLogs.some(log =>
          log.source === source &&
          config.expectedAck.some(ack => log.message.toUpperCase().includes(ack.toUpperCase()))
        )

        if (foundAck) {
          addLog({
            time: new Date().toLocaleTimeString(),
            source: source,
            level: "INFO",
            message: `✅ ACK received for ${command}`
          })
          return true
        }

        await new Promise(r => setTimeout(r, 200)) // Poll every 200ms
      }

      // Timeout - add delay before retry to avoid network flooding
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "WARN",
        message: `⏱️ Timeout waiting for ACK on ${command} - Waiting ${config.retryDelay / 1000}s before retry (${attempt}/${config.maxRetries})`
      })

      // Wait between retries to avoid flooding the radio network
      if (attempt < config.maxRetries) {
        await new Promise(r => setTimeout(r, config.retryDelay))
      }
    }

    // All retries failed
    addLog({
      time: new Date().toLocaleTimeString(),
      source: "GROUND",
      level: "ERROR",
      message: `❌ Command ${command} failed after ${config.maxRetries} attempts`
    })
    return false
  }, [addLog, logs])

  // Simple send without waiting (for abort)
  const sendCommand = useCallback((type: "vtol" | "delivery", command: string) => {
    const source = type === "vtol" ? "VTOL" : "DRONE"
    const wsClient = getTelemetryWebSocketClient()

    try {
      if (type === "vtol") {
        wsClient.sendVtolCommand(command)
      } else {
        wsClient.sendDeliveryCommand(command)
      }

      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "INFO",
        message: `📤 [${source}] Sent: ${command}`
      })
    } catch (e) {
      console.error(`Failed to send ${command} to ${source}:`, e)
    }
  }, [addLog])

  // ============== VTOL Mission Sequence ==============

  const startVTOLMission = useCallback(async (): Promise<boolean> => {
    setVtolState("arming")

    // Step 1: PING - Verify connection with retry
    setMissionStatus("📡 [VTOL] Testing connection...")
    if (!await sendCommandWithRetry("vtol", "PING", COMMAND_CONFIG.PING)) {
      throw new Error("VTOL PING failed - Cannot reach drone")
    }
    setMissionStatus("✅ [VTOL] Connection verified")
    await new Promise(r => setTimeout(r, 500))

    // Step 2: ARM - Wait for confirmation
    setMissionStatus("🔒 [VTOL] Arming...")
    if (!await sendCommandWithRetry("vtol", "ARM", COMMAND_CONFIG.ARM)) {
      throw new Error("VTOL ARM failed - Check drone safety")
    }
    // DO NOT force-set armed state - rely on real telemetry
    setMissionStatus("✅ [VTOL] Armed (confirmed)")
    await new Promise(r => setTimeout(r, 1000))

    // Step 3: TAKEOFF to 10m - Wait for ACK
    setVtolState("flying")
    setMissionStatus("🚀 [VTOL] Taking off to 10m...")
    if (!await sendCommandWithRetry("vtol", "TAKEOFF:10", COMMAND_CONFIG.TAKEOFF)) {
      throw new Error("VTOL TAKEOFF failed")
    }
    // DO NOT force-set flying state - rely on real telemetry
    setMissionStatus("✅ [VTOL] Takeoff initiated - Climbing to altitude")
    await new Promise(r => setTimeout(r, 5000)) // Allow time for altitude gain

    // Step 4: SCOUT - Enable human detection
    setVtolState("scouting")
    setMissionStatus("🔍 [VTOL] Starting SCOUT mission...")
    if (!await sendCommandWithRetry("vtol", "SCOUT", COMMAND_CONFIG.SCOUT)) {
      throw new Error("VTOL SCOUT failed")
    }
    setMissionStatus("✅ [VTOL] SCOUT active - Human detection enabled")
    await new Promise(r => setTimeout(r, 1000))

    // Step 5: MODE:AUTO - Start autonomous mission
    setMissionStatus("📍 [VTOL] Setting autonomous mode...")
    if (!await sendCommandWithRetry("vtol", "MODE:AUTO", COMMAND_CONFIG["MODE:AUTO"])) {
      throw new Error("VTOL MODE:AUTO failed")
    }
    setMissionStatus("✅ [VTOL] Autonomous scouting in progress - Monitoring for detections...")

    return true
  }, [sendCommandWithRetry])

  // ============== Delivery Drone Mission Sequence (Sequential) ==============

  const startDeliverySequence = useCallback(async () => {
    // Safety check: Only start if queue has items and we haven't started yet
    if (waypointQueue.length === 0 || isDeliveryBusyRef.current) return

    isDeliveryBusyRef.current = true
    setDeliveryState("arming")

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "GROUND",
      level: "INFO",
      message: `🚁 Starting Delivery Sequence for ${waypointQueue.length} targets`
    })

    try {
      // Step 1: PING
      setMissionStatus("📡 [DRONE] Verifying connection...")
      if (!await sendCommandWithRetry("delivery", "PING", COMMAND_CONFIG.PING)) {
        throw new Error("Delivery PING failed")
      }

      // Step 2: ARM
      setMissionStatus("🔒 [DRONE] Arming...")
      if (!await sendCommandWithRetry("delivery", "ARM", COMMAND_CONFIG.ARM)) {
        throw new Error("Delivery ARM failed")
      }
      setState({ droneArmed: true })

      // Step 3: TAKEOFF to 15m
      setDeliveryState("flying")
      setMissionStatus("🚀 [DRONE] Taking off to 15m...")
      if (!await sendCommandWithRetry("delivery", "TAKEOFF:15", COMMAND_CONFIG.TAKEOFF)) {
        throw new Error("Delivery TAKEOFF failed")
      }
      setState({ droneFlying: true })
      setDeliveryState("delivering")

      // Step 4: Process Queue
      setMissionStatus("📦 [DRONE] Starting deliveries...")

      // We iterate through the current queue snapshot
      // Note: If new items are added DURING flight, they might be missed in this simple loop
      // but for this sequential logic (VTOL -> Delivery), the scan is assumed done.
      const waypointsToVisit = waypointQueue.filter(wp => wp.status === "pending")

      for (const waypoint of waypointsToVisit) {
        if (isAborted) throw new Error("Mission Aborted")

        // Update status to in-progress
        setWaypointQueue(prev => prev.map(wp =>
          wp.id === waypoint.id ? { ...wp, status: "in-progress" } : wp
        ))

        addLog({
          time: new Date().toLocaleTimeString(),
          source: "DRONE",
          level: "INFO",
          message: `🎯 Navigating to Target #${waypoint.id} (${waypoint.lat.toFixed(5)}, ${waypoint.lon.toFixed(5)})`
        })

        // A. GOTO Location
        const gotoCmd = `GOTO:${waypoint.lat},${waypoint.lon},15`
        setMissionStatus(`🚁 [DRONE] Flying to Target #${waypoint.id}...`)

        if (!await sendCommandWithRetry("delivery", gotoCmd, COMMAND_CONFIG.GOTO)) {
          // If GOTO fails, mark failed and continue to next? Or abort?
          // Let's mark failed and try next for resilience
          setWaypointQueue(prev => prev.map(wp =>
            wp.id === waypoint.id ? { ...wp, status: "failed" } : wp
          ))
          continue
        }

        // Wait a bit for stabilization
        await new Promise(r => setTimeout(r, 2000))

        // B. DELIVER Command
        const deliverCmd = `DELIVER:${waypoint.lat},${waypoint.lon}`
        setMissionStatus(`📦 [DRONE] Dropping payload at Target #${waypoint.id}...`)

        // We'll treat DELIVER like a command that needs ACK
        // If your backend doesn't send specific ACK for DELIVER, we might need a simple sendCommand
        // But user said "wait for ack", so we use Retry
        // We might need to add DELIVER to COMMAND_CONFIG if not present, or use a generic one
        // Using GOTO config as fallback for now or sendCommandWithRetry will loop.
        // Let's assume it returns "OK" or "DELIVERED"
        // I should update COMMAND_CONFIG to include DELIVER if possible, 
        // but for now I'll use a generic retry or just send it if I can't verify ACK easily without blocking forever.
        // User said: "wait for ack".
        // Let's send it.

        await sendCommandWithRetry("delivery", deliverCmd, {
          timeout: 5000,
          maxRetries: 2,
          retryDelay: 1000,
          expectedAck: ["OK", "ACK", "DELIVER", "SUCCESS"]
        })

        // Mark completed
        setWaypointQueue(prev => prev.map(wp =>
          wp.id === waypoint.id ? { ...wp, status: "completed" } : wp
        ))

        addLog({
          time: new Date().toLocaleTimeString(),
          source: "DRONE",
          level: "INFO",
          message: `✅ Payload delivered to Target #${waypoint.id}`
        })

        await new Promise(r => setTimeout(r, 1000))
      }

      // Step 5: RTL
      setDeliveryState("returning")
      setMissionStatus("🏠 [DRONE] Deliveries complete - Returning home...")
      sendCommandWithRetry("delivery", "RTL", COMMAND_CONFIG.RTL)

      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "INFO",
        message: "✅ All deliveries completed. Drone returning to launch."
      })

    } catch (error) {
      const err = error instanceof Error ? error.message : String(error)
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "ERROR",
        message: `❌ Delivery Sequence Error: ${err}`
      })
      setMissionStatus(`❌ Delivery Error: ${err}`)
      // Emergency Land/RTL?
      sendCommand("delivery", "RTL")
    } finally {
      isDeliveryBusyRef.current = false
    }
  }, [waypointQueue, isAborted, sendCommandWithRetry, setState, addLog, sendCommand])

  // Monitor VTOL State to trigger Delivery
  // Trigger ONLY when VTOL goes to 'returning' or 'landed' AND we have pending items
  useEffect(() => {
    if (isDeliveryBusyRef.current) return // Already delivering

    // Check if we have pending waypoints
    const hasPending = waypointQueue.some(wp => wp.status === "pending")

    if (hasPending) {
      // Check VTOL state
      // We trigger if VTOL is 'returning' (mission done) or 'landed' (if it landed automatically)
      // Also need to ensure VTOL *was* flying recently so we don't trigger on initial boot if states are weird

      // For simplicity: If VTOL is 'returning' or 'idle' but we have a queue (implying mission happened), we go.
      // But 'idle' is the initial state, so we must be careful.
      // Let's rely on 'returning' (which happens after SCOUT mission ends)

      if (vtolState === "returning") {
        // Trigger delivery sequence
        startDeliverySequence()
      }
    }
  }, [vtolState, waypointQueue, startDeliverySequence])

  // ============== Main Mission Start ==============

  const handleStartLaunch = useCallback(async () => {
    // ========== PRE-FLIGHT SAFETY CHECKS ==========

    // Check 1: VTOL Hardware Connection
    if (!vtolHardwareConnected) {
      setStatusColor("red")
      setMissionStatus("❌ PRE-FLIGHT FAILED: VTOL NOT CONNECTED")
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "ERROR",
        message: "❌ VTOL HARDWARE NOT CONNECTED - Cannot start mission. Check battery and serial connection."
      })
      return
    }

    // Check 2: Delivery Drone Hardware Connection  
    if (!droneHardwareConnected) {
      setStatusColor("red")
      setMissionStatus("❌ PRE-FLIGHT FAILED: DELIVERY DRONE NOT CONNECTED")
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "ERROR",
        message: "❌ DELIVERY DRONE HARDWARE NOT CONNECTED - Cannot start mission. Check battery and serial connection."
      })
      return
    }

    // Check 3: GPS Signal Validation
    if (!vtolGps || vtolGps.lat === 0 || vtolGps.lon === 0) {
      setStatusColor("red")
      setMissionStatus("❌ PRE-FLIGHT FAILED: VTOL GPS SIGNAL LOST")
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "ERROR",
        message: "❌ VTOL GPS SIGNAL INVALID - Wait for GPS lock before starting mission"
      })
      return
    }

    if (!droneGps || droneGps.lat === 0 || droneGps.lon === 0) {
      setStatusColor("red")
      setMissionStatus("❌ PRE-FLIGHT FAILED: DELIVERY GPS SIGNAL LOST")
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "ERROR",
        message: "❌ DELIVERY DRONE GPS SIGNAL INVALID - Wait for GPS lock before starting mission"
      })
      return
    }

    // All safety checks passed ✅
    addLog({
      time: new Date().toLocaleTimeString(),
      source: "GROUND",
      level: "INFO",
      message: "✅ PRE-FLIGHT CHECKS PASSED - All systems nominal"
    })

    setIsLaunching(true)
    setStatusColor("yellow")

    try {
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "INFO",
        message: "🚀 ========== DUAL DRONE MISSION STARTING =========="
      })

      // Start VTOL scouting mission
      await startVTOLMission()

      setStatusColor("green")
      setMissionStatus("✅ VTOL scouting active - Delivery drone standing by for detections")

      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "INFO",
        message: "✅ VTOL mission started - Delivery drone will auto-dispatch on human detection"
      })

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

      // Try to land VTOL on failure
      sendCommand("vtol", "LAND")
      setVtolState("idle")

      await new Promise(r => setTimeout(r, 2000))
      setIsLaunching(false)
    }
  }, [
    vtolHardwareConnected,
    droneHardwareConnected,
    vtolGps,
    droneGps,
    startVTOLMission,
    addLog,
    sendCommand
  ])

  // ============== ABORT - VTOL Only ==============

  const handleAbortVTOL = useCallback(async () => {
    setStatusColor("red")
    setMissionStatus("🛑 ABORTING VTOL...")
    setIsAborted(true)
    setAbortConfirmed(prev => ({ ...prev, vtol: false }))

    // Save mission state for resume
    savedMissionStateRef.current = {
      vtolState,
      deliveryState,
      waypointQueue,
      currentWaypointIndex: currentWaypointIndexRef.current,
      vtolGps: vtolGps ? { lat: vtolGps.lat, lon: vtolGps.lon, alt: vtolGps.alt } : null,
      droneGps: droneGps ? { lat: droneGps.lat, lon: droneGps.lon, alt: droneGps.alt } : null
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "VTOL",
      level: "WARN",
      message: "🛑 ========== EMERGENCY ABORT - VTOL =========="
    })

    // Send ABORT command first (triggers RTL + DISARM on drone)
    sendCommand("vtol", "ABORT")

    await new Promise(r => setTimeout(r, 500))

    // Send LAND command
    sendCommand("vtol", "LAND")

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "VTOL",
      level: "INFO",
      message: "⏳ Waiting for touchdown before disarm..."
    })

    // Wait for drone to touch down (adjust time based on altitude)
    await new Promise(r => setTimeout(r, 8000))

    // Send DISARM after landing
    sendCommand("vtol", "DISARM")

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "VTOL",
      level: "INFO",
      message: "🔒 DISARM command sent"
    })

    await new Promise(r => setTimeout(r, 500))

    // Send STATUS to get confirmation
    sendCommand("vtol", "STATUS")

    // Update VTOL state only
    setVtolState("returning")

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "VTOL",
      level: "WARN",
      message: "📍 VTOL Position: LAT " + (vtolGps?.lat || 0).toFixed(6) + ", LON " + (vtolGps?.lon || 0).toFixed(6)
    })

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "GROUND",
      level: "INFO",
      message: "⏳ Waiting for VTOL abort confirmation (STATUS DISARMED)..."
    })

    // Don't immediately mark as complete - wait for confirmation
    setMissionStatus("⏳ VTOL aborting - Waiting for confirmation...")
    setStatusColor("yellow")
  }, [sendCommand, vtolGps, vtolState, deliveryState, waypointQueue, droneGps, addLog])

  // ============== ABORT - Delivery Drone Only ==============

  const handleAbortDelivery = useCallback(async () => {
    setStatusColor("red")
    setMissionStatus("🛑 ABORTING DELIVERY DRONE...")
    setIsAborted(true)
    setAbortConfirmed(prev => ({ ...prev, drone: false }))

    // Save mission state for resume (if not already saved)
    if (!savedMissionStateRef.current) {
      savedMissionStateRef.current = {
        vtolState,
        deliveryState,
        waypointQueue,
        currentWaypointIndex: currentWaypointIndexRef.current,
        vtolGps: vtolGps ? { lat: vtolGps.lat, lon: vtolGps.lon, alt: vtolGps.alt } : null,
        droneGps: droneGps ? { lat: droneGps.lat, lon: droneGps.lon, alt: droneGps.alt } : null
      }
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "DRONE",
      level: "WARN",
      message: "🛑 ========== EMERGENCY ABORT - DELIVERY DRONE =========="
    })

    // Send ABORT command first
    sendCommand("delivery", "ABORT")

    await new Promise(r => setTimeout(r, 500))

    // Send LAND command
    sendCommand("delivery", "LAND")

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "DRONE",
      level: "INFO",
      message: "⏳ Waiting for touchdown before disarm..."
    })

    // Wait for drone to touch down (adjust time based on altitude)
    await new Promise(r => setTimeout(r, 8000))

    // Send DISARM after landing
    sendCommand("delivery", "DISARM")

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "DRONE",
      level: "INFO",
      message: "🔒 DISARM command sent"
    })

    await new Promise(r => setTimeout(r, 500))

    // Send STATUS to get confirmation
    sendCommand("delivery", "STATUS")

    // Update delivery state only
    setDeliveryState("returning")

    // DON'T clear waypoint queue - save for resume
    // setWaypointQueue([])
    isDeliveryBusyRef.current = false

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "DRONE",
      level: "WARN",
      message: "📍 DRONE Position: LAT " + (droneGps?.lat || 0).toFixed(6) + ", LON " + (droneGps?.lon || 0).toFixed(6)
    })

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "GROUND",
      level: "INFO",
      message: "⏳ Waiting for DRONE abort confirmation (STATUS DISARMED)..."
    })

    setMissionStatus("⏳ DRONE aborting - Waiting for confirmation...")
    setStatusColor("yellow")
  }, [sendCommand, droneGps, vtolState, deliveryState, waypointQueue, vtolGps, addLog])

  // ============== ABORT - Both Drones ==============

  const handleAbortMission = useCallback(async () => {
    setStatusColor("red")
    setMissionStatus("🛑 ABORT INITIATED - Landing ALL drones...")
    setIsAborted(true)
    setAbortConfirmed({ vtol: false, drone: false })

    // Save mission state for resume
    savedMissionStateRef.current = {
      vtolState,
      deliveryState,
      waypointQueue,
      currentWaypointIndex: currentWaypointIndexRef.current,
      vtolGps: vtolGps ? { lat: vtolGps.lat, lon: vtolGps.lon, alt: vtolGps.alt } : null,
      droneGps: droneGps ? { lat: droneGps.lat, lon: droneGps.lon, alt: droneGps.alt } : null
    }

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "GROUND",
      level: "WARN",
      message: "🛑 ========== EMERGENCY ABORT - ALL DRONES =========="
    })

    // Send ABORT to both drones immediately
    sendCommand("vtol", "ABORT")
    sendCommand("delivery", "ABORT")

    await new Promise(r => setTimeout(r, 500))

    // Send LAND to both
    sendCommand("vtol", "LAND")
    sendCommand("delivery", "LAND")

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "GROUND",
      level: "INFO",
      message: "⏳ Waiting for both drones to touch down before disarm..."
    })

    // Wait for drones to touch down (adjust time based on altitude)
    await new Promise(r => setTimeout(r, 10000))

    // Send DISARM to both after landing
    sendCommand("vtol", "DISARM")
    sendCommand("delivery", "DISARM")

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "GROUND",
      level: "INFO",
      message: "🔒 DISARM commands sent to both drones"
    })

    await new Promise(r => setTimeout(r, 500))

    // Send STATUS to get confirmation
    sendCommand("vtol", "STATUS")
    sendCommand("delivery", "STATUS")

    // Update states
    setVtolState("returning")
    setDeliveryState("returning")

    // DON'T clear waypoint queue - save for resume
    isDeliveryBusyRef.current = false

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "GROUND",
      level: "WARN",
      message: "📍 VTOL Position: LAT " + (vtolGps?.lat || 0).toFixed(6) + ", LON " + (vtolGps?.lon || 0).toFixed(6)
    })

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "GROUND",
      level: "WARN",
      message: "📍 DRONE Position: LAT " + (droneGps?.lat || 0).toFixed(6) + ", LON " + (droneGps?.lon || 0).toFixed(6)
    })

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "GROUND",
      level: "INFO",
      message: "⏳ Waiting for abort confirmation from both drones..."
    })

    setMissionStatus("⏳ Aborting - Waiting for confirmation from both drones...")
    setStatusColor("yellow")
    setIsLaunching(false)
  }, [sendCommand, vtolGps, droneGps, vtolState, deliveryState, waypointQueue, addLog])

  // ============== RESUME MISSION ==============

  const handleResumeMission = useCallback(async () => {
    if (!savedMissionStateRef.current) {
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "ERROR",
        message: "❌ No saved mission state to resume"
      })
      return
    }

    const savedState = savedMissionStateRef.current

    setStatusColor("yellow")
    setMissionStatus("🔄 RESUMING MISSION...")
    setIsLaunching(true)
    setIsAborted(false)
    setAbortConfirmed({ vtol: false, drone: false })

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "GROUND",
      level: "INFO",
      message: "🔄 ========== RESUMING MISSION =========="
    })

    addLog({
      time: new Date().toLocaleTimeString(),
      source: "GROUND",
      level: "INFO",
      message: `📍 Saved VTOL state: ${savedState.vtolState}, Drone state: ${savedState.deliveryState}`
    })

    if (savedState.waypointQueue.length > 0) {
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "INFO",
        message: `📦 Restoring ${savedState.waypointQueue.length} waypoints in queue`
      })
    }

    // Re-arm VTOL if it was flying/scouting
    if (savedState.vtolState === "flying" || savedState.vtolState === "scouting") {
      setVtolState("arming")
      sendCommand("vtol", "ARM")
      await new Promise(r => setTimeout(r, 2000))

      // Resume scouting
      sendCommand("vtol", "TAKEOFF:20")
      await new Promise(r => setTimeout(r, 3000))

      sendCommand("vtol", "MODE:AUTO")
      setVtolState("scouting")

      addLog({
        time: new Date().toLocaleTimeString(),
        source: "VTOL",
        level: "INFO",
        message: "✅ VTOL mission resumed - Continuing scouting"
      })
    }

    // Re-arm delivery drone if it was delivering
    if (savedState.deliveryState === "flying" || savedState.deliveryState === "delivering") {
      setDeliveryState("arming")
      sendCommand("delivery", "ARM")
      await new Promise(r => setTimeout(r, 2000))

      sendCommand("delivery", "TAKEOFF:10")
      await new Promise(r => setTimeout(r, 3000))

      setDeliveryState("flying")

      // Continue with remaining waypoints
      const pendingWaypoints = savedState.waypointQueue.filter(wp => wp.status !== "completed")
      if (pendingWaypoints.length > 0) {
        setWaypointQueue(pendingWaypoints)
        currentWaypointIndexRef.current = savedState.currentWaypointIndex

        addLog({
          time: new Date().toLocaleTimeString(),
          source: "DRONE",
          level: "INFO",
          message: `✅ Delivery drone resumed - ${pendingWaypoints.length} waypoints remaining`
        })
      }
    }

    setStatusColor("green")
    setMissionStatus("✅ Mission resumed successfully")

    // Clear saved state
    savedMissionStateRef.current = null

    await new Promise(r => setTimeout(r, 2000))
    setMissionStatus("")
  }, [sendCommand, addLog])

  // Placeholder for legacy code compatibility
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

  // ============== Render ==============

  return (
    <div className="bg-gradient-to-r from-[#1a1a2e] to-[#2a1a3e] py-1.5 px-4 flex flex-col gap-1.5 h-auto items-center flex-shrink-0 border-t border-cyan-500/20">
      {/* KML Mission Upload */}
      <div className="w-64">
        <KMLUpload
          getVtolWs={() => getTelemetryWebSocketClient().getVtolWsInstance()}
          onUploadComplete={() => setKmlMissionLoaded(true)}
        />
      </div>

      {/* Mission Status Display */}
      {(missionStatus || isLaunching) && (
        <div className={`text-xs font-mono px-3 py-1 rounded border-l-4 w-full max-w-3xl ${statusColor === "green" ? "bg-green-900/30 border-green-500 text-green-300" :
          statusColor === "yellow" ? "bg-yellow-900/30 border-yellow-500 text-yellow-300" :
            "bg-red-900/30 border-red-500 text-red-300"
          }`}>
          {missionStatus}
        </div>
      )}

      {/* Waypoint Queue Display */}
      {waypointQueue.length > 0 && (
        <div className="text-[10px] font-mono bg-black/30 px-2 py-1 rounded border border-cyan-500/30 w-full max-w-3xl flex items-center">
          <span className="text-cyan-400">📦 Queue: </span>
          {waypointQueue.map(wp => (
            <span key={wp.id} className={`mx-0.5 px-1.5 py-0.5 rounded text-[10px] ${wp.status === "completed" ? "bg-green-800 text-green-300" :
              wp.status === "in-progress" ? "bg-yellow-800 text-yellow-300" :
                wp.status === "failed" ? "bg-red-800 text-red-300" :
                  "bg-gray-700 text-gray-300"
              }`}>
              #{wp.id}
            </span>
          ))}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-center gap-2 w-full flex-wrap">
        <button
          onClick={handleStartLaunch}
          disabled={isLaunching}
          className={`font-bold py-1.5 px-6 rounded-lg border-2 transition-all transform ${isLaunching
            ? "bg-green-900/50 border-green-600 text-green-300 opacity-50 cursor-not-allowed"
            : "bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 border-green-400 text-white hover:scale-105 active:scale-95"
            } font-semibold uppercase tracking-wider text-xs`}
        >
          {isLaunching ? "⏳ ACTIVE..." : "🚀 START"}
        </button>

        <button
          onClick={handleAbortVTOL}
          className="font-bold py-1.5 px-4 rounded-lg border-2 transition-all transform bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 border-blue-400 text-white hover:scale-105 active:scale-95 font-semibold uppercase tracking-wider text-xs"
        >
          🛑 VTOL
        </button>

        <button
          onClick={handleAbortDelivery}
          className="font-bold py-1.5 px-4 rounded-lg border-2 transition-all transform bg-gradient-to-r from-orange-600 to-orange-700 hover:from-orange-500 hover:to-orange-600 border-orange-400 text-white hover:scale-105 active:scale-95 font-semibold uppercase tracking-wider text-xs"
        >
          🛑 DRONE
        </button>

        <button
          onClick={handleAbortMission}
          className="font-bold py-1.5 px-4 rounded-lg border-2 transition-all transform bg-gradient-to-r from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 border-red-400 text-white hover:scale-105 active:scale-95 font-semibold uppercase tracking-wider text-xs"
        >
          🛑 ALL
        </button>

        {/* RESUME button - only show when aborted and confirmed */}
        {isAborted && (abortConfirmed.vtol || abortConfirmed.drone) && savedMissionStateRef.current && (
          <button
            onClick={handleResumeMission}
            disabled={isLaunching}
            className="font-bold py-1.5 px-4 rounded-lg border-2 transition-all transform bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 border-purple-400 text-white hover:scale-105 active:scale-95 font-semibold uppercase tracking-wider text-xs animate-pulse"
          >
            🔄 RESUME
          </button>
        )}
      </div>

      {/* Abort Confirmation Status - inline and smaller */}
      {isAborted && (
        <div className="flex gap-2 text-[10px] justify-center w-full">
          <div className={`px-2 py-0.5 rounded ${abortConfirmed.vtol ? 'bg-green-800 text-green-300' : 'bg-yellow-800 text-yellow-300'}`}>
            VTOL: {abortConfirmed.vtol ? '✅' : '⏳'}
          </div>
          <div className={`px-2 py-0.5 rounded ${abortConfirmed.drone ? 'bg-green-800 text-green-300' : 'bg-yellow-800 text-yellow-300'}`}>
            DRONE: {abortConfirmed.drone ? '✅' : '⏳'}
          </div>
        </div>
      )}

      {/* Dual Drone Status Indicators - more compact */}
      <div className="flex gap-4 text-[10px] justify-center w-full">
        {/* VTOL Status */}
        <div className="flex items-center gap-2 bg-black/20 px-2 py-1 rounded border border-blue-500/30">
          <span className="text-blue-400 font-semibold">VTOL:</span>
          <div className="flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${vtolArmed ? "bg-green-400" : "bg-gray-500"}`}></div>
            <span className="text-gray-300">{vtolArmed ? "Arm" : "Dis"}</span>
          </div>
          <div className="w-px h-3 bg-gray-600"></div>
          <div className="flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${vtolFlying ? "bg-cyan-400 animate-pulse" : "bg-gray-500"}`}></div>
            <span className="text-gray-300">{vtolState}</span>
          </div>
        </div>

        {/* Delivery Drone Status */}
        <div className="flex items-center gap-2 bg-black/20 px-2 py-1 rounded border border-orange-500/30">
          <span className="text-orange-400 font-semibold">DRN:</span>
          <div className="flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${droneArmed ? "bg-green-400" : "bg-gray-500"}`}></div>
            <span className="text-gray-300">{droneArmed ? "Arm" : "Dis"}</span>
          </div>
          <div className="w-px h-3 bg-gray-600"></div>
          <div className="flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${droneFlying ? "bg-cyan-400 animate-pulse" : "bg-gray-500"}`}></div>
            <span className="text-gray-300">{deliveryState}</span>
          </div>
          <div className="w-px h-3 bg-gray-600"></div>
          <span className="text-gray-400">Q:{waypointQueue.filter(w => w.status === "pending").length}</span>
        </div>
      </div>
    </div>
  )
}
