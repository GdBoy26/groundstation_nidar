"use client"

interface CompassIndicatorProps {
  heading: number
}

export function CompassIndicator({ heading }: CompassIndicatorProps) {
  const directions = [
    { label: "N", deg: 0 },
    { label: "NE", deg: 45 },
    { label: "E", deg: 90 },
    { label: "SE", deg: 135 },
    { label: "S", deg: 180 },
    { label: "SW", deg: 225 },
    { label: "W", deg: 270 },
    { label: "NW", deg: 315 },
  ]

  return (
    <div className="bg-[#2a4a6a] h-8 relative overflow-hidden rounded-t w-full">
      {/* Compass tape */}
      <div
        className="absolute h-full flex items-center whitespace-nowrap"
        style={{
          transform: `translateX(calc(50% - ${(heading / 360) * 100}%))`,
        }}
      >
        {[-360, 0, 360].map((offset) => (
          <div key={offset} className="flex">
            {Array.from({ length: 37 }).map((_, i) => {
              const deg = i * 10 + offset
              const dir = directions.find((d) => d.deg === (deg + 360) % 360)
              return (
                <div key={deg} className="w-6 text-center">
                  <div className="text-[10px] text-white font-bold">
                    {dir ? dir.label : deg % 30 === 0 ? (deg + 360) % 360 : ""}
                  </div>
                  <div className={`h-2 w-px mx-auto ${deg % 30 === 0 ? "bg-white" : "bg-gray-400"}`} />
                </div>
              )
            })}
          </div>
        ))}
      </div>

      {/* Center marker */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-orange-500" />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-white" />
    </div>
  )
}
