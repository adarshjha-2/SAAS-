import type { HashLabLimits, HeaderPreset, JobView } from "@/types/hashlab";
import type {
  ActivityPage,
  HealthResponse,
  ModuleDescriptor,
  ServerActivityEntry,
  SystemInfo,
} from "@/types/api";

/** A controllable stand-in for the browser WebSocket. */
export class FakeSocket {
  static instances: FakeSocket[] = [];

  readonly url: string;
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  static reset(): void {
    FakeSocket.instances = [];
  }

  static latest(): FakeSocket {
    const socket = FakeSocket.instances.at(-1);
    if (!socket) throw new Error("no FakeSocket created");
    return socket;
  }

  static factory = (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
  }

  // --- test controls ---
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  receive(message: unknown): void {
    const data = typeof message === "string" ? message : JSON.stringify(message);
    this.onmessage?.(new MessageEvent("message", { data }));
  }

  drop(): void {
    this.readyState = 3;
    this.onerror?.(new Event("error"));
    this.onclose?.(new CloseEvent("close", { code: 1006 }));
  }
}

export const healthFixture: HealthResponse = {
  status: "ok",
  version: "0.1.0",
  environment: "development",
  uptime_seconds: 42,
  server_time: "2026-11-05T00:00:00Z",
  checks: { api: "ok", realtime: "ok", database: "ok" },
};

export const infoFixture: SystemInfo = {
  name: "NEXUS HASH AI",
  tagline: "Intelligence Beyond Computational Limits.",
  version: "0.1.0",
  api_version: "v1",
  environment: "development",
  features: { llm_configured: false, docs_enabled: true },
  limits: { max_request_body_bytes: 1_048_576, ws_max_connections: 32, ws_max_message_bytes: 4_096 },
  realtime: {
    path: "/ws/v1",
    topics: ["system", "activity", "hashlab", "hardware", "network", "intelligence"],
    heartbeat_seconds: 5,
    connections: 0,
  },
  database: { schema_revision: "0001", activity_retention_days: 30, activity_max_entries: 50_000 },
  disclaimers: [
    "HashLab is an educational simulator. Simulated hashes are never submitted to the Bitcoin network and cannot earn bitcoin.",
    "Profitability figures are estimates based on stated assumptions and live data that changes constantly. They are not a guarantee of earnings.",
    "NEXUS HASH AI never starts an intensive workload, spends money, or uses cloud computing without your explicit permission.",
  ],
};

export const modulesFixture: ModuleDescriptor[] = [
  ["command", "Nexus Command", 2],
  ["hashlab", "HashLab", 4],
  ["hardware", "Hardware Intelligence", 5],
  ["network", "Bitcoin Network Intelligence", 6],
  ["profitability", "Profitability Intelligence", 7],
  ["intelligence", "Nexus Intelligence", 8],
  ["core", "NEXUS CORE", 8],
].map(([key, name, milestone]) => ({
  key: key as ModuleDescriptor["key"],
  name: name as string,
  summary: `${name as string} summary.`,
  milestone: milestone as number,
  status: key === "command" || key === "hashlab" ? ("online" as const) : ("planned" as const),
  api_prefix: null,
}));

export function serverEntry(id: number, overrides: Partial<ServerActivityEntry> = {}): ServerActivityEntry {
  return {
    id,
    ts: new Date(Date.UTC(2026, 10, 5, 9, 0, id)).toISOString(),
    level: "info",
    category: "system",
    actor: "system",
    message: `Server event ${id}`,
    detail: null,
    context: null,
    ...overrides,
  };
}

export const activityFixture: ActivityPage = {
  items: [
    serverEntry(2, { message: "NEXUS HASH AI 0.1.0 started", detail: "Environment: development" }),
    serverEntry(1, {
      level: "success",
      category: "database",
      message: "Database schema migrated to revision 0001",
    }),
  ],
  next_before_id: null,
};

/** The URL of a fetch() argument, whatever its form. */
export function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

export const limitsFixture: HashLabLimits = {
  max_difficulty_bits: 32,
  max_job_seconds: 60,
  consent_threshold_seconds: 2,
  nonce_space: 2 ** 32,
  worker_processes: 1,
};

export const genesisPreset: HeaderPreset = {
  key: "genesis",
  name: "Genesis block (height 0)",
  description: "The first Bitcoin block.",
  header: {
    version: 1,
    prev_block_hash: "0".repeat(64),
    merkle_root: "4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b",
    timestamp: 1_231_006_505,
    bits: 0x1d00ffff,
    nonce: 2_083_236_893,
  },
  block_hash: "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
};

export function jobFixture(overrides: Partial<JobView> = {}): JobView {
  return {
    simulated: true,
    id: "a".repeat(32),
    kind: "mine",
    status: "running",
    difficulty_bits: 20,
    expected_attempts: 2 ** 20,
    max_seconds: 2,
    consent: false,
    attempts: 524_288,
    elapsed_seconds: 0.4,
    hash_rate_hs: 1_310_720,
    best_hash: "00000a" + "f".repeat(58),
    best_zero_bits: 20,
    found_nonce: null,
    found_hash: null,
    error: null,
    created_at: "2026-11-05T12:00:00Z",
    started_at: "2026-11-05T12:00:00Z",
    finished_at: null,
    ...overrides,
  };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Route fetch calls to fixtures by URL path, like the real backend. */
export function backendFetch(overrides: Partial<Record<string, () => Response>> = {}) {
  const routes: Record<string, () => Response> = {
    "/api/v1/system/health": () => jsonResponse(healthFixture),
    "/api/v1/system/info": () => jsonResponse(infoFixture),
    "/api/v1/system/modules": () => jsonResponse(modulesFixture),
    "/api/v1/activity": () => jsonResponse(activityFixture),
    "/api/v1/hashlab/limits": () => jsonResponse(limitsFixture),
    "/api/v1/hashlab/presets": () => jsonResponse([genesisPreset]),
    "/api/v1/hashlab/jobs": () => jsonResponse([]),
  };
  return (input: RequestInfo | URL): Promise<Response> => {
    const path = new URL(urlOf(input), "http://localhost").pathname;
    const handler = overrides[path] ?? routes[path];
    return Promise.resolve(
      handler ? handler() : jsonResponse({ error: { code: "not_found", message: "Not Found" } }, 404),
    );
  };
}
