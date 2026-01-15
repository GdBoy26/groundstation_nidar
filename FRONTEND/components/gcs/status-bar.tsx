"use client"

interface StatusBarProps {
  personCount: number
  vtolBattery: number
  droneBattery: number
  personDelivered: number
  latitude: string
  longitude: string
  cog: number
  sog: number
  vtolHardwareConnected?: boolean
  droneHardwareConnected?: boolean
}

export function StatusBar({
  personCount,
  vtolBattery,
  droneBattery,
  personDelivered,
  latitude,
  longitude,
  cog,
  sog,
  vtolHardwareConnected = false,
  droneHardwareConnected = false,
}: StatusBarProps) {
  return (
    <div className="bg-[#1a1a2e] py-2 px-4 flex items-center justify-between gap-4 border-t border-[#2a2a5a] h-auto overflow-hidden">
      {/* VTOL Connection Status */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-gray-300 text-xs whitespace-nowrap">VTOL:</span>
        <div className={`px-2 py-1 rounded text-xs font-bold ${vtolHardwareConnected ? 'bg-green-900/50 border border-green-500 text-green-400' : 'bg-red-900/50 border border-red-500 text-red-400'}`}>
          {vtolHardwareConnected ? '● CONNECTED' : '○ DISCONNECTED'}
        </div>
      </div>

      {/* VTOL Battery */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-gray-300 text-xs whitespace-nowrap">BATT:</span>
        <div className={`bg-[#0a0a1a] border px-2 py-1 min-w-[50px] text-center ${vtolBattery < 20 ? 'border-red-500' : vtolBattery < 50 ? 'border-yellow-500' : 'border-green-500'}`}>
          <span className={`text-lg font-bold ${vtolBattery < 20 ? 'text-red-400' : vtolBattery < 50 ? 'text-yellow-400' : 'text-green-400'}`}>
            {Math.round(vtolBattery)}%
          </span>
        </div>
      </div>

      {/* Person Count */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-gray-300 text-xs whitespace-nowrap">PERSONS:</span>
        <div className="bg-[#0a0a1a] border border-gray-600 px-2 py-1 min-w-[40px] text-center">
          <span className="text-white text-lg font-bold">{personCount.toString().padStart(2, "0")}</span>
        </div>
      </div>

      {/* GPS Info */}
      <div className="bg-[#0a0a1a] border border-gray-600 px-2 py-1 text-xs flex-shrink-0">
        <div className="flex gap-2">
          <div className="min-w-max">
            <span className="text-gray-400">Lat</span>
            <div className="text-cyan-400 font-bold text-[10px] whitespace-nowrap">{latitude}</div>
          </div>
          <div className="min-w-max">
            <span className="text-gray-400">Lon</span>
            <div className="text-cyan-400 font-bold text-[10px] whitespace-nowrap">{longitude}</div>
          </div>
        </div>
        <div className="flex gap-2 mt-1">
          <div className="min-w-max">
            <span className="text-gray-400">COG</span>
            <span className="text-white ml-1">{Math.round(cog)}°</span>
          </div>
          <div className="min-w-max">
            <span className="text-gray-400">SOG</span>
            <span className="text-white ml-1">{sog.toFixed(1)}</span>
            <span className="text-gray-500 text-[9px]">m/s</span>
          </div>
        </div>
      </div>

      {/* Person Delivered */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-gray-300 text-xs whitespace-nowrap">DELIVERED:</span>
        <div className="bg-[#0a0a1a] border border-gray-600 px-2 py-1 min-w-[40px] text-center">
          <span className="text-white text-lg font-bold">{personDelivered.toString().padStart(2, "0")}</span>
        </div>
      </div>

      {/* Drone Connection Status */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-gray-300 text-xs whitespace-nowrap">DRONE:</span>
        <div className={`px-2 py-1 rounded text-xs font-bold ${droneHardwareConnected ? 'bg-green-900/50 border border-green-500 text-green-400' : 'bg-red-900/50 border border-red-500 text-red-400'}`}>
          {droneHardwareConnected ? '● CONNECTED' : '○ DISCONNECTED'}
        </div>
      </div>

      {/* Drone Battery */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-gray-300 text-xs whitespace-nowrap">BATT:</span>
        <div className={`bg-[#0a0a1a] border px-2 py-1 min-w-[50px] text-center ${droneBattery < 20 ? 'border-red-500' : droneBattery < 50 ? 'border-yellow-500' : 'border-green-500'}`}>
          <span className={`text-lg font-bold ${droneBattery < 20 ? 'text-red-400' : droneBattery < 50 ? 'text-yellow-400' : 'text-green-400'}`}>
            {Math.round(droneBattery)}%
          </span>
        </div>
      </div>
    </div>
  )
}
