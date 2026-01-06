"use client"

interface FlightInstrumentsProps {
  droneSpeed: number
  vtolSpeed: number
  droneAltitude: number
  vtolAltitude: number
  droneHeading: number
  vtolHeading: number
}

export function FlightInstruments({
  droneSpeed,
  vtolSpeed,
  droneAltitude,
  vtolAltitude,
  droneHeading,
  vtolHeading,
}: FlightInstrumentsProps) {
  return (
    <div className="bg-[#1a1a2e] border-t border-[#2a2a5a] px-4 py-3 flex items-center justify-center gap-12 overflow-hidden">
      {/* VTOL Instruments */}
      <div className="flex items-center justify-center gap-6">
        <div className="text-center">
          <div className="text-xs text-gray-400 mb-2">VTOL SPEED</div>
          <div className="relative w-20 h-20">
            <svg viewBox="0 0 100 100" className="w-full h-full">
              {/* Gauge circle */}
              <circle cx="50" cy="50" r="45" fill="#1a1a1a" stroke="#333" strokeWidth="2" />
              
              {/* Speed markings 0-20 */}
              {[0, 5, 10, 15, 20].map((speed) => {
                const angle = -135 + (speed / 20) * 270;
                const rad = (angle * Math.PI) / 180;
                const x1 = 50 + 38 * Math.cos(rad);
                const y1 = 50 + 38 * Math.sin(rad);
                const x2 = 50 + 45 * Math.cos(rad);
                const y2 = 50 + 45 * Math.sin(rad);
                return (
                  <g key={`vtol-speed-${speed}`}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="white" strokeWidth="1" />
                    <text x={50 + 32 * Math.cos(rad)} y={50 + 32 * Math.sin(rad)} fill="white" fontSize="6" textAnchor="middle" dominantBaseline="middle">
                      {speed}
                    </text>
                  </g>
                );
              })}
              
              {/* Speed needle */}
              <line 
                x1="50" 
                y1="50" 
                x2="50" 
                y2="15" 
                stroke="#FF6600" 
                strokeWidth="2" 
                transform={`rotate(${-135 + (Math.min(vtolSpeed, 20) / 20) * 270} 50 50)`}
              />
              <circle cx="50" cy="50" r="3" fill="#FF6600" />
              
              {/* Speed value */}
              <text x="50" y="70" fill="#00FF00" fontSize="8" textAnchor="middle" fontWeight="bold">
                {vtolSpeed.toFixed(1)}
              </text>
            </svg>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {/* Altitude box */}
          <div className="bg-[#0a0a1a] border border-cyan-500 px-3 py-2 text-center rounded">
            <div className="text-xs text-gray-400">ALT</div>
            <div className="text-lg font-bold text-cyan-300">{vtolAltitude.toFixed(0)}m</div>
          </div>

          {/* Heading box */}
          <div className="bg-[#0a0a1a] border border-yellow-500 px-3 py-2 text-center rounded">
            <div className="text-xs text-gray-400">HDG</div>
            <div className="text-lg font-bold text-yellow-300">{Math.round(vtolHeading)}°</div>
          </div>
        </div>
      </div>

      {/* Center divider */}
      <div className="h-16 w-px bg-gradient-to-b from-transparent via-[#2a2a5a] to-transparent"></div>

      {/* DRONE Instruments */}
      <div className="flex items-center justify-center gap-6">
        <div className="flex flex-col gap-2">
          {/* Altitude box */}
          <div className="bg-[#0a0a1a] border border-cyan-500 px-3 py-2 text-center rounded">
            <div className="text-xs text-gray-400">ALT</div>
            <div className="text-lg font-bold text-cyan-300">{droneAltitude.toFixed(0)}m</div>
          </div>

          {/* Heading box */}
          <div className="bg-[#0a0a1a] border border-yellow-500 px-3 py-2 text-center rounded">
            <div className="text-xs text-gray-400">HDG</div>
            <div className="text-lg font-bold text-yellow-300">{Math.round(droneHeading)}°</div>
          </div>
        </div>

        <div className="text-center">
          <div className="text-xs text-gray-400 mb-2">DRONE SPEED</div>
          <div className="relative w-20 h-20">
            <svg viewBox="0 0 100 100" className="w-full h-full">
              {/* Gauge circle */}
              <circle cx="50" cy="50" r="45" fill="#1a1a1a" stroke="#333" strokeWidth="2" />
              
              {/* Speed markings 0-20 */}
              {[0, 5, 10, 15, 20].map((speed) => {
                const angle = -135 + (speed / 20) * 270;
                const rad = (angle * Math.PI) / 180;
                const x1 = 50 + 38 * Math.cos(rad);
                const y1 = 50 + 38 * Math.sin(rad);
                const x2 = 50 + 45 * Math.cos(rad);
                const y2 = 50 + 45 * Math.sin(rad);
                return (
                  <g key={`drone-speed-${speed}`}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="white" strokeWidth="1" />
                    <text x={50 + 32 * Math.cos(rad)} y={50 + 32 * Math.sin(rad)} fill="white" fontSize="6" textAnchor="middle" dominantBaseline="middle">
                      {speed}
                    </text>
                  </g>
                );
              })}
              
              {/* Speed needle */}
              <line 
                x1="50" 
                y1="50" 
                x2="50" 
                y2="15" 
                stroke="#FF6600" 
                strokeWidth="2" 
                transform={`rotate(${-135 + (Math.min(droneSpeed, 20) / 20) * 270} 50 50)`}
              />
              <circle cx="50" cy="50" r="3" fill="#FF6600" />
              
              {/* Speed value */}
              <text x="50" y="70" fill="#00FF00" fontSize="8" textAnchor="middle" fontWeight="bold">
                {droneSpeed.toFixed(1)}
              </text>
            </svg>
          </div>
        </div>
      </div>
    </div>
  )
}
