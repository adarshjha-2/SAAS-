import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { ActivityLog } from "@/lib/activity";
import { ActivityContext } from "@/lib/activityContext";
import { createQueryClient } from "@/lib/queryClient";
import type { RealtimeConnection } from "@/lib/realtime";
import { RealtimeProvider } from "@/lib/RealtimeProvider";

interface AppProvidersProps {
  children: ReactNode;
  /** Injection points for tests; production uses fresh defaults. */
  queryClient?: QueryClient;
  connection?: RealtimeConnection;
  activityLog?: ActivityLog;
}

/** Every app-wide context in one place, shared by the entrypoint and tests. */
export function AppProviders({ children, queryClient, connection, activityLog }: AppProvidersProps) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  const [log] = useState(() => activityLog ?? new ActivityLog());
  return (
    <QueryClientProvider client={client}>
      <RealtimeProvider {...(connection ? { connection } : {})}>
        <ActivityContext value={log}>{children}</ActivityContext>
      </RealtimeProvider>
    </QueryClientProvider>
  );
}
