import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
}

/** A purposeful placeholder: says what will appear here and why it isn't yet. */
export function EmptyState({ icon, title, children, footer }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-start gap-3 rounded-lg border border-dashed border-edge-strong/70 p-5">
      <div className="rounded-lg border border-edge bg-panel-raised p-2 text-ink-faint">{icon}</div>
      <div>
        <p className="text-sm font-medium text-ink">{title}</p>
        {children && <div className="mt-1 text-sm leading-relaxed text-ink-muted">{children}</div>}
      </div>
      {footer && <div className="mt-auto pt-1">{footer}</div>}
    </div>
  );
}
