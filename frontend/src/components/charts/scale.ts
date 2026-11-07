/**
 * Clean axis ticks from zero: steps of 1, 2, 2.5 or 5 x 10^n, so a 36 ms peak
 * gives 0 / 10 / 20 / 30 / 40 instead of 0 / 9 / 18 / 27 / 36.
 */
export function niceTicks(max: number, intervals = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const rough = max / intervals;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const residual = rough / magnitude;
  const factor = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10;
  const step = factor * magnitude;
  const count = Math.ceil(max / step - 1e-9);
  return Array.from({ length: count + 1 }, (_, i) => Number((i * step).toPrecision(12)));
}

/** Axis label for a clean millisecond tick: `0 ms`, `2.5 ms`, `40 ms`, `1.5 s`. */
export function formatMsTick(ms: number): string {
  return ms >= 1_000 ? `${Number((ms / 1_000).toPrecision(3))} s` : `${Number(ms.toPrecision(3))} ms`;
}
