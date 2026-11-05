import { cn } from "@/lib/format";

/**
 * A 64-hex-character hash with its leading zeros emphasised: those zeros are
 * what proof-of-work makes expensive to produce.
 */
export function HashDisplay({ hash, className }: { hash: string; className?: string }) {
  const zeros = hash.length - hash.replace(/^0+/, "").length;
  return (
    <code className={cn("font-mono text-xs break-all", className)} aria-label={`hash ${hash}`}>
      <span className="font-semibold text-flux-400">{hash.slice(0, zeros)}</span>
      <span className="text-ink-muted">{hash.slice(zeros)}</span>
    </code>
  );
}

/** Two equal-length hex strings, with the second's differing characters highlighted. */
export function HexDiff({ base, changed }: { base: string; changed: string }) {
  return (
    <code className="font-mono text-xs break-all" aria-label={`changed hash ${changed}`}>
      {[...changed].map((char, index) => (
        <span key={index} className={char === base[index] ? "text-ink-faint" : "text-ember-300"}>
          {char}
        </span>
      ))}
    </code>
  );
}
