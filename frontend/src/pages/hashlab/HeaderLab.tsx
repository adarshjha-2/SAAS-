import { Minus, Plus } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { HashDisplay } from "@/components/hashlab/HashDisplay";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/Status";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useHeaderAnalysis, useNonceTries, usePresets } from "@/hooks/useHashLab";
import { cn } from "@/lib/format";
import type { HeaderInput } from "@/types/hashlab";

import { FIELD_LABELS, parseHeaderForm, toForm, UINT32_MAX, type FormState } from "./headerForm";

function Field({
  label,
  error,
  children,
  hint,
}: {
  label: string;
  error: string | undefined;
  children: (id: string) => ReactNode;
  hint?: ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-xs text-ink-muted">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="mt-1 text-xs text-fault">{error}</p>
      ) : (
        hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>
      )}
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded-lg border border-edge bg-abyss px-2.5 py-1.5 font-mono text-xs text-ink aria-invalid:border-fault/60";

function NonceExplorer({ header }: { header: HeaderInput }) {
  const [start, setStart] = useState(header.nonce);
  const [bits, setBits] = useState(16);
  const tries = useNonceTries();
  const startId = useId();
  const bitsId = useId();

  return (
    <div className="mt-6 border-t border-edge/70 pt-5">
      <h3 className="font-display text-sm font-semibold">Nonce explorer</h3>
      <p className="mt-1 text-sm text-ink-muted">
        Miners change the nonce and re-hash. Each hash is unpredictable, so finding one with enough leading
        zeros is pure trial and error.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={startId} className="text-xs text-ink-muted">
            Start nonce
          </label>
          <input
            id={startId}
            type="number"
            min={0}
            max={UINT32_MAX}
            value={start}
            onChange={(event) => setStart(Number(event.target.value))}
            className={cn(inputClass, "w-40")}
          />
        </div>
        <div>
          <label htmlFor={bitsId} className="text-xs text-ink-muted">
            Required leading zero bits
          </label>
          <input
            id={bitsId}
            type="number"
            min={1}
            max={64}
            value={bits}
            onChange={(event) => setBits(Number(event.target.value))}
            className={cn(inputClass, "w-28")}
          />
        </div>
        <button
          type="button"
          onClick={() =>
            tries.mutate({ header, start_nonce: Math.max(0, start), count: 16, difficulty_bits: bits })
          }
          className="rounded-lg border border-flux-500/40 px-3 py-1.5 text-sm text-flux-400 hover:bg-flux-500/10"
        >
          Try 16 nonces
        </button>
      </div>
      {tries.isError && <p className="mt-2 text-sm text-fault">{tries.error.message}</p>}
      {tries.data && (
        <table className="mt-3 w-full text-left text-xs">
          <caption className="sr-only">Hashes for consecutive nonces</caption>
          <thead className="text-ink-faint">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">
                Nonce
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                Hash
              </th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">
                Zero bits
              </th>
              <th scope="col" className="py-1 font-medium">
                ≥ {tries.data.difficulty_bits}?
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge/60 font-mono">
            {tries.data.tries.map((attempt) => (
              <tr key={attempt.nonce}>
                <td className="py-1 pr-3 text-ink-muted">{attempt.nonce}</td>
                <td className="py-1 pr-3">
                  <HashDisplay hash={attempt.hash} />
                </td>
                <td className="py-1 pr-3 text-right text-ink">{attempt.leading_zero_bits}</td>
                <td className="py-1">
                  {attempt.meets_difficulty ? <span className="text-ok">✓ yes</span> : "no"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function HeaderLab() {
  const presets = usePresets();
  const genesis = presets.data?.[0];
  const [form, setForm] = useState<FormState | null>(null);
  const current = form ?? (genesis ? toForm(genesis.header) : null);
  const parsed = current ? parseHeaderForm(current) : { header: null, errors: {} };
  const debouncedHeader = useDebouncedValue(parsed.header, 250);
  const analysis = useHeaderAnalysis(debouncedHeader);

  const update = (key: keyof HeaderInput, value: string) => {
    if (current) setForm({ ...current, [key]: value });
  };
  const nudgeNonce = (delta: number) => {
    if (!current) return;
    const next = Math.min(UINT32_MAX, Math.max(0, (Number(current.nonce) || 0) + delta));
    setForm({ ...current, nonce: String(next) });
  };

  return (
    <Panel title="Block header lab" eyebrow="Proof of work">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-muted">Load a real block:</span>
        {presets.data?.map((preset) => (
          <button
            key={preset.key}
            type="button"
            title={preset.description}
            onClick={() => setForm(toForm(preset.header))}
            className="rounded-md border border-edge px-2.5 py-1 text-xs text-ink-muted hover:border-edge-strong hover:text-ink"
          >
            {preset.name}
          </button>
        ))}
      </div>

      {current && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label={FIELD_LABELS.version} error={parsed.errors.version}>
            {(id) => (
              <input
                id={id}
                value={current.version}
                aria-invalid={Boolean(parsed.errors.version)}
                onChange={(e) => update("version", e.target.value)}
                className={inputClass}
              />
            )}
          </Field>
          <Field
            label={FIELD_LABELS.timestamp}
            error={parsed.errors.timestamp}
            hint={
              parsed.header
                ? new Date(parsed.header.timestamp * 1000).toISOString().replace(".000Z", " UTC")
                : null
            }
          >
            {(id) => (
              <input
                id={id}
                value={current.timestamp}
                aria-invalid={Boolean(parsed.errors.timestamp)}
                onChange={(e) => update("timestamp", e.target.value)}
                className={inputClass}
              />
            )}
          </Field>
          {(["prev_block_hash", "merkle_root"] as const).map((key) => (
            <div key={key} className="sm:col-span-2">
              <Field label={FIELD_LABELS[key]} error={parsed.errors[key]}>
                {(id) => (
                  <input
                    id={id}
                    value={current[key]}
                    spellCheck={false}
                    aria-invalid={Boolean(parsed.errors[key])}
                    onChange={(e) => update(key, e.target.value)}
                    className={inputClass}
                  />
                )}
              </Field>
            </div>
          ))}
          <Field label={FIELD_LABELS.bits} error={parsed.errors.bits} hint="Hex. 1d00ffff is difficulty 1.">
            {(id) => (
              <input
                id={id}
                value={current.bits}
                aria-invalid={Boolean(parsed.errors.bits)}
                onChange={(e) => update("bits", e.target.value)}
                className={inputClass}
              />
            )}
          </Field>
          <Field label={FIELD_LABELS.nonce} error={parsed.errors.nonce}>
            {(id) => (
              <div className="flex items-center gap-2">
                <input
                  id={id}
                  value={current.nonce}
                  aria-invalid={Boolean(parsed.errors.nonce)}
                  onChange={(e) => update("nonce", e.target.value)}
                  className={inputClass}
                />
                <button
                  type="button"
                  aria-label="Decrease nonce"
                  onClick={() => nudgeNonce(-1)}
                  className="mt-1 rounded-md border border-edge p-1.5 text-ink-muted hover:text-ink"
                >
                  <Minus className="size-3.5" />
                </button>
                <button
                  type="button"
                  aria-label="Increase nonce"
                  onClick={() => nudgeNonce(1)}
                  className="mt-1 rounded-md border border-edge p-1.5 text-ink-muted hover:text-ink"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
            )}
          </Field>
        </div>
      )}

      {analysis.isError && <p className="mt-4 text-sm text-fault">{analysis.error.message}</p>}
      {analysis.data && parsed.header && (
        <div className="mt-5 space-y-4" aria-live="polite">
          <div className="rounded-lg border border-edge bg-panel-raised p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-ink-muted">Block hash (double SHA-256 of the 80-byte header)</p>
              <StatusPill
                tone={analysis.data.meets_target ? "ok" : "fault"}
                label={analysis.data.meets_target ? "Meets target" : "Above target"}
              />
            </div>
            <HashDisplay hash={analysis.data.hash} className="mt-2 block text-sm" />
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-ink-faint">Leading zero bits</dt>
                <dd className="font-mono text-ink">{analysis.data.leading_zero_bits}</dd>
              </div>
              <div>
                <dt className="text-ink-faint">Difficulty (vs. difficulty 1)</dt>
                <dd className="font-mono text-ink">{analysis.data.difficulty.toLocaleString("en-US")}</dd>
              </div>
              <div className="sm:col-span-3">
                <dt className="text-ink-faint">Target (hash must be ≤ this)</dt>
                <dd>
                  <HashDisplay hash={analysis.data.target} />
                </dd>
              </div>
            </dl>
          </div>

          <table className="w-full text-left text-xs">
            <caption className="mb-2 text-left text-xs text-ink-muted">
              The 80-byte serialised header. Integers are little-endian and hashes are byte-reversed, as on
              the wire.
            </caption>
            <thead className="text-ink-faint">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Field
                </th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">
                  Offset
                </th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">
                  Bytes
                </th>
                <th scope="col" className="py-1 font-medium">
                  Serialised (hex)
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/60">
              {analysis.data.fields.map((field) => (
                <tr key={field.name}>
                  <td className="py-1.5 pr-3 text-ink-muted">{FIELD_LABELS[field.name]}</td>
                  <td className="py-1.5 pr-3 text-right font-mono text-ink-faint">{field.offset}</td>
                  <td className="py-1.5 pr-3 text-right font-mono text-ink-faint">{field.size}</td>
                  <td className="py-1.5 font-mono break-all text-ink">{field.bytes_hex}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <NonceExplorer key={parsed.header.nonce} header={parsed.header} />
        </div>
      )}
    </Panel>
  );
}
