/** Shown while a route's code chunk loads (route-level code splitting). */
export function RouteLoading() {
  return (
    <div role="status" className="flex min-h-[40vh] items-center justify-center gap-3 text-sm text-ink-faint">
      <span className="size-2 animate-pulse-soft rounded-full bg-flux-500" aria-hidden="true" />
      Loading module…
    </div>
  );
}
