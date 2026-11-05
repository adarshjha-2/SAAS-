import { useEffect, useRef } from "react";

import { useActivityLog } from "@/lib/activityContext";
import type { ConnectionStatus } from "@/lib/realtime";
import { useRealtime } from "@/lib/realtimeContext";

import { useHealth } from "./useSystem";

type BackendState = "pending" | "ok" | "degraded" | "offline";

/**
 * Records real, observed state transitions of this session into the activity
 * log: realtime stream connects/drops and backend health changes. Mount once,
 * high in the tree (the app shell).
 */
export function useActivityRecorder(): void {
  const log = useActivityLog();
  const { status } = useRealtime();
  const health = useHealth();

  const previousStream = useRef<ConnectionStatus | null>(null);
  useEffect(() => {
    const previous = previousStream.current;
    previousStream.current = status;
    if (previous === status) return;
    if (status === "open") {
      const restored = previous === "reconnecting";
      log.add({
        level: restored ? "success" : "info",
        message: restored ? "Realtime stream restored" : "Realtime stream connected",
      });
    } else if (status === "reconnecting" && previous === "open") {
      log.add({ level: "warning", message: "Realtime stream lost — reconnecting" });
    }
  }, [status, log]);

  const backend: BackendState = health.isError
    ? "offline"
    : health.data === undefined
      ? "pending"
      : health.data.status === "ok"
        ? "ok"
        : "degraded";
  const previousBackend = useRef<BackendState>("pending");
  const errorMessage = health.error?.message;
  const degradedChecks = health.data
    ? Object.entries(health.data.checks)
        .filter(([, value]) => value !== "ok")
        .map(([name]) => name)
        .join(", ")
    : "";
  const version = health.data?.version;

  useEffect(() => {
    const previous = previousBackend.current;
    previousBackend.current = backend;
    if (previous === backend || backend === "pending") return;
    if (backend === "ok") {
      log.add(
        previous === "pending"
          ? { level: "info", message: `Backend API online (v${version ?? "?"})` }
          : { level: "success", message: "Backend API recovered" },
      );
    } else if (backend === "degraded") {
      log.add({ level: "warning", message: "Backend reported degraded health", detail: degradedChecks });
    } else {
      log.add({
        level: "error",
        message: "Backend API unreachable",
        ...(errorMessage ? { detail: errorMessage } : {}),
      });
    }
  }, [backend, log, version, degradedChecks, errorMessage]);
}
