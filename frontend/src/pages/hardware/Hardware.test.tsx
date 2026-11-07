import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { withGaps } from "@/lib/telemetry";
import { backendFetch, FakeSocket, hardwareSample, urlOf } from "@/test/fakes";
import { goLive, renderApp } from "@/test/renderApp";

const tiles = async () => within(await screen.findByRole("region", { name: "Live hardware" }));

beforeEach(() => {
  FakeSocket.reset();
});

describe("Hardware page", () => {
  it("shows live readings for what the machine supports", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    renderApp("/hardware");
    const live = await tiles();
    expect(await live.findByText("12.5%")).toBeInTheDocument(); // latest CPU sample
    expect(live.getByText("4 cores · 2100 MHz")).toBeInTheDocument();
    expect(live.getByText("25.0%")).toBeInTheDocument();
    expect(live.getByText("4 GiB of 16 GiB")).toBeInTheDocument();
    expect(live.getByText("0.42")).toBeInTheDocument();
    expect(live.getByText("1 min · 5 min 0.30 · 15 min 0.20 · 4 cores")).toBeInTheDocument();
  });

  it("never shows a zero for metrics the machine cannot provide", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    renderApp("/hardware");
    const live = await tiles();
    expect(await live.findAllByText("Not available")).toHaveLength(3); // temperature, GPU, power
    expect(live.getByText(/virtual machines usually hide them/)).toBeInTheDocument();
    expect(live.getByText(/No NVIDIA driver/)).toBeInTheDocument();
    expect(live.getByText(/No RAPL power interface/)).toBeInTheDocument();
    expect(live.queryByText(/^0(\.0)? ?(°C|W|%)$/)).not.toBeInTheDocument();
  });

  it("explains the capability matrix and the machine", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    renderApp("/hardware");
    const matrix = within(
      (await screen.findByText(/What this machine lets NEXUS HASH AI measure/)).closest("table")!,
    );
    expect(matrix.getAllByText("Available")).toHaveLength(4);
    expect(matrix.getAllByText("Not available")).toHaveLength(4);
    expect(matrix.getByText("No swap space is configured.")).toBeInTheDocument();
    expect(matrix.getAllByText("via psutil")).toHaveLength(3); // CPU, frequency, memory
    expect(matrix.getByText("via os.getloadavg")).toBeInTheDocument();
    expect(screen.getByText("Intel(R) Xeon(R) Processor @ 2.10GHz")).toBeInTheDocument();
    expect(screen.getByText("None configured")).toBeInTheDocument();
    expect(screen.getByText("None detected")).toBeInTheDocument();
  });

  it("extends live charts and core meters with streamed samples", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    const { advanceClock } = renderApp("/hardware");
    const live = await tiles();
    await live.findByText("12.5%");
    const socket = goLive(advanceClock);
    act(() =>
      socket.receive({
        kind: "event",
        topic: "hardware",
        type: "sample",
        ts: "t",
        data: { sample: hardwareSample(42, "2026-11-07T09:00:04Z") },
      }),
    );
    expect(live.getByText("42.0%")).toBeInTheDocument();
    const cores = within(screen.getByRole("list", { name: "Per-core utilisation" }));
    expect(cores.getByRole("meter", { name: "Core 1 utilisation" })).toHaveAttribute("aria-valuenow", "52");
    expect(screen.getByText(/server process is using 0\.4% CPU and 80 MiB/)).toBeInTheDocument();
  });

  it("loads history for the chosen window", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    renderApp("/hardware");
    await screen.findByRole("list", { name: "Hardware history legend" });
    await userEvent.click(screen.getByRole("button", { name: "7 d" }));
    await waitFor(() =>
      expect(fetchSpy.mock.calls.map(([url]) => urlOf(url))).toContain("/api/v1/hardware/history?hours=168"),
    );
  });
});

describe("dashboard hardware slot", () => {
  it("shows live usage and what is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(backendFetch());
    renderApp("/");
    const section = within(await screen.findByRole("region", { name: "Module intelligence" }));
    expect(await section.findByText("12.5%")).toBeInTheDocument();
    expect(
      section.getByText("Not available on this machine: Swap, Temperatures, GPU, Power draw."),
    ).toBeInTheDocument();
  });
});

describe("withGaps", () => {
  it("inserts a null row where data is missing", () => {
    const rows = [
      { t: 0, cpu: 1 },
      { t: 60_000, cpu: 2 },
      { t: 600_000, cpu: 3 },
    ];
    expect(withGaps(rows, 150_000, ["cpu"])).toEqual([
      { t: 0, cpu: 1 },
      { t: 60_000, cpu: 2 },
      { t: 330_000, cpu: null },
      { t: 600_000, cpu: 3 },
    ]);
    expect(withGaps([], 1, ["cpu"])).toEqual([]);
  });
});
