import { useEffect, useState, type ReactNode } from "react";

import type { Topic } from "@/types/api";

import { APP_TOPICS, buildRealtimeUrl, RealtimeConnection } from "./realtime";
import { RealtimeContext } from "./realtimeContext";

const REALTIME_PATH = "/ws/v1";

interface RealtimeProviderProps {
  children: ReactNode;
  /** Inject a pre-built connection (tests); otherwise one is created for this tab. */
  connection?: RealtimeConnection;
  topics?: readonly Topic[];
}

export function RealtimeProvider({ children, connection, topics = APP_TOPICS }: RealtimeProviderProps) {
  const [instance] = useState(
    () => connection ?? new RealtimeConnection({ url: buildRealtimeUrl(REALTIME_PATH), topics }),
  );

  useEffect(() => {
    instance.start();
    return () => instance.stop();
  }, [instance]);

  return <RealtimeContext value={instance}>{children}</RealtimeContext>;
}
