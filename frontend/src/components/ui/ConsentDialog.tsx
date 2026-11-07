import { ShieldAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

interface ConsentDialogProps {
  open: boolean;
  title: string;
  /** Concrete, honest statements of what will happen (resources, duration, scope). */
  impact: readonly string[];
  acknowledgement: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Explicit, per-action permission for anything that consumes significant
 * resources (ADR 0002). The confirm button stays disabled until the user
 * ticks the acknowledgement; Escape, the backdrop and Cancel all decline.
 * Focus is trapped inside while open and restored afterwards.
 */
export function ConsentDialog({
  open,
  title,
  impact,
  acknowledgement,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConsentDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>("input")?.focus();
    return () => {
      setAcknowledged(false);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-void/80 backdrop-blur-sm" onClick={onCancel} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={onKeyDown}
        className="relative w-full max-w-md rounded-xl border border-ember-500/40 bg-panel p-6 shadow-glow-ember"
      >
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-ember-400" />
          <h2 id={titleId} className="font-display text-lg font-semibold text-ink">
            {title}
          </h2>
        </div>
        <ul id={descriptionId} className="mt-4 space-y-2 text-sm text-ink-muted">
          {impact.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden="true" className="text-ember-400">
                ›
              </span>
              {line}
            </li>
          ))}
        </ul>
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-edge bg-abyss p-3 text-sm text-ink">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-0.5 size-4 accent-ember-500"
          />
          {acknowledgement}
        </label>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm text-ink-muted hover:bg-panel-raised hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!acknowledged}
            className="rounded-lg bg-ember-500 px-4 py-2 text-sm font-medium text-void hover:bg-ember-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
