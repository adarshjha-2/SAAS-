import { ArrowLeft, History } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";

import { ACTIVITY_LEVELS } from "@/components/activity/levels";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { ProvenanceBadge } from "@/components/ui/ProvenanceBadge";
import { useActivityPages, type ActivityFilters } from "@/hooks/useActivity";
import { useSystemInfo } from "@/hooks/useSystem";
import { cn, formatDateTime } from "@/lib/format";
import type { ActivityCategoryName, ActivityLevelName, ServerActivityEntry } from "@/types/api";

const LEVEL_OPTIONS: ActivityLevelName[] = ["info", "success", "warning", "error"];
const CATEGORY_OPTIONS: ActivityCategoryName[] = [
  "system",
  "database",
  "hashlab",
  "hardware",
  "network",
  "profitability",
  "intelligence",
  "core",
];

function FilterSelect<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | undefined;
  options: readonly T[];
  onChange: (value: T | undefined) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs text-ink-muted">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange((event.target.value || undefined) as T | undefined)}
        className="rounded-lg border border-edge bg-abyss px-2.5 py-1.5 text-sm text-ink capitalize"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}

function EntryRow({ entry }: { entry: ServerActivityEntry }) {
  const level = ACTIVITY_LEVELS[entry.level];
  const Icon = level.icon;
  return (
    <li className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[11rem_6.5rem_1fr]">
      <time dateTime={entry.ts} className="font-mono text-xs text-ink-faint">
        {formatDateTime(Date.parse(entry.ts))}
      </time>
      <span className={cn("inline-flex items-center gap-1.5 self-start text-xs", level.className)}>
        <Icon className="size-3.5" aria-hidden="true" />
        {level.label}
      </span>
      <div className="min-w-0">
        <p className="text-sm text-ink">{entry.message}</p>
        {entry.detail && <p className="mt-0.5 text-xs break-words text-ink-muted">{entry.detail}</p>}
        <p className="mt-1 font-mono text-[10px] tracking-wider text-ink-faint uppercase">
          {entry.category} · {entry.actor === "user" ? "initiated by you" : "automatic"} · #{entry.id}
        </p>
      </div>
    </li>
  );
}

/** The persisted activity log: filterable, newest first, with keyset "load older" pagination. */
export function ActivityPage() {
  const [filters, setFilters] = useState<ActivityFilters>({});
  const pages = useActivityPages(filters);
  const info = useSystemInfo();
  const entries = pages.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = filters.level !== undefined || filters.category !== undefined;

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Command Center
      </Link>

      <section className="animate-fade-up">
        <p className="font-mono text-[11px] tracking-[0.3em] text-ember-400 uppercase">Nexus Command</p>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">Activity log</h1>
        <p className="mt-2 max-w-2xl text-ink-muted">
          Everything the platform has done, persisted on the server.
          {info.data &&
            ` Entries are kept for ${info.data.database.activity_retention_days} days (at most ${info.data.database.activity_max_entries.toLocaleString()}).`}
        </p>
      </section>

      <div role="group" aria-label="Filters" className="flex flex-wrap items-center gap-4">
        <FilterSelect
          label="Level"
          value={filters.level}
          options={LEVEL_OPTIONS}
          onChange={(level) => setFilters((current) => ({ ...current, level }))}
        />
        <FilterSelect
          label="Category"
          value={filters.category}
          options={CATEGORY_OPTIONS}
          onChange={(category) => setFilters((current) => ({ ...current, category }))}
        />
        {filtered && (
          <button
            type="button"
            onClick={() => setFilters({})}
            className="text-xs text-flux-400 hover:text-flux-300"
          >
            Clear filters
          </button>
        )}
      </div>

      <Panel title="Entries" eyebrow="Newest first" actions={<ProvenanceBadge kind="live" />}>
        {pages.isPending && <p className="text-sm text-ink-muted">Loading activity…</p>}
        {pages.isError && (
          <p role="alert" className="text-sm text-fault">
            Could not load the activity log: {pages.error.message}
          </p>
        )}
        {pages.isSuccess && entries.length === 0 && (
          <EmptyState icon={<History className="size-4" />} title="No matching entries">
            {filtered ? "Nothing matches these filters." : "The server has not recorded any activity yet."}
          </EmptyState>
        )}
        {entries.length > 0 && (
          <ol
            aria-label="Server activity"
            className={cn("divide-y divide-edge/70", pages.isRefetching && "opacity-70")}
          >
            {entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
        {pages.hasNextPage && (
          <button
            type="button"
            onClick={() => void pages.fetchNextPage()}
            disabled={pages.isFetchingNextPage}
            className="mt-4 rounded-lg border border-edge px-4 py-2 text-sm text-ink-muted hover:border-edge-strong hover:text-ink disabled:opacity-50"
          >
            {pages.isFetchingNextPage ? "Loading…" : "Load older entries"}
          </button>
        )}
      </Panel>
    </div>
  );
}
