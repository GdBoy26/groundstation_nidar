"use client";

import { useMemo } from "react";
import { useTelemetryStore } from "@/stores/telemetryStore";

interface LogPanelProps {
  type: "vtol" | "drone";
}

export function LogPanel({ type }: LogPanelProps) {
  const source = type === "vtol" ? "VTOL" : "DRONE";

  const logs = useTelemetryStore((s) => s.logs);
  const filteredLogs = useMemo(
    () => logs.filter((log) => log.source === source),
    [logs, source]
  );

  return (
    <div className="bg-black text-[8px] font-mono overflow-auto h-full">
      <table className="w-full">
        <thead className="sticky top-0 bg-gray-900">
          <tr className="text-gray-400">
            <th className="px-1 text-left">Time</th>
            <th className="px-1 text-left">Source</th>
            <th className="px-1 text-left">Message</th>
            <th className="px-1 text-center">Level</th>
          </tr>
        </thead>

        <tbody>
          {filteredLogs.map((log, i) => (
            <tr
              key={i}
              className={`hover:bg-gray-900 ${
                log.level === "ERROR"
                  ? "text-red-400"
                  : log.level === "WARN"
                  ? "text-yellow-400"
                  : "text-green-400"
              }`}
            >
              <td className="px-1 whitespace-nowrap">{log.time}</td>
              <td className="px-1">{log.source}</td>
              <td className="px-1">{log.message}</td>
              <td className="px-1 text-center">{log.level}</td>
            </tr>
          ))}

          {logs.length === 0 && (
            <tr className="text-gray-500">
              <td colSpan={4} className="px-2 py-2 text-center">
                No logs available
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
