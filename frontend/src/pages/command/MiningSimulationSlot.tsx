import { FlaskConical } from "lucide-react";
import { Link } from "react-router";

import { HashDisplay } from "@/components/hashlab/HashDisplay";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { StatusPill } from "@/components/ui/Status";
import { useLiveJob, useRecentJobs } from "@/hooks/useHashLab";
import { formatCount, formatHashrate, formatSpan } from "@/lib/units";

const OUTCOME: Record<string, string> = {
  running: "Running",
  queued: "Queued",
  succeeded: "Block found",
  exhausted: "Nonces exhausted",
  timed_out: "Time limit reached",
  cancelled: "Cancelled",
  failed: "Failed",
};

/** Dashboard panel: the live HashLab run, or the most recent one. */
export function MiningSimulationSlot() {
  const { active, lastFinished } = useLiveJob();
  const recent = useRecentJobs(1);
  const job = active ?? lastFinished ?? recent.data?.[0] ?? null;
  const live = active !== null;

  return (
    <Panel
      title="Mining simulation"
      eyebrow="HashLab"
      actions={<ProvenanceBadge kind="simulated" />}
      className="flex flex-col"
    >
      {job ? (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              tone={live ? "flux" : job.status === "succeeded" ? "ok" : "idle"}
              label={
                job.kind === "benchmark" && job.status === "succeeded"
                  ? "Complete"
                  : (OUTCOME[job.status] ?? job.status)
              }
              pulse={live}
            />
            <span className="text-xs text-ink-muted">
              {job.kind === "benchmark" ? "Benchmark" : `${job.difficulty_bits}-bit difficulty`}
            </span>
          </div>
          <dl className="grid grid-cols-3 gap-2">
            <div>
              <dt className="text-xs text-ink-faint">Attempts</dt>
              <dd className="font-mono text-ink">{formatCount(job.attempts)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Rate</dt>
              <dd className="font-mono text-ink">{formatHashrate(job.hash_rate_hs)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Time</dt>
              <dd className="font-mono text-ink">{formatSpan(job.elapsed_seconds)}</dd>
            </div>
          </dl>
          {(job.found_hash ?? job.best_hash) && (
            <div>
              <p className="text-xs text-ink-faint">{job.found_hash ? "Block hash" : "Best hash"}</p>
              <HashDisplay hash={(job.found_hash ?? job.best_hash) as string} />
            </div>
          )}
          <Link to="/hashlab" className="inline-block text-sm text-flux-400 hover:text-flux-300">
            Open HashLab →
          </Link>
        </div>
      ) : (
        <EmptyState icon={<FlaskConical className="size-4" />} title="No simulation runs yet">
          Re-mine a block header at an educational difficulty and measure this computer&rsquo;s hash rate.{" "}
          <Link to="/hashlab" className="text-flux-400 hover:text-flux-300">
            Open HashLab →
          </Link>
        </EmptyState>
      )}
    </Panel>
  );
}
