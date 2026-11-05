import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeSocket } from "@/test/fakes";

import { buildRealtimeUrl, computeBackoff, RealtimeConnection } from "./realtime";

function connect(backoff = () => 1_000) {
  const connection = new RealtimeConnection({
    url: "ws://test/ws/v1",
    topics: ["system"],
    createSocket: FakeSocket.factory,
    backoff,
  });
  connection.start();
  return connection;
}

beforeEach(() => {
  FakeSocket.reset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("computeBackoff", () => {
  it("doubles from the base delay and applies jitter", () => {
    expect(computeBackoff(0, { random: () => 1 })).toBe(1_000);
    expect(computeBackoff(0, { random: () => 0 })).toBe(500);
    expect(computeBackoff(3, { random: () => 1 })).toBe(8_000);
  });

  it("caps at the maximum delay", () => {
    expect(computeBackoff(20, { random: () => 1 })).toBe(30_000);
    expect(computeBackoff(-1, { random: () => 1 })).toBe(1_000);
  });
});

describe("buildRealtimeUrl", () => {
  it("uses the page origin with the matching ws scheme", () => {
    expect(buildRealtimeUrl("/ws/v1", { protocol: "http:", host: "localhost:5173" }, "")).toBe(
      "ws://localhost:5173/ws/v1",
    );
    expect(buildRealtimeUrl("/ws/v1", { protocol: "https:", host: "nexus.example" }, "")).toBe(
      "wss://nexus.example/ws/v1",
    );
  });

  it("honours an explicit API base URL", () => {
    const location = { protocol: "http:", host: "ignored" };
    expect(buildRealtimeUrl("/ws/v1", location, "https://api.nexus.example")).toBe(
      "wss://api.nexus.example/ws/v1",
    );
  });
});

describe("RealtimeConnection", () => {
  it("subscribes to topics once the socket opens", () => {
    const connection = connect();
    expect(connection.getSnapshot().status).toBe("connecting");

    FakeSocket.latest().open();

    expect(connection.getSnapshot().status).toBe("open");
    expect(FakeSocket.latest().sent).toEqual([JSON.stringify({ action: "subscribe", topics: ["system"] })]);
  });

  it("records the client id and the latest event per topic", () => {
    const connection = connect();
    const socket = FakeSocket.latest();
    socket.open();
    socket.receive({ kind: "welcome", client_id: "abc", server_version: "0.1.0", topics_available: [] });
    socket.receive({ kind: "event", topic: "system", type: "heartbeat", ts: "t1", data: { n: 1 } });
    socket.receive({ kind: "event", topic: "system", type: "heartbeat", ts: "t2", data: { n: 2 } });

    const snapshot = connection.getSnapshot();
    expect(snapshot.clientId).toBe("abc");
    expect(snapshot.events.system?.data).toEqual({ n: 2 });
    expect(snapshot.events.system?.receivedAt).toBeTypeOf("number");
  });

  it("ignores malformed frames", () => {
    const connection = connect();
    const socket = FakeSocket.latest();
    socket.open();
    const before = connection.getSnapshot();
    socket.receive("{not json");
    socket.receive(JSON.stringify({ no: "kind" }));
    expect(connection.getSnapshot()).toBe(before);
  });

  it("reconnects with backoff after the socket drops", () => {
    const backoff = vi.fn(() => 2_000);
    const connection = connect(backoff);
    FakeSocket.latest().open();
    FakeSocket.latest().drop();

    expect(connection.getSnapshot()).toMatchObject({ status: "reconnecting", reconnectAttempt: 1 });
    expect(backoff).toHaveBeenCalledWith(0);
    expect(FakeSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1_999);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);

    FakeSocket.latest().drop();
    expect(backoff).toHaveBeenLastCalledWith(1);
    vi.advanceTimersByTime(2_000);
    FakeSocket.latest().open();
    expect(connection.getSnapshot()).toMatchObject({ status: "open", reconnectAttempt: 0 });
  });

  it("stops cleanly and never reconnects afterwards", () => {
    const connection = connect();
    const socket = FakeSocket.latest();
    socket.open();
    connection.stop();

    expect(socket.closed).toBe(true);
    expect(socket.onclose).toBeNull();
    expect(connection.getSnapshot().status).toBe("closed");
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("defers closing a socket that is still handshaking", () => {
    const connection = connect();
    const socket = FakeSocket.latest();
    connection.stop();
    expect(socket.closed).toBe(false);

    socket.open();

    expect(socket.closed).toBe(true);
    expect(socket.sent).toEqual([]); // never subscribed after stop
    expect(connection.getSnapshot().status).toBe("closed");
  });

  it("cancels a pending reconnect when stopped", () => {
    const connection = connect();
    FakeSocket.latest().drop();
    connection.stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("is idempotent on start and restartable after stop (React StrictMode)", () => {
    const connection = connect();
    connection.start();
    expect(FakeSocket.instances).toHaveLength(1);
    connection.stop();
    connection.start();
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("retries when the socket constructor throws", () => {
    let calls = 0;
    const connection = new RealtimeConnection({
      url: "ws://test",
      topics: [],
      backoff: () => 100,
      createSocket: (url) => {
        calls += 1;
        if (calls === 1) throw new Error("blocked");
        return FakeSocket.factory(url);
      },
    });
    connection.start();
    expect(connection.getSnapshot().status).toBe("reconnecting");
    vi.advanceTimersByTime(100);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("notifies and unsubscribes listeners", () => {
    const connection = connect();
    const listener = vi.fn();
    const unsubscribe = connection.subscribe(listener);
    FakeSocket.latest().open();
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    unsubscribe();
    FakeSocket.latest().receive({ kind: "pong", ts: "now" });
    expect(listener).not.toHaveBeenCalled();
  });
});
