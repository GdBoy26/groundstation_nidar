import { useMemo } from "react";
import { useTelemetryStore } from "@/stores/telemetryStore";

/**
 * Hook to get person detection logs only
 * Filters logs to show only "Person X detected at Lat: ..., Lon: ..." messages
 */
export function usePersonDetectionLogs() {
  const logs = useTelemetryStore((s) => s.logs);

  const personDetectionLogs = useMemo(() => {
    return logs.filter(
      (log) =>
        log.message.includes("Person") &&
        log.message.includes("detected") &&
        log.message.includes("Lat:") &&
        log.message.includes("Lon:")
    );
  }, [logs]);

  return personDetectionLogs;
}

/**
 * Hook to get the most recent person detection log
 */
export function useLatestPersonDetectionLog() {
  const logs = usePersonDetectionLogs();
  return logs.length > 0 ? logs[logs.length - 1]?.message : null;
}
