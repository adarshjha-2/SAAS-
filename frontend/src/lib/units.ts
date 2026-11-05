const RATE_UNITS = [
  ["EH/s", 1e18],
  ["PH/s", 1e15],
  ["TH/s", 1e12],
  ["GH/s", 1e9],
  ["MH/s", 1e6],
  ["kH/s", 1e3],
] as const;

/** `1_320_000` -> `1.32 MH/s`. */
export function formatHashrate(hs: number | null | undefined): string {
  if (hs === null || hs === undefined || !Number.isFinite(hs) || hs <= 0) return "—";
  for (const [unit, scale] of RATE_UNITS) {
    if (hs >= scale) return `${(hs / scale).toFixed(2)} ${unit}`;
  }
  return `${Math.round(hs)} H/s`;
}

/** Grouped integer: `1234567` -> `1,234,567`; very large values in scientific notation. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e15) return n.toExponential(2).replace("e+", " × 10^");
  return Math.round(n).toLocaleString("en-US");
}

/** Human duration across many orders of magnitude: `0.4 s`, `3.2 min`, `5.1 h`, `12 days`, `3,100 years`. */
export function formatSpan(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  if (seconds < 3_600) return `${(seconds / 60).toFixed(1)} min`;
  if (seconds < 86_400) return `${(seconds / 3_600).toFixed(1)} h`;
  const days = seconds / 86_400;
  if (days < 365) return `${days.toFixed(days < 10 ? 1 : 0)} days`;
  const years = days / 365.25;
  if (years < 1e6) return `${formatCount(years)} years`;
  return `${years.toExponential(1).replace("e+", " × 10^")} years`;
}

export const HASHRATE_UNIT_OPTIONS = [
  { label: "H/s", scale: 1 },
  { label: "kH/s", scale: 1e3 },
  { label: "MH/s", scale: 1e6 },
  { label: "GH/s", scale: 1e9 },
  { label: "TH/s", scale: 1e12 },
  { label: "PH/s", scale: 1e15 },
  { label: "EH/s", scale: 1e18 },
] as const;
