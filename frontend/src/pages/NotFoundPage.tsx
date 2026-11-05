import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="py-24 text-center">
      <p className="font-mono text-sm tracking-[0.3em] text-ember-400">404</p>
      <h1 className="mt-3 font-display text-2xl font-bold">Signal lost</h1>
      <p className="mt-2 text-ink-muted">This route does not exist.</p>
      <Link to="/" className="mt-6 inline-block text-sm text-flux-400 hover:text-flux-300">
        Return to Command Center
      </Link>
    </div>
  );
}
