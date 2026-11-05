import { QueryClient } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppProviders } from "@/app/AppProviders";
import { ActivityLog } from "@/lib/activity";
import { RealtimeConnection } from "@/lib/realtime";
import { routes } from "@/routes";
import { backendFetch, FakeSocket, infoFixture, jsonResponse } from "@/test/fakes";

const HEARTBEAT = {
  kind: "event",
  topic: "system",
  type: "heartbeat",
  ts: "2026-11-05T00:00:00Z",
  data: { status: "ok", version: "0.1.0", uptime_seconds: 3_725, server_time: "", connections: 1 },
};

function renderApp(path = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let clock = 1_000;
  const connection = new RealtimeConnection({
    url: "ws://test/ws/v1",
    topics: ["system"],
    createSocket: FakeSocket.factory,
    backoff: () => 60_000,
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
function goLive(advanceClock: (ms: number) => void, rttMs = 12) {
  const socket = FakeSocket.latest();
  act(() => {
    socket.open();
    advanceClock(rttMs);
    socket.receive({ kind: "pong", id: "p1", ts: "now" });
    socket.receive(HEARTBEAT);
  });
  return socket;
}

// Pages are code-split, so the shell renders once the route chunk resolves.
const primaryNav = () => screen.findByRole("navigation", { name: "Primary" });
const statusTiles = () => within(screen.getByRole("region", { name: "Platform status" }));

beforeEach(() => {
  FakeSocket.reset();
});

describe("Nexus Command dashboard", () => {
  it("renders platform status from live backend data", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    renderApp("/");

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Command Center");
    expect(await screen.findByText("API online")).toBeInTheDocument();
    expect(await statusTiles().findByText("OFFLINE MODE")).toBeInTheDocument();
    expect(await statusTiles().findByText("1 / 7")).toBeInTheDocument();
    for (const disclaimer of infoFixture.disclaimers) {
      expect(screen.getByText(disclaimer)).toBeInTheDocument();
    }
  });

  it("shows measured round-trip latency once the stream is live", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    const { advanceClock } = renderApp("/");
    await screen.findByText("API online");

    const socket = goLive(advanceClock, 12);

    expect(JSON.parse(socket.sent[1] ?? "{}")).toEqual({ action: "ping", id: "p1" });
    expect(screen.getByText("Stream live")).toBeInTheDocument();
    expect(statusTiles().getByText("12 ms")).toBeInTheDocument();
    expect(statusTiles().getByText("Round-trip · 1 connection")).toBeInTheDocument();
    expect(statusTiles().getByText("01:02:05")).toBeInTheDocument();
  });

  it("records real connection and health transitions in the activity log", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    const { advanceClock } = renderApp("/");
    const log = await screen.findByRole("list", { name: "Activity log" });
    expect(await within(log).findByText("Backend API online (v0.1.0)")).toBeInTheDocument();

    const socket = goLive(advanceClock);
    expect(within(log).getByText("Realtime stream connected")).toBeInTheDocument();

    act(() => socket.drop());
    expect(within(log).getByText("Realtime stream lost — reconnecting")).toBeInTheDocument();
    // Newest first.
    expect(within(log).getAllByRole("listitem")[0]).toHaveTextContent("Realtime stream lost");
  });

  it("charts latency with a legend, and offers an accessible table view", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    renderApp("/");
    await screen.findByText("API online");

    const legend = await screen.findByRole("list", { name: "Platform latency legend" });
    expect(within(legend).getByText("Realtime round-trip")).toBeInTheDocument();
    expect(within(legend).getByText("API health check")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Realtime round-trip" })).toBeInTheDocument();
  });

  it("reserves module panels with honest empty states, never stand-in data", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    renderApp("/");
    const section = within(await screen.findByRole("region", { name: "Module intelligence" }));
    expect(await section.findByText("Arrives in Milestone 5")).toBeInTheDocument();
    expect(section.getByText("Arrives in Milestone 4")).toBeInTheDocument();
    expect(section.getByText("Arrives in Milestone 6")).toBeInTheDocument();
    expect(section.getByText("Arrives in Milestone 8")).toBeInTheDocument();
    expect(section.getAllByText("Planned")).toHaveLength(4);
  });

  it("lists every module in the primary navigation with its status", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    renderApp("/");
    const nav = await primaryNav();
    expect(within(nav).getAllByRole("link")).toHaveLength(7);
    expect(await within(nav).findByText("M4")).toBeInTheDocument();
    // Online modules show no milestone marker.
    expect(within(nav).queryByText("M2")).not.toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /NEXUS CORE/ })).toHaveAttribute("href", "/core");
  });

  it("never presents stale values as live after the backend goes down", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    const { queryClient, advanceClock } = renderApp("/");
    await screen.findByText("API online");
    const socket = goLive(advanceClock);
    expect(statusTiles().getByText("Round-trip · 1 connection")).toBeInTheDocument();

    // Backend dies: the dev proxy answers 502 and the socket drops.
    fetchSpy.mockImplementation(() => Promise.resolve(new Response("Bad Gateway", { status: 502 })));
    act(() => socket.drop());
    await act(() => queryClient.refetchQueries());

    const tiles = statusTiles();
    expect(await tiles.findByText("OFFLINE")).toBeInTheDocument();
    expect(tiles.getByText("Last seen v0.1.0")).toBeInTheDocument();
    expect(tiles.getByText("Unavailable while the backend is offline")).toBeInTheDocument();
    expect(tiles.getByText("RECONNECTING")).toBeInTheDocument();
    expect(tiles.getByText("Retrying (attempt 1)")).toBeInTheDocument();
    expect(tiles.queryByText("12 ms")).not.toBeInTheDocument();
    expect(tiles.queryByText("01:02:05")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/gateway returned 502/);
    expect(screen.getAllByText("Offline").length).toBeGreaterThan(0); // telemetry provenance badge
  });

  it("explains how to recover when the backend is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    renderApp("/");
    expect(await screen.findByText("Backend unreachable")).toBeInTheDocument();
    expect(screen.getByText("API offline")).toBeInTheDocument();
    const alert = within(screen.getByRole("alert"));
    expect(alert.getByText("Cannot reach the NEXUS HASH AI backend.")).toBeInTheDocument();
    // The same failure is recorded in the activity log, with the reason as detail.
    const log = within(screen.getByRole("list", { name: "Activity log" }));
    expect(log.getByText("Backend API unreachable")).toBeInTheDocument();
  });

  it("shows API degraded when a health check reports it", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      backendFetch({
        "/api/v1/system/health": () =>
          jsonResponse({
            status: "degraded",
            version: "0.1.0",
            environment: "development",
            uptime_seconds: 1,
            server_time: "",
            checks: { api: "ok", realtime: "degraded" },
          }),
      }),
    );
    renderApp("/");
    expect(await screen.findByText("API degraded")).toBeInTheDocument();
    const log = await screen.findByRole("list", { name: "Activity log" });
    expect(await within(log).findByText("Backend reported degraded health")).toBeInTheDocument();
    expect(within(log).getByText("realtime")).toBeInTheDocument();
  });
});

describe("routing", () => {
  it("renders a planned module honestly, without fake metrics", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    renderApp("/hashlab");
    expect(await screen.findByRole("heading", { level: 1, name: "HashLab" })).toBeInTheDocument();
    expect(await screen.findAllByText("Milestone 4")).toHaveLength(2);
    expect(screen.getByText(/never shows placeholder figures/)).toBeInTheDocument();
  });

  it("handles unknown routes", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    renderApp("/does-not-exist");
    expect(await screen.findByText("Signal lost")).toBeInTheDocument();
  });

  it("offers a skip link to the main content", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    renderApp("/");
    expect(await screen.findByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });
});
