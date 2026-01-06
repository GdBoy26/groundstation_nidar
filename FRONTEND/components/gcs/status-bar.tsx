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
}: StatusBarProps) {
  return (
    <div className="bg-[#1a1a2e] py-2 px-4 flex items-center justify-between gap-4 border-t border-[#2a2a5a] h-auto overflow-hidden">
      {/* Person Count */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-gray-300 text-xs whitespace-nowrap">PERSONS:</span>
        <div className="bg-[#0a0a1a] border border-gray-600 px-2 py-1 min-w-[40px] text-center">
          <span className="text-white text-lg font-bold">{personCount.toString().padStart(2, "0")}</span>
        </div>
      </div>

      {/* VTOL Battery */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-gray-300 text-xs whitespace-nowrap">VTOL:</span>
        <div className="relative w-12 h-6 border-2 border-gray-400 rounded-sm bg-[#0a0a1a]">
          <div className="absolute left-0 top-0 bottom-0 bg-green-500" style={{ width: `${vtolBattery}%` }} />
          <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-1 h-2 bg-gray-400 rounded-r" />
        </div>
        <span className="text-gray-400 text-xs whitespace-nowrap">{vtolBattery}%</span>
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

      {/* Drone Battery */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-gray-300 text-xs whitespace-nowrap">DRONE:</span>
        <div className="relative w-12 h-6 border-2 border-gray-400 rounded-sm bg-[#0a0a1a]">
          <div className="absolute left-0 top-0 bottom-0 bg-green-500" style={{ width: `${droneBattery}%` }} />
          <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-1 h-2 bg-gray-400 rounded-r" />
        </div>
        <span className="text-gray-400 text-xs whitespace-nowrap">{droneBattery}%</span>
      </div>

      {/* Person Delivered */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <span className="text-gray-300 text-xs whitespace-nowrap">DELIVERED:</span>
        <div className="bg-[#0a0a1a] border border-gray-600 px-2 py-1 min-w-[40px] text-center">
          <span className="text-white text-lg font-bold">{personDelivered.toString().padStart(2, "0")}</span>
        </div>
      </div>
    </div>
  )
}
