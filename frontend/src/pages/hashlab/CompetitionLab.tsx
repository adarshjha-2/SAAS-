import { Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Panel } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { useCompetition } from "@/hooks/useHashLab";
import { formatCount, formatHashrate, formatSpan, HASHRATE_UNIT_OPTIONS } from "@/lib/units";
import type { CompetitionResponse } from "@/types/hashlab";

interface MinerRow {
  id: number;
  name: string;
  value: string;
  scale: number;
}

const MIN_MINERS = 2;
const MAX_MINERS = 8;
const SERIES = [
  { key: "expected", label: "Expected share (hash rate)", color: "var(--color-series-2)" },
  { key: "actual", label: "Actual share (blocks won)", color: "var(--color-series-1)" },
] as const;

const percent = (share: number) => `${(share * 100).toFixed(1)}%`;

function ShareChart({ result }: { result: CompetitionResponse }) {
  const data = result.miners.map((miner) => ({
    name: miner.name,
    expected: miner.expected_share,
    actual: miner.actual_share,
  }));
  return (
    <div>
      <ul
        aria-label="Share chart legend"
        className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted"
      >
        {SERIES.map((series) => (
          <li key={series.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-sm"
              style={{ background: series.color }}
            />
            {series.label}
          </li>
        ))}
      </ul>
      <figure aria-label="Expected versus actual share of blocks per miner" style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 560, height: 220 }}>
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            barGap={2}
            barCategoryGap="30%"
          >
            <CartesianGrid stroke="var(--color-edge)" vertical={false} />
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={{ stroke: "var(--color-edge-strong)" }}
              tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
            />
            <YAxis
              tickFormatter={(value: number) => `${Math.round(value * 100)}%`}
              domain={[0, "auto"]}
              tickLine={false}
              axisLine={false}
              width={44}
              tick={{ fill: "var(--color-ink-muted)", fontSize: 11 }}
            />
            <Tooltip
              cursor={{ fill: "rgb(255 255 255 / 0.03)" }}
              isAnimationActive={false}
              formatter={(value) => (typeof value === "number" ? percent(value) : String(value))}
              contentStyle={{
                background: "var(--color-abyss)",
                border: "1px solid var(--color-edge-strong)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--color-ink)" }}
              itemStyle={{ color: "var(--color-ink)" }}
            />
            {SERIES.map((series) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                name={series.label}
                fill={series.color}
                maxBarSize={24}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </figure>
    </div>
  );
}

export function CompetitionLab() {
  const [miners, setMiners] = useState<MinerRow[]>([
    { id: 1, name: "Alpha", value: "60", scale: 1e12 },
    { id: 2, name: "Beta", value: "30", scale: 1e12 },
    { id: 3, name: "Gamma", value: "10", scale: 1e12 },
  ]);
  const [bits, setBits] = useState(50);
  const [blocks, setBlocks] = useState(200);
  const [seed, setSeed] = useState("");
  const competition = useCompetition();
  const bitsId = useId();
  const blocksId = useId();
  const seedId = useId();

  const update = (id: number, patch: Partial<MinerRow>) =>
    setMiners((rows) => rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const addMiner = () =>
    setMiners((rows) => [
      ...rows,
      {
        id: Math.max(...rows.map((row) => row.id)) + 1,
        name: `Miner ${rows.length + 1}`,
        value: "10",
        scale: 1e12,
      },
    ]);

  const parsed = miners.map((row) => ({ name: row.name.trim(), hashrate_hs: Number(row.value) * row.scale }));
  const valid =
    parsed.every(
      (miner) => miner.name.length > 0 && Number.isFinite(miner.hashrate_hs) && miner.hashrate_hs > 0,
    ) && new Set(parsed.map((miner) => miner.name.toLowerCase())).size === parsed.length;
  const totalRate = parsed.reduce((sum, miner) => sum + (miner.hashrate_hs || 0), 0);
  const result = competition.data;

  return (
    <Panel
      title="Mining competition"
      eyebrow="Who finds the next block?"
      actions={<ProvenanceBadge kind="simulated" />}
    >
      <p className="max-w-3xl text-sm text-ink-muted">
        Miners race to find blocks. Each one&rsquo;s chance of winning a block equals its share of the total
        hash rate, but luck makes real outcomes wander. This runs in simulated time with no hashing, so any
        hash rate is allowed and it costs no CPU.
      </p>

      <div className="mt-4 space-y-2">
        {miners.map((row, index) => (
          <div key={row.id} className="flex flex-wrap items-center gap-2">
            <input
              aria-label={`Miner ${index + 1} name`}
              value={row.name}
              maxLength={32}
              onChange={(event) => update(row.id, { name: event.target.value })}
              className="w-36 rounded-lg border border-edge bg-abyss px-2.5 py-1.5 text-sm text-ink"
            />
            <input
              aria-label={`Miner ${index + 1} hash rate`}
              type="number"
              min={0}
              value={row.value}
              onChange={(event) => update(row.id, { value: event.target.value })}
              className="w-28 rounded-lg border border-edge bg-abyss px-2.5 py-1.5 font-mono text-sm text-ink"
            />
            <select
              aria-label={`Miner ${index + 1} hash rate unit`}
              value={row.scale}
              onChange={(event) => update(row.id, { scale: Number(event.target.value) })}
              className="rounded-lg border border-edge bg-abyss px-2 py-1.5 text-sm text-ink"
            >
              {HASHRATE_UNIT_OPTIONS.map((unit) => (
                <option key={unit.label} value={unit.scale}>
                  {unit.label}
                </option>
              ))}
            </select>
            <span className="w-16 text-right font-mono text-xs text-ink-faint">
              {totalRate > 0 ? percent((parsed[index]?.hashrate_hs ?? 0) / totalRate) : "—"}
            </span>
            <button
              type="button"
              aria-label={`Remove ${row.name || `miner ${index + 1}`}`}
              disabled={miners.length <= MIN_MINERS}
              onClick={() => setMiners((rows) => rows.filter((other) => other.id !== row.id))}
              className="rounded-md p-1.5 text-ink-faint hover:text-fault disabled:opacity-30"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={addMiner}
          disabled={miners.length >= MAX_MINERS}
          className="inline-flex items-center gap-1.5 text-xs text-flux-400 hover:text-flux-300 disabled:opacity-40"
        >
          <Plus className="size-3.5" /> Add miner
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor={bitsId} className="text-xs text-ink-muted">
            Difficulty (zero bits)
          </label>
          <input
            id={bitsId}
            type="number"
            min={1}
            max={128}
            value={bits}
            onChange={(event) => setBits(Number(event.target.value))}
            className="mt-1 block w-28 rounded-lg border border-edge bg-abyss px-2.5 py-1.5 font-mono text-sm text-ink"
          />
        </div>
        <div>
          <label htmlFor={blocksId} className="text-xs text-ink-muted">
            Blocks to simulate
          </label>
          <input
            id={blocksId}
            type="number"
            min={1}
            max={2000}
            value={blocks}
            onChange={(event) => setBlocks(Number(event.target.value))}
            className="mt-1 block w-28 rounded-lg border border-edge bg-abyss px-2.5 py-1.5 font-mono text-sm text-ink"
          />
        </div>
        <div>
          <label htmlFor={seedId} className="text-xs text-ink-muted">
            Seed (optional, for replay)
          </label>
          <input
            id={seedId}
            value={seed}
            inputMode="numeric"
            onChange={(event) => setSeed(event.target.value.replace(/\D/g, ""))}
            placeholder="random"
            className="mt-1 block w-36 rounded-lg border border-edge bg-abyss px-2.5 py-1.5 font-mono text-sm text-ink"
          />
        </div>
        <button
          type="button"
          disabled={!valid || competition.isPending}
          onClick={() =>
            competition.mutate({
              miners: parsed,
              difficulty_bits: bits,
              blocks,
              seed: seed === "" ? null : Number(seed),
            })
          }
          className="rounded-lg bg-ember-500 px-4 py-2 text-sm font-medium text-void hover:bg-ember-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Run competition
        </button>
      </div>
      {!valid && (
        <p className="mt-2 text-xs text-fault">Every miner needs a unique name and a positive hash rate.</p>
      )}
      {competition.isError && (
        <p role="alert" className="mt-2 text-sm text-fault">
          {competition.error.message}
        </p>
      )}

      {result && (
        <div className="mt-6 space-y-5" aria-live="polite">
          <dl className="grid gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-ink-faint">Expected block time</dt>
              <dd className="font-mono text-ink">{formatSpan(result.expected_block_time_seconds)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Observed mean</dt>
              <dd className="font-mono text-ink">{formatSpan(result.mean_block_time_seconds)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Simulated time</dt>
              <dd className="font-mono text-ink">{formatSpan(result.total_time_seconds)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Seed</dt>
              <dd className="font-mono break-all text-ink">{result.seed}</dd>
            </div>
          </dl>
          <ShareChart result={result} />
          <table className="w-full text-left text-xs">
            <caption className="mb-2 text-left text-xs text-ink-muted">
              {formatCount(result.blocks.length)} simulated blocks at 2^{result.difficulty_bits} expected
              hashes each. More blocks bring actual shares closer to expected ones.
            </caption>
            <thead className="text-ink-faint">
              <tr>
                <th scope="col" className="py-1 pr-2 font-medium">
                  Miner
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">
                  Hash rate
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">
                  Expected share
                </th>
                <th scope="col" className="py-1 pr-2 text-right font-medium">
                  Blocks won
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Actual share
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/60 font-mono font-tabular">
              {result.miners.map((miner) => (
                <tr key={miner.name}>
                  <td className="py-1.5 pr-2 font-sans text-ink">{miner.name}</td>
                  <td className="py-1.5 pr-2 text-right text-ink-muted">
                    {formatHashrate(miner.hashrate_hs)}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-ink-muted">{percent(miner.expected_share)}</td>
                  <td className="py-1.5 pr-2 text-right text-ink">{miner.blocks_won}</td>
                  <td className="py-1.5 text-right text-ink">{percent(miner.actual_share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
