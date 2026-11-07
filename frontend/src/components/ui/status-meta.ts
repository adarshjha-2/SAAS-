import type { ModuleStatus } from "@/types/api";

export type Tone = "ok" | "warn" | "fault" | "idle" | "flux" | "ember";

export const MODULE_STATUS_META: Record<ModuleStatus, { tone: Tone; label: string }> = {
  online: { tone: "ok", label: "Online" },
  in_development: { tone: "warn", label: "In development" },
  planned: { tone: "idle", label: "Planned" },
};
