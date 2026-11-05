import { TriangleAlert } from "lucide-react";

import { Panel } from "@/components/ui/Panel";
import { ApiError } from "@/lib/api";

export function BackendOffline({ error }: { error: Error }) {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return (
    <Panel className="border-fault/40">
      <div role="alert" className="flex items-start gap-4">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-fault" />
        <div className="space-y-2 text-sm">
          <p className="font-display font-semibold text-ink">Backend unreachable</p>
          <p className="text-ink-muted">{error.message}</p>
          <p className="text-ink-muted">
            Start it with{" "}
            <code className="rounded bg-panel-raised px-1.5 py-0.5 font-mono text-flux-400">
              make backend
            </code>{" "}
            and this view reconnects automatically.
          </p>
          {requestId && <p className="font-mono text-xs text-ink-faint">request id: {requestId}</p>}
        </div>
      </div>
    </Panel>
  );
}
