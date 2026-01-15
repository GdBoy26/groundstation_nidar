"use client"

interface ArtificialHorizonProps {
  pitch: number
  roll: number
  altitude: number
  airspeed: number
  groundSpeed: number
  armed: boolean
  flying: boolean
  batteryVoltage: number
  batteryCurrent: number
  batteryPercent: number
}

export function ArtificialHorizon({
  pitch = 0,
  roll = 0,
  altitude = 0,
  airspeed = 0,
  groundSpeed = 0,
  armed = false,
  flying = false,
  batteryVoltage = 12.6,
  batteryCurrent = 0,
  batteryPercent = 100,
}: ArtificialHorizonProps) {
  // Determine status display
  const getStatusDisplay = () => {
    if (!armed) return "DISARMED";
    if (!flying) return "ARMED";
    return "FLYING";
  };

  const statusDisplay = getStatusDisplay();
  const statusColor = !armed ? "text-red-400" : flying ? "text-green-400" : "text-yellow-400";
  return (
    <div className="relative bg-gradient-to-b from-[#4a90d9] via-[#87ceeb] to-[#87ceeb] rounded overflow-hidden w-full aspect-[4/3]">
      {/* Sky portion */}
      <div
        className="absolute inset-0"
        style={{
          transform: `rotate(${roll}deg)`,
          transformOrigin: "center center",
        }}
      >
        {/* Sky */}
        <div
          className="absolute w-[200%] left-[-50%]"
          style={{
            height: `${50 - pitch}%`,
            background: "linear-gradient(to bottom, #4a90d9 0%, #87ceeb 100%)",
            top: 0,
          }}
        />
        {/* Ground */}
        <div
          className="absolute w-[200%] left-[-50%] bottom-0"
          style={{
            height: `${50 + pitch}%`,
            background: "linear-gradient(to bottom, #8B4513 0%, #6B8E23 20%, #228B22 100%)",
          }}
        />
        {/* Horizon line */}
        <div className="absolute w-[200%] left-[-50%] h-1 bg-red-600" style={{ top: `${50 - pitch}%` }} />

        {/* Pitch ladder with more visible markings */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative">
            {[-30, -20, -10, 0, 10, 20, 30].map((line) => (
              <div
                key={line}
                className="absolute flex items-center gap-2"
                style={{
                  top: `${-line * 3.5 + pitch * 3.5}px`,
                  left: "50%",
                  transform: "translateX(-50%)",
                }}
              >
                <span className={`text-[9px] font-bold ${line === 0 ? "text-yellow-300" : "text-white"}`}>
                  {line === 0 ? "" : line}
                </span>
                <div
                  className={`h-px ${
                    line === 0 ? "w-32 bg-yellow-400 shadow-lg" : line % 10 === 0 ? "w-16 bg-white" : "w-8 bg-gray-300"
                  }`}
                />
                <span className={`text-[9px] font-bold ${line === 0 ? "text-yellow-300" : "text-white"}`}>
                  {line === 0 ? "" : line}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Roll indicator arc at top */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 w-32 h-16">
        <svg viewBox="0 0 200 100" className="w-full h-full">
          {/* Arc background */}
          <path d="M 20 80 A 60 60 0 0 1 180 80" stroke="#333" strokeWidth="2" fill="none" />
          
          {/* Roll degree markings */}
          {[-30, -20, -10, 0, 10, 20, 30].map((deg) => {
            const angle = 180 - (deg + 30) * 3;
            const rad = (angle * Math.PI) / 180;
            const x1 = 100 + 60 * Math.cos(rad);
            const y1 = 80 + 60 * Math.sin(rad);
            const x2 = 100 + 70 * Math.cos(rad);
            const y2 = 80 + 70 * Math.sin(rad);
            return (
              <g key={`roll-mark-${deg}`}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="white" strokeWidth="1.5" />
                <text x={100 + 45 * Math.cos(rad)} y={80 + 45 * Math.sin(rad)} fill="white" fontSize="8" textAnchor="middle" dominantBaseline="middle">
                  {deg}
                </text>
              </g>
            );
          })}
          
          {/* Roll indicator pointer */}
          <g transform={`translate(100, 80)`}>
            <polygon points="0,-8 -4,0 4,0" fill="#FF6600" />
          </g>
        </svg>
      </div>

      {/* Pitch and Roll degree display - Large and prominent */}
      <div className="absolute top-2 right-2 bg-black/70 px-3 py-2 rounded border border-cyan-400">
        <div className="text-cyan-300 text-[11px] font-mono font-bold flex gap-4">
          <div>
            <div className="text-[9px] text-gray-300">PITCH</div>
            <div className="text-base text-yellow-300">{pitch.toFixed(1)}°</div>
          </div>
          <div>
            <div className="text-[9px] text-gray-300">ROLL</div>
            <div className="text-base text-yellow-300">{roll.toFixed(1)}°</div>
          </div>
        </div>
      </div>

      {/* Status overlay */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-black/50 px-3 py-1 rounded">
        <span className={`text-sm font-bold ${status === "DISARMED" ? "text-red-500" : "text-green-500"}`}>
          {status}
        </span>
      </div>

      {/* Aircraft reference */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
        <svg width="80" height="30" viewBox="0 0 80 30">
          <path d="M0 15 L30 15 L40 25 L50 15 L80 15" stroke="#FF6600" strokeWidth="3" fill="none" />
          <circle cx="40" cy="15" r="3" fill="#FF6600" />
        </svg>
      </div>

      {/* Left scale - Airspeed */}
      <div className="absolute left-1 top-1/4 bottom-1/4 w-6 bg-[#d4e4f7]/80 rounded flex flex-col justify-between py-1">
        <span className="text-[8px] text-gray-800 text-center">0</span>
        <span className="text-[8px] text-gray-800 text-center">-10</span>
        <span className="text-[8px] text-gray-800 text-center">-20</span>
      </div>
      <div className="absolute left-0 bottom-2 text-[9px] text-white font-bold">
        <div>AS {airspeed.toFixed(1)}</div>
        <div>GS {groundSpeed.toFixed(1)}</div>
      </div>

      {/* Right scale - Altitude */}
      <div className="absolute right-1 top-1/4 bottom-1/4 w-6 bg-[#d4e4f7]/80 rounded flex flex-col justify-between py-1">
        <span className="text-[8px] text-gray-800 text-center">10</span>
        <span className="text-[8px] text-gray-800 text-center">0</span>
        <span className="text-[8px] text-gray-800 text-center">-10</span>
        <span className="text-[8px] text-gray-800 text-center">-20</span>
      </div>
      <div className="absolute right-0 bottom-2 text-[9px] text-white font-bold text-right">
        <div>Alt</div>
        <div className="text-base text-cyan-300">{(altitude ?? 0).toFixed(0)}m</div>
      </div>

      {/* Bottom info bar */}
      <div className="absolute bottom-0 left-0 right-0 bg-[#1a3a1a]/90 text-[9px] text-green-300 px-2 py-1 flex justify-between font-mono">
        <span>
          Bat {(batteryVoltage ?? 0).toFixed(1)}V {(batteryCurrent ?? 0).toFixed(1)}A {batteryPercent ?? 0}%
        </span>
        <span className={statusColor}>{statusDisplay}</span>
        <span>EKF</span>
        <span>Vibe</span>
        <span>GPS 3D Fix</span>
      </div>
    </div>
  )
}
