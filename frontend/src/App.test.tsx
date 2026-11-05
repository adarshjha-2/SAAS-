import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RealtimeConnection } from "@/lib/realtime";
import { RealtimeProvider } from "@/lib/RealtimeProvider";
import { routes } from "@/routes";
import { backendFetch, FakeSocket, infoFixture, jsonResponse } from "@/test/fakes";

function renderApp(path = "/") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const connection = new RealtimeConnection({
    url: "ws://test/ws/v1",
    topics: ["system"],
    createSocket: FakeSocket.factory,
    backoff: () => 60_000,
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider connection={connection}>
        <RouterProvider router={router} />
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  return { connection, router, queryClient };
}

function primaryNav() {
  return screen.getByRole("navigation", { name: "Primary" });
}

beforeEach(() => {
  FakeSocket.reset();
});

describe("NEXUS HASH AI shell", () => {
  it("renders the command center from live backend data", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    renderApp("/");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Command Center");
    expect(await screen.findByText("API online")).toBeInTheDocument();
    expect(await screen.findByText("OFFLINE MODE")).toBeInTheDocument();
    expect(await screen.findByText("Bitcoin Network Intelligence")).toBeInTheDocument();
    for (const disclaimer of infoFixture.disclaimers) {
      expect(screen.getByText(disclaimer)).toBeInTheDocument();
    }
    expect(screen.getByText("1 MiB")).toBeInTheDocument();
  });

  it("lists every module in the primary navigation with its milestone", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    renderApp("/");
    const nav = primaryNav();
    expect(within(nav).getAllByRole("link")).toHaveLength(7);
    expect(await within(nav).findByText("M4")).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: /NEXUS CORE/ })).toHaveAttribute("href", "/core");
  });

  it("goes live when the realtime stream delivers a heartbeat", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    renderApp("/");
    await screen.findByText("API online");

    const socket = FakeSocket.latest();
    act(() => {
      socket.open();
      socket.receive({
        kind: "event",
        topic: "system",
        type: "heartbeat",
        ts: "2026-11-05T00:00:00Z",
        data: { status: "ok", version: "0.1.0", uptime_seconds: 3_725, server_time: "", connections: 1 },
      });
    });

    expect(screen.getByText("Stream live")).toBeInTheDocument();
    expect(screen.getByText("1 active connection")).toBeInTheDocument();
    expect(screen.getByText("01:02:05")).toBeInTheDocument();
  });

  it("never presents stale values as live after the backend goes down", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    const { queryClient } = renderApp("/");
    await screen.findByText("API online");
    const socket = FakeSocket.latest();
    act(() => {
      socket.open();
      socket.receive({
        kind: "event",
        topic: "system",
        type: "heartbeat",
        ts: "2026-11-05T00:00:00Z",
        data: { status: "ok", version: "0.1.0", uptime_seconds: 3_725, server_time: "", connections: 1 },
      });
    });
    expect(screen.getByText("1 active connection")).toBeInTheDocument();

    // Backend dies: the dev proxy answers 502 and the socket drops.
    fetchSpy.mockImplementation(() => Promise.resolve(new Response("Bad Gateway", { status: 502 })));
    act(() => socket.drop());
    await act(() => queryClient.refetchQueries());

    const status = within(screen.getByRole("region", { name: "Platform status" }));
    expect(await status.findByText("OFFLINE")).toBeInTheDocument();
    expect(status.getByText("Last seen v0.1.0")).toBeInTheDocument();
    expect(status.getByText("Unavailable while the backend is offline")).toBeInTheDocument();
    expect(status.getByText("RECONNECTING")).toBeInTheDocument();
    expect(status.getByText("Retrying (attempt 1)")).toBeInTheDocument();
    expect(status.queryByText("1 active connection")).not.toBeInTheDocument();
    expect(status.queryByText("01:02:05")).not.toBeInTheDocument();
    expect(screen.getByText(/gateway returned 502/)).toBeInTheDocument();
  });

  it("explains how to recover when the backend is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    renderApp("/");
    expect(await screen.findByText("Backend unreachable")).toBeInTheDocument();
    expect(screen.getByText("API offline")).toBeInTheDocument();
    expect(screen.getByText("Cannot reach the NEXUS HASH AI backend.")).toBeInTheDocument();
  });

  it("shows API degraded when a health check fails", async () => {
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
  });

  it("renders a planned module honestly, without fake metrics", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    renderApp("/hashlab");
    expect(await screen.findByRole("heading", { level: 1, name: "HashLab" })).toBeInTheDocument();
    // Once in the header badge, once in the charter notice.
    expect(await screen.findAllByText("Milestone 4")).toHaveLength(2);
    expect(within(screen.getByRole("main")).getByText("Planned")).toBeInTheDocument();
    expect(screen.getByText(/never shows placeholder figures/)).toBeInTheDocument();
  });

  it("handles unknown routes", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    renderApp("/does-not-exist");
    expect(await screen.findByText("Signal lost")).toBeInTheDocument();
  });
});
