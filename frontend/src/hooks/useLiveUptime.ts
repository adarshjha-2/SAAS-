import { useEffect, useState } from "react";

/**
 * Interpolates a server-reported uptime between updates so the display ticks
 * every second, using only the local clock delta (immune to clock skew).
 */
export function useLiveUptime(baseSeconds: number | undefined, receivedAt: number | undefined) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  if (baseSeconds === undefined || receivedAt === undefined) return undefined;
  return baseSeconds + Math.max(0, now - receivedAt) / 1_000;
}
