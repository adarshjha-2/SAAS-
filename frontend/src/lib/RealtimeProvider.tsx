import { useEffect, useState, type ReactNode } from "react";

import type { Topic } from "@/types/api";

import { buildRealtimeUrl, RealtimeConnection } from "./realtime";
import { RealtimeContext } from "./realtimeContext";

const DEFAULT_TOPICS: Topic[] = ["system"];
const REALTIME_PATH = "/ws/v1";

interface RealtimeProviderProps {
  children: ReactNode;
  /** Inject a pre-built connection (tests); otherwise one is created for this tab. */
  connection?: RealtimeConnection;
  topics?: Topic[];
}

export function RealtimeProvider({ children, connection, topics = DEFAULT_TOPICS }: RealtimeProviderProps) {
  const [instance] = useState(
    () => connection ?? new RealtimeConnection({ url: buildRealtimeUrl(REALTIME_PATH), topics }),
  );

  useEffect(() => {
    instance.start();
    return () => instance.stop();
  }, [instance]);

  return <RealtimeContext value={instance}>{children}</RealtimeContext>;
}
