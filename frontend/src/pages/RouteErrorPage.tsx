import { isRouteErrorResponse, useRouteError } from "react-router";

/** Rendered by the router when a route throws while rendering. */
export function RouteErrorPage() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Unknown error";
  return (
    <div role="alert" className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="font-display text-2xl font-bold text-fault">Interface fault</h1>
      <p className="mt-3 font-mono text-sm text-ink-muted">{message}</p>
      <a href="/" className="mt-6 inline-block text-sm text-flux-400 hover:text-flux-300">
        Reload NEXUS HASH AI
      </a>
    </div>
  );
}
