import { QueryClient } from "@tanstack/react-query";

import { ApiError } from "./api";

const MAX_RETRIES = 2;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Only retry failures that might succeed on retry (offline, timeout, 5xx).
        retry: (failureCount, error) =>
          failureCount < MAX_RETRIES && error instanceof ApiError && error.isTransient,
        refetchOnWindowFocus: false,
      },
    },
  });
}
