import { describe, expect, it, vi } from "vitest";

import { jsonResponse } from "@/test/fakes";

import { ApiError, apiGet, apiRequest } from "./api";

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(impl);
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected promise to reject");
}

describe("apiGet", () => {
  it("returns parsed JSON and sends an accept header", async () => {
    const fetchSpy = mockFetch(() => Promise.resolve(jsonResponse({ status: "ok" })));
    await expect(apiGet("/api/v1/system/health")).resolves.toEqual({ status: "ok" });
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
  });

  it("maps the backend error envelope to ApiError", async () => {
    mockFetch(() =>
      Promise.resolve(
        jsonResponse(
          { error: { code: "permission_required", message: "Consent needed.", request_id: "req-1" } },
          403,
        ),
      ),
    );
    const error = await captureError(apiGet("/x"));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 403,
      code: "permission_required",
      message: "Consent needed.",
      requestId: "req-1",
      isTransient: false,
    });
  });

  it("treats a gateway error without an envelope as the backend being down", async () => {
    mockFetch(() =>
      Promise.resolve(
        new Response("<html>Bad Gateway</html>", { status: 502, headers: { "x-request-id": "r2" } }),
      ),
    );
    const error = await captureError(apiGet("/x"));
    expect(error).toMatchObject({
      status: 502,
      code: "backend_unavailable",
      requestId: "r2",
      isTransient: true,
    });
    expect((error as ApiError).message).toMatch(/Cannot reach the NEXUS HASH AI backend/);
  });

  it("falls back to a generic error for other non-JSON responses", async () => {
    mockFetch(() => Promise.resolve(new Response("teapot", { status: 418 })));
    const error = await captureError(apiGet("/x"));
    expect(error).toMatchObject({ status: 418, code: "http_error", isTransient: false });
  });

  it("reports an unreachable backend as a transient network error", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const error = await captureError(apiGet("/x"));
    expect(error).toMatchObject({ status: 0, code: "network_error", isTransient: true });
  });

  it("times out slow requests", async () => {
    mockFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const error = await captureError(apiGet("/x", { timeoutMs: 10 }));
    expect(error).toMatchObject({ code: "timeout", status: 0 });
  });

  it("propagates caller cancellation without wrapping it", async () => {
    mockFetch(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const controller = new AbortController();
    const pending = apiGet("/x", { signal: controller.signal });
    controller.abort();
    const error = await captureError(pending);
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as DOMException).name).toBe("AbortError");
  });
});

describe("apiRequest", () => {
  it("sets a JSON content type when sending a body", async () => {
    const fetchSpy = mockFetch(() => Promise.resolve(jsonResponse({ ok: true })));
    await apiRequest("/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(init?.method).toBe("POST");
  });
});
