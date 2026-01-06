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
  const [missionTime, setMissionTime] = useState({ hours: 0, minutes: 0, seconds: 0 });
  const [vtolFlightTime, setVtolFlightTime] = useState({ hours: 0, minutes: 0, seconds: 0 });
  const [droneFlightTime, setDroneFlightTime] = useState({ hours: 0, minutes: 0, seconds: 0 });

  useEffect(() => {
    const startTime = Date.now();
    const vtolStart = Date.now();
    const droneStart = Date.now();

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      setMissionTime({
        hours: Math.floor(elapsed / 3600),
        minutes: Math.floor((elapsed % 3600) / 60),
        seconds: elapsed % 60
      });
      
      const vtolElapsed = Math.floor((Date.now() - vtolStart) / 1000);
      setVtolFlightTime({
        hours: Math.floor(vtolElapsed / 3600),
        minutes: Math.floor((vtolElapsed % 3600) / 60),
        seconds: vtolElapsed % 60
      });

      const droneElapsed = Math.floor((Date.now() - droneStart) / 1000);
      setDroneFlightTime({
        hours: Math.floor(droneElapsed / 3600),
        minutes: Math.floor((droneElapsed % 3600) / 60),
        seconds: droneElapsed % 60
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const AltitudeGauge = ({ altitude, label }: { altitude: number; label: string }) => {
    const maxAltitude = 300;
    const angle = -135 + (Math.min(altitude, maxAltitude) / maxAltitude) * 270;
    const rad = (angle * Math.PI) / 180;

    return (
      <div className="flex flex-col items-center gap-0.5">
        <div className="text-[9px] text-gray-400">{label}</div>
        <div className="relative w-20 h-20">
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <circle cx="50" cy="50" r="47" fill="#1a1a1a" stroke="#333" strokeWidth="2" />
            {[0, 75, 150, 225, 300].map((alt) => {
              const a = -135 + (alt / 300) * 270;
              const r = (a * Math.PI) / 180;
              const x1 = 50 + 37 * Math.cos(r);
              const y1 = 50 + 37 * Math.sin(r);
              const x2 = 50 + 44 * Math.cos(r);
              const y2 = 50 + 44 * Math.sin(r);
              const tx = 50 + 30 * Math.cos(r);
              const ty = 50 + 30 * Math.sin(r);
              return (
                <g key={alt}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="white" strokeWidth="1.5" />
                  <text x={tx} y={ty} fill="white" fontSize="5" textAnchor="middle" dominantBaseline="middle">
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
        </div>
      </div>
    );
  };

  const SpeedGauge = ({ speed, label }: { speed: number; label: string }) => {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <div className="text-[9px] text-gray-400">{label}</div>
        <div className="relative w-20 h-20">
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <circle cx="50" cy="50" r="47" fill="#1a1a1a" stroke="#333" strokeWidth="2" />
            {[0, 10, 20, 30, 40, 50, 60].map((spd) => {
              const angle = -135 + (spd / 60) * 270;
              const rad = (angle * Math.PI) / 180;
              const x1 = 50 + 37 * Math.cos(rad);
              const y1 = 50 + 37 * Math.sin(rad);
              const x2 = 50 + 44 * Math.cos(rad);
              const y2 = 50 + 44 * Math.sin(rad);
              const tx = 50 + 30 * Math.cos(rad);
              const ty = 50 + 30 * Math.sin(rad);
              return (
                <g key={spd}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="white" strokeWidth="1.5" />
                  <text x={tx} y={ty} fill="white" fontSize="5" textAnchor="middle" dominantBaseline="middle">
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
              stroke="red"
              strokeWidth="2"
              transform={`rotate(${-135 + (Math.min(speed, 60) / 60) * 270} 50 50)`}
            />
            <circle cx="50" cy="50" r="4" fill="#333" />
          </svg>
        </div>
        <div className="text-[9px] font-bold text-green-400">{speed.toFixed(1)} m/s</div>
      </div>
    );
  };

  return (
    <div className="bg-[#1a1a2e] h-full flex items-center justify-around gap-2 px-0 border-t border-[#2a2a5a] overflow-hidden">
      {/* VTOL Column */}
      <div className="flex flex-col items-center gap-1 flex-shrink-0">
        <div className="text-xs font-bold text-cyan-400">VTOL</div>
        <div className="flex gap-1.5 items-center">
          <SpeedGauge speed={speed} label="SPD" />
          
          {/* Readings between gauges */}
          <div className="grid grid-cols-2 gap-1.5 text-center flex-shrink-0">
            <div className="bg-[#0a0a1a] border border-green-500 px-1 py-0.5 rounded">
              <div className="text-[6px] text-gray-400">SPD</div>
              <div className="text-[10px] font-bold text-green-400">{speed.toFixed(1)}</div>
            </div>
            <div className="bg-[#0a0a1a] border border-cyan-500 px-1 py-0.5 rounded">
              <div className="text-[6px] text-gray-400">ALT</div>
              <div className="text-[10px] font-bold text-cyan-400">{vtolAltitude.toFixed(0)}</div>
            </div>
            <div className="bg-[#0a0a1a] border border-yellow-500 px-1 py-0.5 rounded col-span-2">
              <div className="text-[6px] text-gray-400">HDG</div>
              <div className="text-[10px] font-bold text-yellow-300">{Math.round(heading)}°</div>
            </div>
          </div>

          <AltitudeGauge altitude={vtolAltitude} label="ALT" />
        </div>
      </div>

      {/* Center - Compass & Times */}
      <div className="flex flex-col items-center gap-1 flex-shrink-0">
        {/* Compass */}
        <div className="relative w-24 h-24">
          <svg viewBox="0 0 100 100" className="w-full h-full">
            <circle cx="50" cy="50" r="45" fill="#1a1a1a" stroke="#333" strokeWidth="2" />
            <g transform={`rotate(${heading} 50 50)`}>
              {["N", "E", "S", "W"].map((dir, i) => {
                const angle = -90 + i * 90;
                const rad = (angle * Math.PI) / 180;
                const x = 50 + 35 * Math.cos(rad);
                const y = 50 + 35 * Math.sin(rad);
                return (
                  <text
                    key={dir}
                    x={x}
                    y={y}
                    fill="white"
                    fontSize="10"
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fontWeight="bold"
                  >
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

        {/* Time Displays below compass */}
        <div className="grid grid-cols-3 gap-1.5">
          <div className="bg-[#0a0a1a] border border-green-500 px-1 py-1 rounded text-center">
            <div className="text-[7px] text-gray-400">MIS</div>
            <div className="text-[11px] font-bold text-green-400 font-mono">
              {String(missionTime.hours).padStart(2, "0")}:{String(missionTime.minutes).padStart(2, "0")}:{String(missionTime.seconds).padStart(2, "0")}
            </div>
          </div>
          <div className="bg-[#0a0a1a] border border-blue-500 px-1 py-1 rounded text-center">
            <div className="text-[7px] text-gray-400">VFL</div>
            <div className="text-[11px] font-bold text-blue-400 font-mono">
              {String(vtolFlightTime.hours).padStart(2, "0")}:{String(vtolFlightTime.minutes).padStart(2, "0")}:{String(vtolFlightTime.seconds).padStart(2, "0")}
            </div>
          </div>
          <div className="bg-[#0a0a1a] border border-orange-500 px-1 py-1 rounded text-center">
            <div className="text-[7px] text-gray-400">DFL</div>
            <div className="text-[11px] font-bold text-orange-400 font-mono">
              {String(droneFlightTime.hours).padStart(2, "0")}:{String(droneFlightTime.minutes).padStart(2, "0")}:{String(droneFlightTime.seconds).padStart(2, "0")}
            </div>
          </div>
        </div>
      </div>

      {/* DRONE Column */}
      <div className="flex flex-col items-center gap-1 flex-shrink-0">
        <div className="text-xs font-bold text-orange-400">DRONE</div>
        <div className="flex gap-1.5 items-center">
          <AltitudeGauge altitude={droneAltitude} label="ALT" />
          
          {/* Readings between gauges */}
          <div className="grid grid-cols-2 gap-1.5 text-center flex-shrink-0">
            <div className="bg-[#0a0a1a] border border-cyan-500 px-1 py-0.5 rounded">
              <div className="text-[6px] text-gray-400">ALT</div>
              <div className="text-[10px] font-bold text-cyan-400">{droneAltitude.toFixed(0)}</div>
            </div>
            <div className="bg-[#0a0a1a] border border-green-500 px-1 py-0.5 rounded">
              <div className="text-[6px] text-gray-400">SPD</div>
              <div className="text-[10px] font-bold text-green-400">{speed.toFixed(1)}</div>
            </div>
            <div className="bg-[#0a0a1a] border border-yellow-500 px-1 py-0.5 rounded col-span-2">
              <div className="text-[6px] text-gray-400">HDG</div>
              <div className="text-[10px] font-bold text-yellow-300">{Math.round(heading)}°</div>
            </div>
          </div>

          <SpeedGauge speed={speed} label="SPD" />
        </div>
      </div>
    </div>
  );
}
