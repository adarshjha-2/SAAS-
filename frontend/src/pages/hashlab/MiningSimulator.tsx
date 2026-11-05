import { Gauge, Square } from "lucide-react";
import { useId, useState } from "react";

import { HashDisplay } from "@/components/hashlab/HashDisplay";
import { ConsentDialog } from "@/components/ui/ConsentDialog";
import { Panel } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { StatusPill } from "@/components/ui/Status";
import type { Tone } from "@/components/ui/status-meta";
import { useCancelJob, useHashLabLimits, useLiveJob, useRecentJobs, useStartJob } from "@/hooks/useHashLab";
import { ApiError } from "@/lib/api";
import { formatClock } from "@/lib/format";
import { formatCount, formatHashrate, formatSpan } from "@/lib/units";
import type { JobRequest, JobStatus, JobView } from "@/types/hashlab";

const STATUS_META: Record<JobStatus, { tone: Tone; label: string }> = {
  queued: { tone: "idle", label: "Queued" },
  running: { tone: "flux", label: "Running" },
  succeeded: { tone: "ok", label: "Block found" },
  exhausted: { tone: "warn", label: "Nonces exhausted" },
  timed_out: { tone: "warn", label: "Time limit reached" },
  cancelled: { tone: "idle", label: "Cancelled" },
  failed: { tone: "fault", label: "Failed" },
};

function statusMeta(job: JobView) {
  if (job.kind === "benchmark" && job.status === "succeeded")
    return { tone: "ok" as const, label: "Complete" };
  return STATUS_META[job.status];
}

const BITCOIN_MIN_DIFFICULTY_HASHES = 2 ** 32;
const BENCHMARK_SECONDS = 10;

function RunCard({ job, onCancel, cancelling }: { job: JobView; onCancel: () => void; cancelling: boolean }) {
  const meta = statusMeta(job);
  const running = job.status === "running" || job.status === "queued";
  const workShare = job.expected_attempts > 0 ? job.attempts / job.expected_attempts : null;
  return (
    <div className="rounded-lg border border-edge bg-panel-raised p-4" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusPill tone={meta.tone} label={meta.label} pulse={running} />
          <span className="text-xs text-ink-muted">
            {job.kind === "benchmark" ? "Hash-rate benchmark" : `${job.difficulty_bits}-bit difficulty`}
          </span>
        </div>
        {running && (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="inline-flex items-center gap-1.5 rounded-lg border border-fault/40 px-3 py-1 text-xs text-fault hover:bg-fault/10 disabled:opacity-50"
          >
            <Square className="size-3" /> {cancelling ? "Stopping…" : "Stop"}
          </button>
        )}
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-ink-faint">Attempts</dt>
          <dd className="font-mono text-ink">{formatCount(job.attempts)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">Elapsed</dt>
          <dd className="font-mono text-ink">
            {formatSpan(job.elapsed_seconds)} / {job.max_seconds} s
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">Hash rate</dt>
          <dd className="font-mono text-ink">{formatHashrate(job.hash_rate_hs)}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">Best zero bits</dt>
          <dd className="font-mono text-ink">
            {job.best_zero_bits ?? "—"}
            {job.kind === "mine" && <span className="text-ink-faint"> / {job.difficulty_bits} needed</span>}
          </dd>
        </div>
      </dl>

      {workShare !== null && (
        <div className="mt-4">
          <div className="flex justify-between text-xs text-ink-muted">
            <span>Work done vs. expected (2^{job.difficulty_bits} attempts)</span>
            <span className="font-mono">{(workShare * 100).toFixed(0)}%</span>
          </div>
          <div
            role="meter"
            aria-label="Work done versus expected attempts"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round(workShare * 100))}
            className="mt-1 h-1.5 overflow-hidden rounded-full bg-flux-900"
          >
            <div
              className="h-full rounded-full bg-series-1"
              style={{ width: `${Math.min(100, workShare * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] text-ink-faint">
            Not a progress bar: finding a block is random, so a run can succeed far earlier or later than
            expected.
          </p>
        </div>
      )}

      {job.found_hash ? (
        <div className="mt-4">
          <p className="text-xs text-ink-muted">
            Found with nonce <span className="font-mono text-ink">{job.found_nonce}</span>, verified by the
            server:
          </p>
          <HashDisplay hash={job.found_hash} className="mt-1 block" />
        </div>
      ) : (
        job.best_hash && (
          <div className="mt-4">
            <p className="text-xs text-ink-muted">Best hash so far</p>
            <HashDisplay hash={job.best_hash} className="mt-1 block" />
          </div>
        )
      )}
      {job.error && <p className="mt-3 text-sm text-fault">{job.error}</p>}
    </div>
  );
}

export function MiningSimulator() {
  const limits = useHashLabLimits();
  const recent = useRecentJobs(8);
  const { active, lastFinished } = useLiveJob();
  const start = useStartJob();
  const cancel = useCancelJob();
  const [bits, setBits] = useState(20);
  const [seconds, setSeconds] = useState(2);
  const [pending, setPending] = useState<JobRequest | null>(null);
  const bitsId = useId();
  const secondsId = useId();

  const threshold = limits.data?.consent_threshold_seconds ?? 2;
  const shown = active ?? lastFinished ?? recent.data?.[0] ?? null;
  const measuredRate =
    [active, lastFinished, ...(recent.data ?? [])].find((job) => job?.hash_rate_hs)?.hash_rate_hs ?? null;
  const expectedAttempts = 2 ** bits;

  const launch = (request: JobRequest) => {
    const needsConsent = request.kind === "benchmark" || request.max_seconds > threshold;
    if (needsConsent && !request.consent) {
      setPending(request);
      return;
    }
    start.mutate(request, {
      onError: (error) => {
        // The server is the authority: if it asks for consent, ask the user.
        if (error instanceof ApiError && error.code === "permission_required") setPending(request);
      },
    });
  };

  // Consent requests are handled by the dialog; anything else is shown to the user.
  const startError =
    start.error instanceof ApiError && start.error.code !== "permission_required" ? start.error : null;

  return (
    <Panel
      title="Mining simulator"
      eyebrow="Proof-of-work search"
      actions={<ProvenanceBadge kind="simulated" />}
    >
      <p className="text-sm text-ink-muted">
        Re-mine the genesis block header at an educational difficulty: the worker tries nonces until a hash
        has the required number of leading zero bits.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={bitsId} className="flex justify-between text-xs text-ink-muted">
            <span>Difficulty</span>
            <span className="font-mono text-ink">{bits} leading zero bits</span>
          </label>
          <input
            id={bitsId}
            type="range"
            min={1}
            max={limits.data?.max_difficulty_bits ?? 32}
            value={bits}
            onChange={(event) => setBits(Number(event.target.value))}
            className="mt-2 w-full accent-ember-500"
          />
          <p className="mt-1 text-xs text-ink-faint">
            Expected attempts 2^{bits} = {formatCount(expectedAttempts)}
            {measuredRate && (
              <> · about {formatSpan(expectedAttempts / measuredRate)} at your measured rate</>
            )}
          </p>
        </div>
        <div>
          <label htmlFor={secondsId} className="text-xs text-ink-muted">
            Time limit (seconds)
          </label>
          <input
            id={secondsId}
            type="number"
            min={0.5}
            step={0.5}
            max={limits.data?.max_job_seconds ?? 60}
            value={seconds}
            onChange={(event) => setSeconds(Number(event.target.value))}
            className="mt-1 w-full rounded-lg border border-edge bg-abyss px-2.5 py-1.5 font-mono text-sm text-ink"
          />
          <p className="mt-1 text-xs text-ink-faint">
            Runs longer than {threshold} s ask for your permission first. One CPU core, low priority.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={active !== null || start.isPending}
          onClick={() =>
            launch({ kind: "mine", difficulty_bits: bits, max_seconds: seconds, consent: false })
          }
          className="rounded-lg bg-ember-500 px-4 py-2 text-sm font-medium text-void hover:bg-ember-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Start mining simulation
        </button>
        <button
          type="button"
          disabled={active !== null || start.isPending}
          onClick={() =>
            launch({ kind: "benchmark", difficulty_bits: 1, max_seconds: BENCHMARK_SECONDS, consent: false })
          }
          className="inline-flex items-center gap-2 rounded-lg border border-edge px-4 py-2 text-sm text-ink-muted hover:border-edge-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Gauge className="size-4" /> Benchmark ({BENCHMARK_SECONDS} s)
        </button>
      </div>
      {startError && (
        <p role="alert" className="mt-3 text-sm text-fault">
          {startError.message}
        </p>
      )}

      {shown && (
        <div className="mt-5">
          <RunCard job={shown} cancelling={cancel.isPending} onCancel={() => cancel.mutate(shown.id)} />
        </div>
      )}

      {measuredRate && (
        <p className="mt-4 rounded-lg border border-edge px-3 py-2 text-xs text-ink-muted">
          For scale: at {formatHashrate(measuredRate)}, one block at Bitcoin&rsquo;s <em>minimum</em>{" "}
          difficulty (difficulty 1, about 2^32 = {formatCount(BITCOIN_MIN_DIFFICULTY_HASHES)} hashes) would
          take about{" "}
          <strong className="text-ink">{formatSpan(BITCOIN_MIN_DIFFICULTY_HASHES / measuredRate)}</strong> on
          this computer. Today&rsquo;s network difficulty is many orders of magnitude higher.
        </p>
      )}

      {recent.data && recent.data.length > 0 && (
        <table className="mt-5 w-full text-left text-xs">
          <caption className="mb-2 text-left text-xs text-ink-muted">Recent runs (all simulated)</caption>
          <thead className="text-ink-faint">
            <tr>
              <th scope="col" className="py-1 pr-2 font-medium">
                Started
              </th>
              <th scope="col" className="py-1 pr-2 font-medium">
                Run
              </th>
              <th scope="col" className="py-1 pr-2 font-medium">
                Outcome
              </th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">
                Attempts
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Rate
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge/60">
            {recent.data.map((job) => (
              <tr key={job.id}>
                <td className="py-1.5 pr-2 font-mono text-ink-faint">
                  {formatClock(Date.parse(job.created_at))}
                </td>
                <td className="py-1.5 pr-2 text-ink-muted">
                  {job.kind === "benchmark" ? "Benchmark" : `${job.difficulty_bits} bits`}
                  {job.consent && <span className="text-ink-faint"> · consented</span>}
                </td>
                <td className="py-1.5 pr-2 text-ink">{statusMeta(job).label}</td>
                <td className="py-1.5 pr-2 text-right font-mono text-ink">{formatCount(job.attempts)}</td>
                <td className="py-1.5 text-right font-mono text-ink">{formatHashrate(job.hash_rate_hs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ConsentDialog
        open={pending !== null}
        title={pending?.kind === "benchmark" ? "Run a CPU benchmark?" : "Run a longer mining simulation?"}
        impact={[
          `Uses one CPU core, at reduced priority, for up to ${pending?.max_seconds ?? 0} seconds.`,
          "Runs only on this computer. Nothing is sent to the Bitcoin network or any pool, and nothing is earned.",
          "You can stop it at any time; it halts within about a quarter of a second.",
        ]}
        acknowledgement="I understand this will use significant CPU on this computer."
        confirmLabel={pending?.kind === "benchmark" ? "Start benchmark" : "Start simulation"}
        onConfirm={() => {
          if (pending) start.mutate({ ...pending, consent: true });
          setPending(null);
        }}
        onCancel={() => setPending(null)}
      />
    </Panel>
  );
}
