const WIDTH = 96;
const HEIGHT = 28;
const PAD = 4;
const MAX_POINTS = 12;

interface SparklineProps {
  values: readonly number[];
  /** Accent for the current period (the last segment and end dot). */
  color: string;
  label: string;
}

/**
 * Compact trend: the history in a recessive ink, the latest segment and
 * end point in the accent. Shows the last 12 points.
 */
export function Sparkline({ values, color, label }: SparklineProps) {
  const points = values.slice(-MAX_POINTS);
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = (WIDTH - PAD * 2) / (points.length - 1);
  const coords = points.map((value, index) => ({
    x: PAD + index * step,
    y: HEIGHT - PAD - ((value - min) / span) * (HEIGHT - PAD * 2),
  }));
  const path = coords.map(({ x, y }) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  const previous = coords[coords.length - 2];

  return (
    <svg
      width={WIDTH}
      height={HEIGHT}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
      className="shrink-0 overflow-visible"
    >
      <polyline
        points={path}
        fill="none"
        stroke="var(--color-ink-faint)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {last && previous && (
        <>
          <line
            x1={previous.x}
            y1={previous.y}
            x2={last.x}
            y2={last.y}
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
          />
          <circle cx={last.x} cy={last.y} r={3} fill={color} stroke="var(--color-panel)" strokeWidth={2} />
        </>
      )}
    </svg>
  );
}
