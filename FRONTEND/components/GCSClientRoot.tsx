"use client";

import dynamic from "next/dynamic";
import TelemetryBootstrap from "@/components/TelemetryBootstrap";

const GroundControlStation = dynamic(
  () => import("@/components/ground-control-station"),
  { ssr: false }
);

export default function GCSClientRoot() {
  return (
    <>
      <TelemetryBootstrap />
      <GroundControlStation />
    </>
  );
}
