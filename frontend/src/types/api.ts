/**
 * API contract types. These mirror the backend Pydantic models in
 * `backend/nexus_hash/api/system.py` and `backend/nexus_hash/core/*`.
 */

export type CheckStatus = "ok" | "degraded" | "down";
export type Environment = "development" | "test" | "production";
export type ModuleStatus = "planned" | "in_development" | "online";

export type ModuleKey =
  "command" | "hashlab" | "hardware" | "network" | "profitability" | "intelligence" | "core";

export type Topic = "system" | "activity" | "hashlab" | "hardware" | "network" | "intelligence";

export interface HealthResponse {
  status: CheckStatus;
  version: string;
  environment: Environment;
  uptime_seconds: number;
  server_time: string;
  checks: Record<string, CheckStatus>;
}

export interface SystemInfo {
  name: string;
  tagline: string;
  version: string;
  api_version: string;
  environment: Environment;
  features: { llm_configured: boolean; docs_enabled: boolean };
  limits: {
    max_request_body_bytes: number;
    ws_max_connections: number;
    ws_max_message_bytes: number;
  };
  realtime: {
    path: string;
    topics: Topic[];
    heartbeat_seconds: number;
    connections: number;
  };
  database: {
    schema_revision: string | null;
    activity_retention_days: number;
    activity_max_entries: number;
  };
  disclaimers: string[];
}

export type ActivityLevelName = "info" | "success" | "warning" | "error";
export type ActivityCategoryName =
  "system" | "database" | "hashlab" | "hardware" | "network" | "profitability" | "intelligence" | "core";

export interface ServerActivityEntry {
  id: number;
  ts: string;
  level: ActivityLevelName;
  category: ActivityCategoryName;
  actor: "system" | "user";
  message: string;
  detail: string | null;
  context: Record<string, unknown> | null;
}

export interface ActivityPage {
  items: ServerActivityEntry[];
  next_before_id: number | null;
}

export interface ModuleDescriptor {
  key: ModuleKey;
  name: string;
  summary: string;
  milestone: number;
  status: ModuleStatus;
  api_prefix: string | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    request_id?: string;
    details?: Record<string, unknown>[];
  };
}

// --- Realtime protocol ----------------------------------------------------

export interface RealtimeEvent<T = Record<string, unknown>> {
  kind: "event";
  topic: Topic;
  type: string;
  ts: string;
  data: T;
}

export interface SystemHeartbeat {
  status: CheckStatus;
  version: string;
  uptime_seconds: number;
  server_time: string;
  connections: number;
}

export type ServerMessage =
  | { kind: "welcome"; client_id: string; server_version: string; topics_available: Topic[] }
  | { kind: "ack"; action: "subscribe" | "unsubscribe"; topics: Topic[] }
  | { kind: "pong"; id: string | null; ts: string }
  | { kind: "error"; code: string; message: string }
  | RealtimeEvent;
