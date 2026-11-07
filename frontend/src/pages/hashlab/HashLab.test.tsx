import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatCount, formatHashrate, formatSpan } from "@/lib/units";
import { backendFetch, FakeSocket, jobFixture, jsonResponse, limitsFixture, urlOf } from "@/test/fakes";
import { goLive, renderApp } from "@/test/renderApp";
import type { CompetitionResponse, HashResponse, HeaderAnalysis } from "@/types/hashlab";

import { parseHeaderForm } from "./headerForm";

const sha256Fixture: HashResponse = {
  simulated: true,
  input_bytes: 13,
  sha256: "1".repeat(64),
  double_sha256: "2".repeat(64),
  avalanche: {
    flipped_bit: 103,
    sha256: "1".repeat(32) + "3".repeat(32),
    changed_bits: 131,
    changed_percent: 51.17,
  },
};

const analysisFixture: HeaderAnalysis = {
  simulated: true,
  serialized_hex: "00".repeat(80),
  fields: [
    { name: "version", offset: 0, size: 4, bytes_hex: "01000000" },
    { name: "prev_block_hash", offset: 4, size: 32, bytes_hex: "00".repeat(32) },
    { name: "merkle_root", offset: 36, size: 32, bytes_hex: "3b".repeat(32) },
    { name: "timestamp", offset: 68, size: 4, bytes_hex: "29ab5f49" },
    { name: "bits", offset: 72, size: 4, bytes_hex: "ffff001d" },
    { name: "nonce", offset: 76, size: 4, bytes_hex: "1dac2b7c" },
  ],
  hash: "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f",
  leading_zero_bits: 43,
  target: "00000000ffff" + "0".repeat(52),
  difficulty: 1,
  meets_target: true,
};

const competitionFixture: CompetitionResponse = {
  simulated: true,
  difficulty_bits: 50,
  expected_hashes_per_block: 2 ** 50,
  expected_block_time_seconds: 11.26,
  mean_block_time_seconds: 10.9,
  total_time_seconds: 2_180,
  seed: 42,
  miners: [
    {
      name: "Alpha",
      hashrate_hs: 6e13,
      expected_share: 0.6,
      expected_blocks: 120,
      blocks_won: 117,
      actual_share: 0.585,
    },
    {
      name: "Beta",
      hashrate_hs: 3e13,
      expected_share: 0.3,
      expected_blocks: 60,
      blocks_won: 64,
      actual_share: 0.32,
    },
    {
      name: "Gamma",
      hashrate_hs: 1e13,
      expected_share: 0.1,
      expected_blocks: 20,
      blocks_won: 19,
      actual_share: 0.095,
    },
  ],
  blocks: [],
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** Fake backend with HashLab POST endpoints; records every call. */
function labBackend(overrides: Record<string, () => Response> = {}) {
  const calls: Call[] = [];
  const fallback = backendFetch();
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const path = new URL(urlOf(input), "http://localhost").pathname;
    const method = init?.method ?? "GET";
    calls.push({
      method,
      path,
      body: typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
    });
    const key = `${method} ${path}`;
    if (overrides[key]) return Promise.resolve(overrides[key]());
    if (key === "POST /api/v1/hashlab/sha256") return Promise.resolve(jsonResponse(sha256Fixture));
    if (key === "POST /api/v1/hashlab/header") return Promise.resolve(jsonResponse(analysisFixture));
    if (key === "POST /api/v1/hashlab/competition") return Promise.resolve(jsonResponse(competitionFixture));
    if (key === "POST /api/v1/hashlab/jobs") return Promise.resolve(jsonResponse(jobFixture(), 202));
    if (path.endsWith("/cancel")) return Promise.resolve(jsonResponse(jobFixture({ status: "cancelled" })));
    return fallback(input);
  });
  const posts = (path: string) => calls.filter((call) => call.method === "POST" && call.path === path);
  return { spy, calls, posts };
}

const simulator = async () =>
  within((await screen.findByText("Mining simulator")).closest("section") as HTMLElement);

beforeEach(() => {
  FakeSocket.reset();
});

describe("HashLab page", () => {
  it("is clearly labelled as a simulation", async () => {
    labBackend();
    renderApp("/hashlab");
    expect(await screen.findByRole("heading", { level: 1, name: "HashLab" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/Nothing is submitted to the Bitcoin network/);
    expect(screen.getAllByText("Simulated").length).toBeGreaterThanOrEqual(3);
  });

  it("starts a short run directly, without asking for consent", async () => {
    const backend = labBackend();
    renderApp("/hashlab");
    const panel = await simulator();
    await userEvent.click(panel.getByRole("button", { name: "Start mining simulation" }));

    await waitFor(() => expect(backend.posts("/api/v1/hashlab/jobs")).toHaveLength(1));
    expect(backend.posts("/api/v1/hashlab/jobs")[0]?.body).toEqual({
      kind: "mine",
      difficulty_bits: 20,
      max_seconds: 2,
      consent: false,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks for explicit consent before a longer run, and sends nothing until given", async () => {
    const backend = labBackend();
    renderApp("/hashlab");
    const panel = await simulator();
    const limit = panel.getByLabelText("Time limit (seconds)");
    fireEvent.change(limit, { target: { value: "10" } });
    await userEvent.click(panel.getByRole("button", { name: "Start mining simulation" }));

    const dialog = await screen.findByRole("dialog", { name: "Run a longer mining simulation?" });
    expect(dialog).toHaveTextContent("for up to 10 seconds");
    expect(backend.posts("/api/v1/hashlab/jobs")).toHaveLength(0);
    const confirm = within(dialog).getByRole("button", { name: "Start simulation" });
    expect(confirm).toBeDisabled();

    await userEvent.click(within(dialog).getByRole("checkbox"));
    await userEvent.click(confirm);
    await waitFor(() => expect(backend.posts("/api/v1/hashlab/jobs")).toHaveLength(1));
    expect(backend.posts("/api/v1/hashlab/jobs")[0]?.body).toMatchObject({ max_seconds: 10, consent: true });
  });

  it("does nothing when consent is declined", async () => {
    const backend = labBackend();
    renderApp("/hashlab");
    const panel = await simulator();
    await userEvent.click(panel.getByRole("button", { name: /Benchmark/ }));
    const dialog = await screen.findByRole("dialog", { name: "Run a CPU benchmark?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(backend.posts("/api/v1/hashlab/jobs")).toHaveLength(0);
  });

  it("asks for consent when the server requires it, even if the UI did not expect to", async () => {
    const backend = labBackend({
      "GET /api/v1/hashlab/limits": () => jsonResponse({ ...limitsFixture, consent_threshold_seconds: 60 }),
      "POST /api/v1/hashlab/jobs": () =>
        jsonResponse({ error: { code: "permission_required", message: "Confirm to continue." } }, 403),
    });
    renderApp("/hashlab");
    const panel = await simulator();
    await screen.findByText(/Runs longer than 60 s/);
    fireEvent.change(panel.getByLabelText("Time limit (seconds)"), { target: { value: "10" } });
    await userEvent.click(panel.getByRole("button", { name: "Start mining simulation" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(backend.posts("/api/v1/hashlab/jobs")).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // handled as consent, not an error
  });

  it("shows other server refusals as errors", async () => {
    labBackend({
      "POST /api/v1/hashlab/jobs": () =>
        jsonResponse({ error: { code: "conflict", message: "A HashLab run is already in progress." } }, 409),
    });
    renderApp("/hashlab");
    const panel = await simulator();
    await userEvent.click(panel.getByRole("button", { name: "Start mining simulation" }));
    expect(await panel.findByRole("alert")).toHaveTextContent("already in progress");
  });

  it("streams live progress and can stop a run", async () => {
    const backend = labBackend();
    const { advanceClock } = renderApp("/hashlab");
    const panel = await simulator();
    const socket = goLive(advanceClock);

    act(() =>
      socket.receive({
        kind: "event",
        topic: "hashlab",
        type: "job.update",
        ts: "t",
        data: { job: jobFixture() },
      }),
    );
    expect(panel.getByText("Running")).toBeInTheDocument();
    expect(panel.getByText("524,288")).toBeInTheDocument();
    expect(panel.getByText("1.31 MH/s")).toBeInTheDocument();
    expect(panel.getByRole("meter")).toHaveAttribute("aria-valuenow", "50");
    expect(panel.getByRole("button", { name: "Start mining simulation" })).toBeDisabled();

    await userEvent.click(panel.getByRole("button", { name: /Stop/ }));
    await waitFor(() =>
      expect(backend.posts(`/api/v1/hashlab/jobs/${"a".repeat(32)}/cancel`)).toHaveLength(1),
    );

    const found = jobFixture({
      status: "succeeded",
      found_nonce: 777,
      found_hash: "00000" + "c".repeat(59),
      finished_at: "2026-11-05T12:00:01Z",
    });
    act(() =>
      socket.receive({ kind: "event", topic: "hashlab", type: "job.update", ts: "t", data: { job: found } }),
    );
    expect(panel.getByText("Block found")).toBeInTheDocument();
    expect(panel.getByText("777")).toBeInTheDocument();
    expect(panel.getByLabelText(`hash ${found.found_hash}`)).toBeInTheDocument();
    // A finished run refreshes the recent-runs list.
    await waitFor(() =>
      expect(
        backend.calls.filter((call) => call.path === "/api/v1/hashlab/jobs" && call.method === "GET").length,
      ).toBeGreaterThan(1),
    );
  });

  it("hashes text live and shows the avalanche effect", async () => {
    labBackend();
    renderApp("/hashlab");
    expect(await screen.findByText("1".repeat(64))).toBeInTheDocument();
    expect(screen.getByText(/131 of 256 output bits change \(51\.2%\)/)).toBeInTheDocument();
  });

  it("analyses a real block header and validates edits inline", async () => {
    const backend = labBackend();
    renderApp("/hashlab");
    expect(await screen.findByText("Meets target")).toBeInTheDocument();
    expect(screen.getByLabelText(`hash ${analysisFixture.hash}`)).toBeInTheDocument();

    const prev = screen.getByLabelText("Previous block hash");
    const before = backend.posts("/api/v1/hashlab/header").length;
    fireEvent.change(prev, { target: { value: "abc" } });
    expect(await screen.findByText("64 hexadecimal characters")).toBeInTheDocument();
    expect(prev).toHaveAttribute("aria-invalid", "true");
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(backend.posts("/api/v1/hashlab/header")).toHaveLength(before); // invalid input is never sent
  });

  it("runs a mining competition with hash rates converted to H/s", async () => {
    const backend = labBackend();
    renderApp("/hashlab");
    await userEvent.click(await screen.findByRole("button", { name: "Run competition" }));
    await waitFor(() => expect(backend.posts("/api/v1/hashlab/competition")).toHaveLength(1));
    expect(backend.posts("/api/v1/hashlab/competition")[0]?.body).toEqual({
      miners: [
        { name: "Alpha", hashrate_hs: 6e13 },
        { name: "Beta", hashrate_hs: 3e13 },
        { name: "Gamma", hashrate_hs: 1e13 },
      ],
      difficulty_bits: 50,
      blocks: 200,
      seed: null,
    });
    expect(await screen.findByText("117")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Share chart legend" })).toHaveTextContent("Actual share");
    expect(screen.getByText("58.5%")).toBeInTheDocument();
  });

  it("blocks duplicate miner names before sending", async () => {
    const backend = labBackend();
    renderApp("/hashlab");
    fireEvent.change(await screen.findByLabelText("Miner 2 name"), { target: { value: "alpha" } });
    expect(screen.getByRole("button", { name: "Run competition" })).toBeDisabled();
    expect(screen.getByText(/unique name/)).toBeInTheDocument();
    expect(backend.posts("/api/v1/hashlab/competition")).toHaveLength(0);
  });
});

describe("dashboard mining slot", () => {
  it("shows the live run on the Command Center", async () => {
    labBackend();
    const { advanceClock } = renderApp("/");
    const section = within(await screen.findByRole("region", { name: "Module intelligence" }));
    expect(await section.findByText("No simulation runs yet")).toBeInTheDocument();
    const socket = goLive(advanceClock);
    act(() =>
      socket.receive({
        kind: "event",
        topic: "hashlab",
        type: "job.update",
        ts: "t",
        data: { job: jobFixture() },
      }),
    );
    expect(section.getByText("Running")).toBeInTheDocument();
    expect(section.getByText("524,288")).toBeInTheDocument();
  });
});

describe("helpers", () => {
  const valid = {
    version: "1",
    prev_block_hash: "0".repeat(64),
    merkle_root: "A".repeat(64),
    timestamp: "1231006505",
    bits: "1d00ffff",
    nonce: "0",
  };

  it("parses a valid header form", () => {
    expect(parseHeaderForm(valid)).toEqual({
      header: {
        version: 1,
        prev_block_hash: "0".repeat(64),
        merkle_root: "a".repeat(64),
        timestamp: 1_231_006_505,
        bits: 0x1d00ffff,
        nonce: 0,
      },
      errors: {},
    });
  });

  it("reports every invalid field", () => {
    const { header, errors } = parseHeaderForm({
      ...valid,
      version: "1.5",
      merkle_root: "xyz",
      nonce: String(2 ** 32),
      bits: "not-hex",
    });
    expect(header).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(["bits", "merkle_root", "nonce", "version"]);
  });

  it.each([
    [null, "—"],
    [950, "950 H/s"],
    [1_310_720, "1.31 MH/s"],
    [6e13, "60.00 TH/s"],
    [8e20, "800.00 EH/s"],
  ])("formatHashrate(%s) = %s", (input, expected) => {
    expect(formatHashrate(input)).toBe(expected);
  });

  it.each([
    [0.42, "0.4 s"],
    [42, "42 s"],
    [600, "10.0 min"],
    [7_200, "2.0 h"],
    [5 * 86_400, "5.0 days"],
    [400 * 86_400, "1 years"],
    [1e20, "3.2 × 10^12 years"],
  ])("formatSpan(%s) = %s", (input, expected) => {
    expect(formatSpan(input)).toBe(expected);
  });

  it("formats counts", () => {
    expect(formatCount(1_048_576)).toBe("1,048,576");
    expect(formatCount(2 ** 64)).toBe("1.84 × 10^19");
  });
});
