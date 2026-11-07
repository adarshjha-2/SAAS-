import { describe, expect, it, vi } from "vitest";

import { serverEntry } from "@/test/fakes";

import { ActivityLog, fromServerEntry } from "./activity";

describe("ActivityLog", () => {
  it("keeps session entries newest first with unique keys", () => {
    const log = new ActivityLog();
    log.add({ level: "info", message: "first" }, 1_000);
    log.add({ level: "error", message: "second", detail: "why" }, 5_000);
    const [newest, oldest] = log.getSnapshot();
    expect(newest).toMatchObject({ message: "second", level: "error", detail: "why", source: "session" });
    expect(oldest?.message).toBe("first");
    expect(newest?.key).not.toBe(oldest?.key);
  });

  it("collapses an identical session message repeated within two seconds", () => {
    const log = new ActivityLog();
    log.add({ level: "info", message: "same" }, 1_000);
    log.add({ level: "info", message: "same" }, 1_500);
    log.add({ level: "info", message: "same" }, 4_000);
    expect(log.getSnapshot()).toHaveLength(2);
  });

  it("caps its size and notifies subscribers", () => {
    const log = new ActivityLog();
    const listener = vi.fn();
    log.subscribe(listener);
    for (let i = 0; i < 150; i += 1) log.add({ level: "info", message: `event ${i}` }, i * 10_000);
    expect(log.getSnapshot()).toHaveLength(100);
    expect(log.getSnapshot()[0]?.message).toBe("event 149");
    expect(listener).toHaveBeenCalledTimes(150);
  });

  it("merges server entries with session entries by time", () => {
    const log = new ActivityLog();
    const t = Date.parse(serverEntry(5).ts);
    log.add({ level: "warning", message: "stream lost" }, t + 1_000);
    log.ingestServer([serverEntry(5), serverEntry(4)]);
    expect(log.getSnapshot().map((entry) => entry.message)).toEqual([
      "stream lost",
      "Server event 5",
      "Server event 4",
    ]);
  });

  it("ignores server entries it already has (API page and live event overlap)", () => {
    const log = new ActivityLog();
    const listener = vi.fn();
    log.subscribe(listener);
    log.ingestServer([serverEntry(1), serverEntry(2)]);
    log.ingestServer([serverEntry(2)]);
    log.ingestServer([serverEntry(3), serverEntry(1)]);
    expect(log.getSnapshot().map((entry) => entry.serverId)).toEqual([3, 2, 1]);
    expect(listener).toHaveBeenCalledTimes(2); // the pure duplicate caused no update
  });

  it("orders server entries with equal timestamps by id", () => {
    const log = new ActivityLog();
    const ts = "2026-11-05T09:00:00.000Z";
    log.ingestServer([serverEntry(7, { ts }), serverEntry(9, { ts }), serverEntry(8, { ts })]);
    expect(log.getSnapshot().map((entry) => entry.serverId)).toEqual([9, 8, 7]);
  });
});

describe("fromServerEntry", () => {
  it("maps API entries to log entries", () => {
    const entry = fromServerEntry(
      serverEntry(42, { level: "error", category: "database", actor: "user", detail: "locked" }),
    );
    expect(entry).toMatchObject({
      key: "server-42",
      serverId: 42,
      source: "server",
      level: "error",
      category: "database",
      actor: "user",
      detail: "locked",
    });
    expect(entry.ts).toBe(Date.parse(serverEntry(42).ts));
  });

  it("omits a null detail", () => {
    expect(fromServerEntry(serverEntry(1))).not.toHaveProperty("detail");
  });
});
