import { useId, useState } from "react";

import { HexDiff } from "@/components/hashlab/HashDisplay";
import { Panel } from "@/components/ui/Panel";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useSha256 } from "@/hooks/useHashLab";

const MAX_CHARS = 1_000;

export function Sha256Playground() {
  const inputId = useId();
  const [text, setText] = useState("NEXUS HASH AI");
  const debounced = useDebouncedValue(text, 200);
  const { data, isError, error } = useSha256(debounced);

  return (
    <Panel title="SHA-256 playground" eyebrow="Hash functions">
      <label htmlFor={inputId} className="text-sm text-ink-muted">
        Type anything. Bitcoin hashes block headers with SHA-256, twice.
      </label>
      <textarea
        id={inputId}
        value={text}
        maxLength={MAX_CHARS}
        onChange={(event) => setText(event.target.value)}
        rows={2}
        className="mt-2 w-full resize-y rounded-lg border border-edge bg-abyss px-3 py-2 font-mono text-sm text-ink"
      />
      <p className="mt-1 text-right font-mono text-[11px] text-ink-faint">
        {text.length} / {MAX_CHARS}
      </p>

      {isError && <p className="text-sm text-fault">{error.message}</p>}
      {data && (
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="text-ink-muted">SHA-256 ({data.input_bytes} bytes in)</dt>
            <dd className="font-mono text-xs break-all text-ink">{data.sha256}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Double SHA-256 (what Bitcoin uses)</dt>
            <dd className="font-mono text-xs break-all text-ink">{data.double_sha256}</dd>
          </div>
          {data.avalanche && (
            <div className="rounded-lg border border-edge bg-panel-raised p-3">
              <dt className="text-ink-muted">
                Avalanche effect: flip just the last bit of your input and{" "}
                <strong className="text-ink">
                  {data.avalanche.changed_bits} of 256 output bits change (
                  {data.avalanche.changed_percent.toFixed(1)}%)
                </strong>
                . Changed hex digits are highlighted.
              </dt>
              <dd className="mt-2">
                <HexDiff base={data.sha256} changed={data.avalanche.sha256} />
              </dd>
            </div>
          )}
        </dl>
      )}
    </Panel>
  );
}
