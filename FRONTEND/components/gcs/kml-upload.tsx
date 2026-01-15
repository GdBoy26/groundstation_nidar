"use client"

import { useState, useRef, useCallback } from "react"
import { useTelemetryStore } from "@/stores/telemetryStore"
import pako from "pako"

interface KMLUploadProps {
  getVtolWs: () => WebSocket | null
  onUploadComplete?: () => void
}

export function KMLUpload({ getVtolWs, onUploadComplete }: KMLUploadProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string>("")
  const [uploadProgress, setUploadProgress] = useState<number>(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addLog = useTelemetryStore((s) => s.addLog)

  // Parse KML file to extract polygon coordinates
  const parseKMLCoordinates = useCallback((kmlContent: string): string => {
    const parser = new DOMParser()
    const xmlDoc = parser.parseFromString(kmlContent, "text/xml")

    // Check for parsing errors
    const parseError = xmlDoc.querySelector("parsererror")
    if (parseError) {
      throw new Error("Invalid KML file - XML parsing error")
    }

    // Try to find coordinates with KML namespace
    let coordinates = xmlDoc.querySelector("Polygon coordinates")

    if (!coordinates) {
      // Try with explicit namespace
      const ns = "http://www.opengis.net/kml/2.2"
      coordinates = xmlDoc.getElementsByTagNameNS(ns, "coordinates")[0]
    }

    if (!coordinates) {
      // Try within LinearRing
      coordinates = xmlDoc.querySelector("Polygon LinearRing coordinates")
    }

    if (!coordinates) {
      // Try outerBoundaryIs
      coordinates = xmlDoc.querySelector("Polygon outerBoundaryIs LinearRing coordinates")
    }

    if (!coordinates || !coordinates.textContent) {
      throw new Error("No polygon coordinates found in KML file")
    }

    return coordinates.textContent.trim()
  }, [])

  // Compress coordinates using zlib and base64 encode
  const compressCoordinates = useCallback((coordText: string): string => {
    const encoder = new TextEncoder()
    const data = encoder.encode(coordText)

    // Compress using pako (zlib)
    const compressed = pako.deflate(data, { level: 9 })

    // Base64 encode
    let binary = ""
    for (let i = 0; i < compressed.length; i++) {
      binary += String.fromCharCode(compressed[i])
    }
    const encoded = btoa(binary)

    return encoded
  }, [])

  // Handle file selection
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.name.toLowerCase().endsWith(".kml")) {
        addLog({
          time: new Date().toLocaleTimeString(),
          source: "GROUND",
          level: "ERROR",
          message: "❌ Please select a .kml file"
        })
        return
      }
      setSelectedFile(file)
      setUploadStatus("")
      setUploadProgress(0)
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "INFO",
        message: `📁 KML file selected: ${file.name}`
      })
    }
  }, [addLog])

  // Upload KML boundary to drone
  const handleUpload = useCallback(async () => {
    if (!selectedFile) {
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "ERROR",
        message: "❌ No KML file selected"
      })
      return
    }

    const vtolWs = getVtolWs()
    if (!vtolWs || vtolWs.readyState !== WebSocket.OPEN) {
      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "ERROR",
        message: "❌ VTOL WebSocket not connected"
      })
      return
    }

    setIsUploading(true)
    setUploadStatus("Reading KML file...")
    setUploadProgress(5)

    try {
      // Read file content
      const fileContent = await selectedFile.text()

      setUploadStatus("Parsing KML coordinates...")
      setUploadProgress(15)

      // Parse coordinates - extract ONLY the raw boundary coordinates
      const coordText = parseKMLCoordinates(fileContent)
      const coordCount = coordText.split(/\s+/).filter(s => s.includes(",")).length

      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "INFO",
        message: `📍 Extracted ${coordCount} boundary points from KML`
      })

      setUploadStatus("Compressing boundary data...")
      setUploadProgress(25)

      // Compress and encode
      const encodedData = compressCoordinates(coordText)
      const originalSize = new TextEncoder().encode(coordText).length
      const compressedSize = encodedData.length
      const reduction = ((1 - compressedSize / originalSize) * 100).toFixed(1)

      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "INFO",
        message: `📦 Compressed: ${originalSize} → ${compressedSize} bytes (${reduction}% reduction)`
      })

      setUploadStatus("Sending boundary to drone...")
      setUploadProgress(30)

      // Send START command with data size only (RPI handles altitude/pattern)
      const startCmd = `KML:START:${encodedData.length}`
      vtolWs.send(startCmd)

      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "INFO",
        message: `📤 Transmitting KML boundary (${compressedSize} bytes)...`
      })

      // Wait 200ms for drone to prepare
      await new Promise(r => setTimeout(r, 200))

      // Send data in 64-byte chunks
      const chunkSize = 64
      const totalChunks = Math.ceil(encodedData.length / chunkSize)

      for (let i = 0; i < encodedData.length; i += chunkSize) {
        const chunk = encodedData.slice(i, i + chunkSize)
        const chunkCmd = `KML:DATA:${chunk}`
        vtolWs.send(chunkCmd)

        // Update progress (30% to 90% for data transfer)
        const chunkProgress = 30 + ((i + chunkSize) / encodedData.length) * 60
        setUploadProgress(Math.min(chunkProgress, 90))
        setUploadStatus(`Sending chunk ${Math.floor(i / chunkSize) + 1}/${totalChunks}...`)

        // Wait 100ms between chunks for radio buffer
        await new Promise(r => setTimeout(r, 100))
      }

      setUploadProgress(95)
      setUploadStatus("Finalizing...")

      // Send END command
      vtolWs.send("KML:END")

      await new Promise(r => setTimeout(r, 200))

      setUploadProgress(100)
      setUploadStatus("✅ KML boundary uploaded!")

      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "INFO",
        message: `✅ KML boundary transmitted! RPI will generate waypoints.`
      })

      onUploadComplete?.()

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      setUploadStatus(`❌ Error: ${errorMsg}`)
      setUploadProgress(0)

      addLog({
        time: new Date().toLocaleTimeString(),
        source: "GROUND",
        level: "ERROR",
        message: `❌ KML upload failed: ${errorMsg}`
      })
    } finally {
      setIsUploading(false)
    }
  }, [selectedFile, getVtolWs, parseKMLCoordinates, compressCoordinates, addLog, onUploadComplete])

  // Clear selection
  const handleClear = useCallback(() => {
    setSelectedFile(null)
    setUploadStatus("")
    setUploadProgress(0)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }, [])

  return (
    <div className="bg-black/30 rounded border border-purple-500/30 overflow-hidden">
      {/* Header - Click to expand */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-1 flex items-center justify-between hover:bg-purple-500/10 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-purple-400 text-xs">📍</span>
          <span className="text-xs font-semibold text-purple-300">KML Upload</span>
          {selectedFile && (
            <span className="text-xs bg-purple-800/50 px-1.5 py-0.5 rounded text-purple-200 truncate max-w-[120px]">
              {selectedFile.name}
            </span>
          )}
        </div>
        <span className={`text-purple-400 text-xs transition-transform ${isExpanded ? "rotate-180" : ""}`}>
          ▼
        </span>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-3 pb-2 pt-1.5 border-t border-purple-500/20 space-y-2">
          {/* File Selection */}
          <div className="flex items-center gap-1.5">
            <input
              ref={fileInputRef}
              type="file"
              accept=".kml"
              onChange={handleFileSelect}
              className="hidden"
              id="kml-file-input"
            />
            <label
              htmlFor="kml-file-input"
              className="flex-1 cursor-pointer bg-purple-900/30 border border-purple-500/30 rounded px-2 py-1 text-xs text-purple-200 hover:bg-purple-800/30 transition-colors flex items-center gap-1.5"
            >
              <span className="text-xs">📁</span>
              <span className="truncate">
                {selectedFile ? selectedFile.name : "Select KML file..."}
              </span>
            </label>
            {selectedFile && (
              <button
                onClick={handleClear}
                className="p-1 text-red-400 hover:bg-red-900/30 rounded transition-colors text-xs"
                title="Clear selection"
              >
                ✕
              </button>
            )}
            <button
              onClick={handleUpload}
              disabled={!selectedFile || isUploading}
              className={`px-2 py-1 rounded font-semibold text-xs transition-all ${!selectedFile || isUploading
                  ? "bg-gray-700 text-gray-400 cursor-not-allowed"
                  : "bg-purple-600 hover:bg-purple-500 text-white"
                }`}
            >
              {isUploading ? "⏳" : "📤 Upload"}
            </button>
          </div>

          {/* Progress Bar */}
          {(isUploading || uploadProgress > 0) && (
            <div className="space-y-0.5">
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${uploadProgress === 100 ? "bg-green-500" : "bg-purple-500"
                    }`}
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <div className={`text-[10px] ${uploadStatus.includes("✅") ? "text-green-400" :
                  uploadStatus.includes("❌") ? "text-red-400" :
                    "text-gray-400"
                }`}>
                {uploadStatus}
              </div>
            </div>
          )}

          {/* Info Text */}
          {uploadProgress === 100 && (
            <div className="text-[10px] text-gray-400 bg-green-900/20 border border-green-500/30 rounded px-2 py-1">
              <span className="text-green-400">✅ Done.</span>
              <span className="text-gray-400"> RPI generating waypoints.</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
