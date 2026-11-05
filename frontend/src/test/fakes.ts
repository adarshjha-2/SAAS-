import type { HealthResponse, ModuleDescriptor, SystemInfo } from "@/types/api";

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
  checks: { api: "ok", realtime: "ok" },
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
  status: key === "command" ? ("online" as const) : ("planned" as const),
  api_prefix: null,
}));

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
  };
  return (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, "http://localhost").pathname;
    const handler = overrides[path] ?? routes[path];
    return Promise.resolve(
      handler ? handler() : jsonResponse({ error: { code: "not_found", message: "Not Found" } }, 404),
    );
  };
}
