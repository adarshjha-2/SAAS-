import {
  Bot,
  BrainCircuit,
  Calculator,
  Cpu,
  FlaskConical,
  Globe,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";

import type { ModuleKey } from "@/types/api";

export interface NavItem {
  key: ModuleKey;
  path: string;
  label: string;
  icon: LucideIcon;
  section: "command" | "modules" | "assistant";
}

/** Route table for product modules. Status and milestone come from the backend catalog. */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "command", path: "/", label: "Nexus Command", icon: LayoutDashboard, section: "command" },
  {
    key: "intelligence",
    path: "/intelligence",
    label: "Nexus Intelligence",
    icon: BrainCircuit,
    section: "modules",
  },
  { key: "hashlab", path: "/hashlab", label: "HashLab", icon: FlaskConical, section: "modules" },
  { key: "hardware", path: "/hardware", label: "Hardware", icon: Cpu, section: "modules" },
  { key: "network", path: "/network", label: "Bitcoin Network", icon: Globe, section: "modules" },
  {
    key: "profitability",
    path: "/profitability",
    label: "Profitability",
    icon: Calculator,
    section: "modules",
  },
  { key: "core", path: "/core", label: "NEXUS CORE", icon: Bot, section: "assistant" },
];

/** Titles for routes that are not product modules. */
export const PAGE_TITLES: Record<string, string> = {
  "/activity": "Activity log",
};

export const NAV_SECTIONS: { id: NavItem["section"]; label: string }[] = [
  { id: "command", label: "Command" },
  { id: "modules", label: "Intelligence Modules" },
  { id: "assistant", label: "AI Agent" },
];
