"use client"

import { useState, useEffect } from "react"

interface ControlGaugesProps {
  speed: number
  heading: number
  altitude: number
  vtolAltitude?: number
  droneAltitude?: number
}

export function ControlGauges({ 
  speed = 0, 
  heading = 0, 
  altitude = 0,
  vtolAltitude = 0,
  droneAltitude = 0
}: ControlGaugesProps) {
  const [elapsedTime, setElapsedTime] = useState({ hours: 0, minutes: 0, seconds: 0 });
  const [droneFlightTime, setDroneFlightTime] = useState({ hours: 0, minutes: 0, seconds: 0 });
  const [vtolFlightTime, setVtolFlightTime] = useState({ hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    const startTime = Date.now();
    const droneStart = Date.now();
    const vtolStart = Date.now();

    const interval = setInterval(() => {
      // Total mission time
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const hours = Math.floor(elapsed / 3600);
      const minutes = Math.floor((elapsed % 3600) / 60);
      const seconds = elapsed % 60;
      setElapsedTime({ hours, minutes, seconds });

      // Drone flight time
      const droneElapsed = Math.floor((Date.now() - droneStart) / 1000);
      const droneHours = Math.floor(droneElapsed / 3600);
      const droneMinutes = Math.floor((droneElapsed % 3600) / 60);
      const droneSeconds = droneElapsed % 60;
      setDroneFlightTime({ hours: droneHours, minutes: droneMinutes, seconds: droneSeconds });

      // VTOL flight time
      const vtolElapsed = Math.floor((Date.now() - vtolStart) / 1000);
      const vtolHours = Math.floor(vtolElapsed / 3600);
      const vtolMinutes = Math.floor((vtolElapsed % 3600) / 60);
      const vtolSeconds = vtolElapsed % 60;
      setVtolFlightTime({ hours: vtolHours, minutes: vtolMinutes, seconds: vtolSeconds });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Altitude gauge SVG component
  const AltitudeGauge = ({ altitude }: { altitude: number }) => {
    const maxAlt = 150;
    const angle = -135 + (altitude / maxAlt) * 270;
    return (
      <svg viewBox="0 0 100 100" className="w-16 h-16">
        <circle cx="50" cy="50" r="45" fill="#1a1a1a" stroke="#333" strokeWidth="2" />
        {[0, 30, 60, 90, 120, 150].map((alt) => {
          const a = -135 + (alt / maxAlt) * 270;
          const rad = (a * Math.PI) / 180;
          const x1 = 50 + 35 * Math.cos(rad);
          const y1 = 50 + 35 * Math.sin(rad);
          const x2 = 50 + 42 * Math.cos(rad);
          const y2 = 50 + 42 * Math.sin(rad);
          const tx = 50 + 28 * Math.cos(rad);
          const ty = 50 + 28 * Math.sin(rad);
          return (
            <g key={alt}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="white" strokeWidth="1.5" />
              <text x={tx} y={ty} fill="white" fontSize="6" textAnchor="middle" dominantBaseline="middle">
                {alt}
              </text>
            </g>
          );
        })}
        <line 
          x1="50" 
          y1="50" 
          x2="50" 
          y2="18" 
          stroke="cyan" 
          strokeWidth="2" 
          transform={`rotate(${angle} 50 50)`}
        />
        <circle cx="50" cy="50" r="4" fill="#333" />
      </svg>
    );
  };

  return (
    <div className="bg-[#1a1a2e] h-full flex items-center justify-between gap-4 px-4 border-t border-[#2a2a5a] overflow-hidden">
      {/* VTOL Side */}
      <div className="flex flex-col items-center gap-3">
        {/* VTOL Speed Gauge */}
        <div className="flex flex-col items-center gap-1">
          <div className="text-xs text-gray-400">VTOL SPEED</div>
          <div className="relative w-16 h-16">
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <circle cx="50" cy="50" r="45" fill="#1a1a1a" stroke="#333" strokeWidth="2" />
              {[0, 10, 20, 30, 40, 50, 60].map((spd) => {
                const angle = -135 + (spd / 60) * 270;
                const rad = (angle * Math.PI) / 180;
                const x1 = 50 + 35 * Math.cos(rad);
                const y1 = 50 + 35 * Math.sin(rad);
                const x2 = 50 + 42 * Math.cos(rad);
                const y2 = 50 + 42 * Math.sin(rad);
                const tx = 50 + 28 * Math.cos(rad);
                const ty = 50 + 28 * Math.sin(rad);
                return (
                  <g key={spd}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="white" strokeWidth="1.5" />
                    <text x={tx} y={ty} fill="white" fontSize="6" textAnchor="middle" dominantBaseline="middle">
                      {spd}
                    </text>
                  </g>
                );
              })}
              <line 
                x1="50" 
                y1="50" 
                x2="50" 
                y2="18" 
                stroke="orange" 
                strokeWidth="2" 
                transform={`rotate(${-135 + (speed / 60) * 270} 50 50)`}
              />
              <circle cx="50" cy="50" r="4" fill="#333" />
            </svg>
          </div>
          <div className="text-sm font-bold text-green-400">{speed.toFixed(1)} m/s</div>
        </div>

        {/* VTOL Altitude Gauge */}
        <div className="flex flex-col items-center gap-1">
          <div className="text-xs text-gray-400">VTOL ALT</div>
          <AltitudeGauge altitude={vtolAltitude} />
          <div className="text-sm font-bold text-cyan-400">{vtolAltitude.toFixed(0)}m</div>
        </div>

        {/* VTOL Flight Time */}
        <div className="bg-[#0a0a1a] border border-purple-500 px-2 py-1 rounded text-center">
          <div className="text-[10px] text-gray-400">VTOL FLT</div>
          <div className="text-xs font-bold text-purple-400">
            {String(vtolFlightTime.hours).padStart(2, '0')}:{String(vtolFlightTime.minutes).padStart(2, '0')}:{String(vtolFlightTime.seconds).padStart(2, '0')}
          </div>
        </div>
      </div>

      {/* Center - Compass & Times */}
      <div className="flex flex-col items-center gap-3">
        {/* Compass */}
        <div className="flex flex-col items-center gap-1">
          <div className="text-xs text-gray-400">HEADING</div>
          <div className="relative w-16 h-16">
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <circle cx="50" cy="50" r="45" fill="#1a1a1a" stroke="#333" strokeWidth="2" />
              <g transform={`rotate(${heading} 50 50)`}>
                {["N", "E", "S", "W"].map((dir, i) => {
                  const angle = -90 + i * 90;
                  const rad = (angle * Math.PI) / 180;
                  const x = 50 + 35 * Math.cos(rad);
                  const y = 50 + 35 * Math.sin(rad);
                  return (
                    <text key={dir} x={x} y={y} fill="white" fontSize="8" textAnchor="middle" dominantBaseline="middle" fontWeight="bold">
                      {dir}
                    </text>
                  );
                })}
              </g>
              <path d="M50 30L45 50H40L43 55H47L50 65L53 55H57L60 50H55L50 30Z" fill="yellow" />
              <line x1="50" y1="15" x2="50" y2="25" stroke="white" strokeWidth="1" />
              <line x1="50" y1="75" x2="50" y2="85" stroke="white" strokeWidth="1" />
              <line x1="15" y1="50" x2="25" y2="50" stroke="white" strokeWidth="1" />
              <line x1="75" y1="50" x2="85" y2="50" stroke="white" strokeWidth="1" />
            </svg>
          </div>
          <div className="text-sm font-bold text-yellow-400">{Math.round(heading)}°</div>
        </div>

        {/* Time Displays */}
        <div className="flex flex-col gap-2">
          <div className="bg-[#0a0a1a] border border-green-500 px-3 py-1 rounded font-mono text-center">
            <div className="text-[10px] text-gray-400">MISSION</div>
            <div className="text-xs font-bold text-green-400">
              {String(elapsedTime.hours).padStart(2, '0')}:{String(elapsedTime.minutes).padStart(2, '0')}:{String(elapsedTime.seconds).padStart(2, '0')}
            </div>
          </div>

          <div className="bg-[#0a0a1a] border border-blue-500 px-3 py-1 rounded font-mono text-center">
            <div className="text-[10px] text-gray-400">DRONE FLT</div>
            <div className="text-xs font-bold text-blue-400">
              {String(droneFlightTime.hours).padStart(2, '0')}:{String(droneFlightTime.minutes).padStart(2, '0')}:{String(droneFlightTime.seconds).padStart(2, '0')}
            </div>
          </div>
        </div>
      </div>

      {/* DRONE Side */}
      <div className="flex flex-col items-center gap-3">
        {/* DRONE Altitude Gauge */}
        <div className="flex flex-col items-center gap-1">
          <div className="text-xs text-gray-400">DRONE ALT</div>
          <AltitudeGauge altitude={droneAltitude} />
          <div className="text-sm font-bold text-cyan-400">{droneAltitude.toFixed(0)}m</div>
        </div>

        {/* DRONE Speed Gauge */}
        <div className="flex flex-col items-center gap-1">
          <div className="text-xs text-gray-400">DRONE SPEED</div>
          <div className="relative w-16 h-16">
            <svg viewBox="0 0 100 100" className="w-full h-full">
              <circle cx="50" cy="50" r="45" fill="#1a1a1a" stroke="#333" strokeWidth="2" />
              {[0, 10, 20, 30, 40, 50, 60].map((spd) => {
                const angle = -135 + (spd / 60) * 270;
                const rad = (angle * Math.PI) / 180;
                const x1 = 50 + 35 * Math.cos(rad);
                const y1 = 50 + 35 * Math.sin(rad);
                const x2 = 50 + 42 * Math.cos(rad);
                const y2 = 50 + 42 * Math.sin(rad);
                const tx = 50 + 28 * Math.cos(rad);
                const ty = 50 + 28 * Math.sin(rad);
                return (
                  <g key={spd}>
                    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="white" strokeWidth="1.5" />
                    <text x={tx} y={ty} fill="white" fontSize="6" textAnchor="middle" dominantBaseline="middle">
                      {spd}
                    </text>
                  </g>
                );
              })}
              <line 
                x1="50" 
                y1="50" 
                x2="50" 
                y2="18" 
                stroke="orange" 
                strokeWidth="2" 
                transform={`rotate(${-135 + (speed / 60) * 270} 50 50)`}
              />
              <circle cx="50" cy="50" r="4" fill="#333" />
            </svg>
          </div>
          <div className="text-sm font-bold text-green-400">{speed.toFixed(1)} m/s</div>
        </div>

        {/* DRONE Flight Time */}
        <div className="bg-[#0a0a1a] border border-blue-500 px-2 py-1 rounded text-center">
          <div className="text-[10px] text-gray-400">DRONE FLT</div>
          <div className="text-xs font-bold text-blue-400">
            {String(droneFlightTime.hours).padStart(2, '0')}:{String(droneFlightTime.minutes).padStart(2, '0')}:{String(droneFlightTime.seconds).padStart(2, '0')}
          </div>
        </div>
      </div>
    </div>
  );
}
