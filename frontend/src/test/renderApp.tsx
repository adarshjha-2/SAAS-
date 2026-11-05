import { QueryClient } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import { AppProviders } from "@/app/AppProviders";
import { ActivityLog } from "@/lib/activity";
import { APP_TOPICS, RealtimeConnection } from "@/lib/realtime";
import { routes } from "@/routes";

import { FakeSocket } from "./fakes";

/** Shared full-app test harness: real routes and providers, fake socket, controllable clock. */
export const HEARTBEAT = {
  kind: "event",
  topic: "system",
  type: "heartbeat",
  ts: "2026-11-05T00:00:00Z",
  data: { status: "ok", version: "0.1.0", uptime_seconds: 3_725, server_time: "", connections: 1 },
};

export function renderApp(path = "/", { backoffMs = 60_000 }: { backoffMs?: number } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let clock = 1_000;
  const connection = new RealtimeConnection({
    url: "ws://test/ws/v1",
    topics: APP_TOPICS, // exactly what production subscribes to
    createSocket: FakeSocket.factory,
    backoff: () => backoffMs,
    pingIntervalMs: 60_000, // one ping on open; no interval noise during a test
    monotonicNow: () => clock,
  });
  const activityLog = new ActivityLog();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders queryClient={queryClient} connection={connection} activityLog={activityLog}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return {
    connection,
    router,
    queryClient,
    activityLog,
    advanceClock: (ms: number) => {
      clock += ms;
    },
  };
}

/** Open the fake socket, answer the first ping after `rttMs`, and deliver a heartbeat. */
export function goLive(advanceClock: (ms: number) => void, rttMs = 12) {
  const socket = FakeSocket.latest();
  act(() => {
    socket.open();
    advanceClock(rttMs);
    socket.receive({ kind: "pong", id: "p1", ts: "now" });
    socket.receive(HEARTBEAT);
  });
  return socket;
}
