import { useId } from "react";

/** The NEXUS hex mark: an "N" inside a hexagon, ember-to-flux gradient. */
export function NexusMark({ className = "size-9" }: { className?: string }) {
  const gradientId = useId();
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--color-ember-500)" />
          <stop offset="1" stopColor="var(--color-flux-500)" />
        </linearGradient>
      </defs>
      <path
        d="M32 7 53.65 19.5v25L32 57 10.35 44.5v-25L32 7Z"
        stroke={`url(#${gradientId})`}
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d="M23 42V22l18 20V22"
        stroke={`url(#${gradientId})`}
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function NexusWordmark() {
  return (
    <div className="flex items-center gap-3">
      <NexusMark />
      <div className="leading-none">
        <p className="font-display text-[15px] font-bold tracking-[0.18em] text-ink">
          NEXUS<span className="text-ember-500">·</span>HASH
        </p>
        <p className="mt-1 font-mono text-[10px] tracking-[0.32em] text-flux-400">AI PLATFORM</p>
      </div>
    </div>
  );
}
