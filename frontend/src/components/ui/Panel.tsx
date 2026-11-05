import type { ReactNode } from "react";

import { cn } from "@/lib/format";

interface PanelProps {
  title?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** The base surface for every dashboard block. */
export function Panel({ title, eyebrow, actions, className, children }: PanelProps) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-xl border border-edge bg-panel/80 backdrop-blur-sm",
        "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px",
        "before:bg-linear-to-r before:from-transparent before:via-ember-500/40 before:to-transparent",
        className,
      )}
    >
      {(title !== undefined || actions !== undefined) && (
        <header className="flex items-start justify-between gap-4 border-b border-edge/70 px-5 py-4">
          <div>
            {eyebrow && (
              <p className="font-mono text-[10px] tracking-[0.2em] text-ink-faint uppercase">{eyebrow}</p>
            )}
            {title && <h2 className="font-display text-sm font-semibold tracking-wide text-ink">{title}</h2>}
          </div>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
