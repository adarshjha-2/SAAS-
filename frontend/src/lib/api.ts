import type { ApiErrorBody } from "@/types/api";

const DEFAULT_TIMEOUT_MS = 10_000;
const GATEWAY_STATUSES = new Set([502, 503, 504]);

/** Base URL for API calls; empty means same origin (dev proxy / reverse proxy). */
export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

/** A failed API call, normalised from the backend's error envelope. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly details: Record<string, unknown>[] | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    requestId?: string,
    details?: Record<string, unknown>[],
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }

  /** Worth retrying: the backend is unreachable, timed out, or failed server-side. */
  get isTransient(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

function isErrorEnvelope(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const { error } = value;
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string" &&
    typeof (error as { message?: unknown }).message === "string"
  );
}

async function toApiError(response: Response): Promise<ApiError> {
  const fallbackId = response.headers.get("x-request-id") ?? undefined;
  try {
    const body: unknown = await response.json();
    if (isErrorEnvelope(body)) {
      const { code, message, request_id, details } = body.error;
      return new ApiError(response.status, code, message, request_id ?? fallbackId, details);
    }
  } catch {
    // Non-JSON error body (e.g. a proxy error page); fall through.
  }
  // A gateway error without our envelope came from a proxy in front of the
  // backend (e.g. the Vite dev proxy), meaning the backend itself is down.
  if (GATEWAY_STATUSES.has(response.status)) {
    return new ApiError(
      response.status,
      "backend_unavailable",
      `Cannot reach the NEXUS HASH AI backend (gateway returned ${response.status}).`,
      fallbackId,
    );
  }
  return new ApiError(
    response.status,
    "http_error",
    `Request failed with status ${response.status}.`,
    fallbackId,
  );
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  { signal, timeoutMs = DEFAULT_TIMEOUT_MS }: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (cause) {
      if (timedOut) {
        throw new ApiError(0, "timeout", `The backend did not respond within ${timeoutMs} ms.`);
      }
      if (signal?.aborted) throw cause;
      throw new ApiError(0, "network_error", "Cannot reach the NEXUS HASH AI backend.");
    }

    if (!response.ok) throw await toApiError(response);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

export function apiGet<T>(path: string, options?: RequestOptions): Promise<T> {
  return apiRequest<T>(path, { method: "GET" }, options);
}
