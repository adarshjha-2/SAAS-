import type { RealtimeEvent, ServerMessage, Topic } from "@/types/api";

import { API_BASE_URL } from "./api";
import { appendSample, type Sample } from "./telemetry";

export type ConnectionStatus = "idle" | "connecting" | "open" | "reconnecting" | "closed";

/** An event plus the local time it arrived (for client-side interpolation). */
export type ReceivedEvent = RealtimeEvent & { receivedAt: number };

export interface RealtimeSnapshot {
  status: ConnectionStatus;
  clientId: string | null;
  reconnectAttempt: number;
  lastMessageAt: number | null;
  events: Partial<Record<Topic, ReceivedEvent>>;
  /** Most recent ping round-trip in ms; null while disconnected. */
  latencyMs: number | null;
  /** Round-trip history (wall-clock timestamps), kept across reconnects. */
  rttSamples: readonly Sample[];
}

export const INITIAL_SNAPSHOT: RealtimeSnapshot = {
  status: "idle",
  clientId: null,
  reconnectAttempt: 0,
  lastMessageAt: null,
  events: {},
  latencyMs: null,
  rttSamples: [],
};

/** Topics every tab subscribes to; module pages add their own as they ship. */
export const APP_TOPICS: readonly Topic[] = ["system", "activity", "hashlab", "hardware"];

const DEFAULT_PING_INTERVAL_MS = 5_000;
const MAX_PENDING_PINGS = 8;

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
  topics: readonly Topic[];
  createSocket?: WebSocketFactory;
  backoff?: (attempt: number) => number;
  /** How often to measure round-trip latency while open; 0 disables pinging. */
  pingIntervalMs?: number;
  /** Monotonic clock for latency measurement (defaults to `performance.now`). */
  monotonicNow?: () => number;
}

/**
 * A self-healing WebSocket connection to the NEXUS realtime hub.
 *
 * Framework-agnostic on purpose: React binds to it through
 * `useSyncExternalStore`, and tests drive it with a fake socket.
 */
export class RealtimeConnection {
  private readonly url: string;
  private readonly topics: readonly Topic[];
  private readonly createSocket: WebSocketFactory;
  private readonly backoff: (attempt: number) => number;
  private readonly pingIntervalMs: number;
  private readonly monotonicNow: () => number;

  private socket: WebSocket | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pendingPings = new Map<string, number>();
  private pingSequence = 0;
  private running = false;
  private snapshot: RealtimeSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Map<Topic, Set<(event: ReceivedEvent) => void>>();

  constructor({
    url,
    topics,
    createSocket,
    backoff,
    pingIntervalMs,
    monotonicNow,
  }: RealtimeConnectionOptions) {
    this.url = url;
    this.topics = topics;
    this.createSocket = createSocket ?? ((target) => new WebSocket(target));
    this.backoff = backoff ?? ((attempt) => computeBackoff(attempt));
    this.pingIntervalMs = pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    this.monotonicNow = monotonicNow ?? (() => performance.now());
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): RealtimeSnapshot => this.snapshot;

  /**
   * Receive every event on a topic, synchronously and in order. Use this for
   * event streams (e.g. activity entries); the snapshot only keeps the latest
   * event per topic, so bursts between renders would otherwise be lost.
   */
  onEvent(topic: Topic, listener: (event: ReceivedEvent) => void): () => void {
    let listeners = this.eventListeners.get(topic);
    if (!listeners) {
      listeners = new Set();
      this.eventListeners.set(topic, listeners);
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.stopPinging();
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
    this.update({ status: "closed", clientId: null, latencyMs: null });
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
      this.startPinging(socket);
    };
    socket.onmessage = (message: MessageEvent) => this.handleMessage(message.data);
    socket.onclose = () => {
      if (this.socket === socket) this.socket = null;
      this.stopPinging();
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
      case "event": {
        const received: ReceivedEvent = { ...message, receivedAt: now };
        this.update({
          lastMessageAt: now,
          events: { ...this.snapshot.events, [message.topic]: received },
        });
        this.eventListeners.get(message.topic)?.forEach((listener) => listener(received));
        break;
      }
      case "pong":
        this.recordPong(message.id, now);
        break;
      case "error":
        console.warn(`[realtime] server rejected a message: ${message.code}`);
        this.update({ lastMessageAt: now });
        break;
      default:
        this.update({ lastMessageAt: now });
    }
  }

  private startPinging(socket: WebSocket): void {
    this.stopPinging();
    if (this.pingIntervalMs <= 0) return;
    const ping = () => {
      this.pingSequence += 1;
      const id = `p${this.pingSequence}`;
      this.pendingPings.set(id, this.monotonicNow());
      // Bound memory if pongs never arrive: forget the oldest outstanding ping.
      if (this.pendingPings.size > MAX_PENDING_PINGS) {
        const oldest = this.pendingPings.keys().next().value;
        if (oldest !== undefined) this.pendingPings.delete(oldest);
      }
      socket.send(JSON.stringify({ action: "ping", id }));
    };
    ping();
    this.pingTimer = setInterval(ping, this.pingIntervalMs);
  }

  private stopPinging(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.pendingPings.clear();
  }

  private recordPong(id: string | null, receivedAt: number): void {
    const sentAt = id === null ? undefined : this.pendingPings.get(id);
    if (id === null || sentAt === undefined) {
      this.update({ lastMessageAt: receivedAt });
      return;
    }
    this.pendingPings.delete(id);
    const rtt = Math.max(0, this.monotonicNow() - sentAt);
    this.update({
      lastMessageAt: receivedAt,
      latencyMs: rtt,
      rttSamples: appendSample(this.snapshot.rttSamples, { t: receivedAt, value: rtt }),
    });
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    const attempt = this.snapshot.reconnectAttempt;
    this.update({
      status: "reconnecting",
      clientId: null,
      reconnectAttempt: attempt + 1,
      latencyMs: null,
    });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.running) this.connect();
    }, this.backoff(attempt));
  }
}
