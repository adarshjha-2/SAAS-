import { cn } from "@/lib/format";

import type { Tone } from "./status-meta";

const DOT_TONE: Record<Tone, string> = {
  ok: "bg-ok shadow-[0_0_10px_var(--color-ok)]",
  warn: "bg-warn shadow-[0_0_10px_var(--color-warn)]",
  fault: "bg-fault shadow-[0_0_10px_var(--color-fault)]",
  idle: "bg-ink-faint",
  flux: "bg-flux-500 shadow-[0_0_10px_var(--color-flux-500)]",
  ember: "bg-ember-500 shadow-[0_0_10px_var(--color-ember-500)]",
};

const PILL_TONE: Record<Tone, string> = {
  ok: "border-ok/30 bg-ok/10 text-ok",
  warn: "border-warn/30 bg-warn/10 text-warn",
  fault: "border-fault/30 bg-fault/10 text-fault",
  idle: "border-edge-strong bg-panel-raised text-ink-muted",
  flux: "border-flux-500/30 bg-flux-500/10 text-flux-400",
  ember: "border-ember-500/30 bg-ember-500/10 text-ember-400",
};

export function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        DOT_TONE[tone],
        pulse && "animate-pulse-soft",
      )}
    />
  );
}

export function StatusPill({
  tone,
  label,
  pulse = false,
  title,
}: {
  tone: Tone;
  label: string;
  pulse?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[11px] tracking-wide uppercase",
        PILL_TONE[tone],
      )}
    >
      <StatusDot tone={tone} pulse={pulse} />
      {label}
    </span>
  );
}
