import { describe, expect, it, vi } from "vitest";

import { ActivityLog } from "./activity";

describe("ActivityLog", () => {
  it("keeps entries newest first with session as the default source", () => {
    const log = new ActivityLog();
    log.add({ level: "info", message: "first" }, 1_000);
    log.add({ level: "error", message: "second", detail: "why" }, 5_000);
    const [newest, oldest] = log.getSnapshot();
    expect(newest).toMatchObject({ message: "second", level: "error", detail: "why", source: "session" });
    expect(oldest?.message).toBe("first");
    expect(newest!.id).toBeGreaterThan(oldest!.id);
  });

  it("collapses an identical message repeated within two seconds", () => {
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
});
