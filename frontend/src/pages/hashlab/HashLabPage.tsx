import { FlaskConical, ShieldCheck } from "lucide-react";

import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";

import { CompetitionLab } from "./CompetitionLab";
import { HeaderLab } from "./HeaderLab";
import { MiningSimulator } from "./MiningSimulator";
import { Sha256Playground } from "./Sha256Playground";

/** HashLab: an educational Bitcoin proof-of-work simulator. Everything here is simulated. */
export function HashLabPage() {
  return (
    <div className="space-y-6">
      <section className="flex animate-fade-up flex-wrap items-start gap-4">
        <div className="rounded-xl border border-ember-500/30 bg-ember-500/10 p-3 shadow-glow-ember">
          <FlaskConical className="size-6 text-ember-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] tracking-[0.3em] text-ember-400 uppercase">
            Intelligence module
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">HashLab</h1>
          <p className="mt-1 max-w-2xl text-ink-muted">
            Explore Bitcoin proof-of-work with the real algorithms: SHA-256, block headers, nonces, targets
            and mining competition.
          </p>
        </div>
        <ProvenanceBadge kind="simulated" />
      </section>

      <div
        role="note"
        className="flex items-start gap-3 rounded-lg border border-series-3/40 bg-series-3/10 px-4 py-3 text-sm text-ink"
      >
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-series-3" />
        <p>
          <strong>Simulation only.</strong> Every hash on this page is computed on this computer for learning
          and measurement. Nothing is submitted to the Bitcoin network or any mining pool, and no result has
          monetary value. Longer runs always ask for your permission first.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <MiningSimulator />
        <Sha256Playground />
      </div>
      <HeaderLab />
      <CompetitionLab />
    </div>
  );
}
