import { CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from "lucide-react";

import type { ActivityLevel } from "@/lib/activity";

/** Every level is an icon plus a text label, never colour alone. */
export const ACTIVITY_LEVELS: Record<ActivityLevel, { icon: LucideIcon; label: string; className: string }> =
  {
    info: { icon: Info, label: "Info", className: "text-ink-muted" },
    success: { icon: CircleCheck, label: "Success", className: "text-ok" },
    warning: { icon: TriangleAlert, label: "Warning", className: "text-warn" },
    error: { icon: CircleX, label: "Error", className: "text-fault" },
  };
