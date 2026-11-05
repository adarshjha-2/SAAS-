import type { RealtimeEvent, ServerMessage, Topic } from "@/types/api";

import { API_BASE_URL } from "./api";

export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

/** An event plus the local time it arrived (for client-side interpolation). */
export type ReceivedEvent = RealtimeEvent & { receivedAt: number };

export interface RealtimeSnapshot {
  status: ConnectionStatus;
  clientId: string | null;
  reconnectAttempt: number;
  lastMessageAt: number | null;
  events: Partial<Record<Topic, ReceivedEvent>>;
}

export const INITIAL_SNAPSHOT: RealtimeSnapshot = {
  status: "idle",
  clientId: null,
  reconnectAttempt: 0,
  lastMessageAt: null,
  events: {},
};

/** Exponential backoff with jitter: 1s, 2s, 4s ... capped at 30s, scaled by 50-100%. */
export function computeBackoff(
  attempt: number,
  { baseMs = 1_000, maxMs = 30_000, random = Math.random } = {},
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(ceiling * (0.5 + random() * 0.5));
}

/** Resolve the WebSocket URL for a backend path such as `/ws/v1`. */
export function buildRealtimeUrl(
  path: string,
  location: Pick<Location, "protocol" | "host"> = window.location,
  apiBase: string = API_BASE_URL,
): string {
  if (apiBase) {
    const url = new URL(path, apiBase);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return url.toString();
  }
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}${path}`;
}

function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && "kind" in value) {
      return value as ServerMessage;
    }
  } catch {
    // Ignore malformed frames; the server only sends JSON.
  }
  return null;
}

type WebSocketFactory = (url: string) => WebSocket;

const WS_CONNECTING = 0; // WebSocket.CONNECTING, without relying on a global

export interface RealtimeConnectionOptions {
  url: string;
  topics: Topic[];
  createSocket?: WebSocketFactory;
  backoff?: (attempt: number) => number;
}

/**
 * A self-healing WebSocket connection to the NEXUS realtime hub.
 *
 * Framework-agnostic on purpose: React binds to it through
 * `useSyncExternalStore`, and tests drive it with a fake socket.
 */
export class RealtimeConnection {
  private readonly url: string;
  private readonly topics: Topic[];
  private readonly createSocket: WebSocketFactory;
  private readonly backoff: (attempt: number) => number;

  private socket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private snapshot: RealtimeSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();

  constructor({ url, topics, createSocket, backoff }: RealtimeConnectionOptions) {
    this.url = url;
    this.topics = topics;
    this.createSocket = createSocket ?? ((target) => new WebSocket(target));
    this.backoff = backoff ?? ((attempt) => computeBackoff(attempt));
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): RealtimeSnapshot => this.snapshot;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onmessage = socket.onclose = socket.onerror = null;
      if (socket.readyState === WS_CONNECTING) {
        // Closing a socket mid-handshake makes browsers log a warning (this happens on every
        // React StrictMode remount), so let the handshake finish and close it then.
        socket.onopen = () => socket.close();
      } else {
        socket.onopen = null;
        socket.close();
      }
    }
    this.update({ status: "closed", clientId: null });
  }

  private update(patch: Partial<RealtimeSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  private connect(): void {
    const attempt = this.snapshot.reconnectAttempt;
    this.update({ status: attempt === 0 ? "connecting" : "reconnecting" });

    let socket: WebSocket;
    try {
      socket = this.createSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.update({ status: "open", reconnectAttempt: 0 });
      if (this.topics.length > 0) {
        socket.send(JSON.stringify({ action: "subscribe", topics: this.topics }));
      }
    };
    socket.onmessage = (message: MessageEvent) => this.handleMessage(message.data);
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      this.scheduleReconnect();
    };
    // Errors are always followed by `close`, which drives reconnection.
    socket.onerror = () => undefined;
  }

  private handleMessage(raw: unknown): void {
    const message = parseServerMessage(raw);
    if (!message) return;
    const now = Date.now();
    switch (message.kind) {
      case "welcome":
        this.update({ clientId: message.client_id, lastMessageAt: now });
        break;
      case "event":
        this.update({
          lastMessageAt: now,
          events: { ...this.snapshot.events, [message.topic]: { ...message, receivedAt: now } },
        });
        break;
      case "error":
        console.warn(`[realtime] server rejected a message: ${message.code}`);
        this.update({ lastMessageAt: now });
        break;
      default:
        this.update({ lastMessageAt: now });
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    const attempt = this.snapshot.reconnectAttempt;
    this.update({ status: "reconnecting", clientId: null, reconnectAttempt: attempt + 1 });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.running) this.connect();
    }, this.backoff(attempt));
  }
}
