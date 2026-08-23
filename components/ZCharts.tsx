/**
 * Hand-rolled SVG charts.
 *
 * No charting library, for two reasons. The practical one: the dependency budget
 * for this project is four packages, all of them type definitions. The better one:
 * every chart here needs something a generic library fights you on — the turnstile
 * chart is signed around a zero line because value leaving a pool is the whole
 * point, and the privacy strip is one column per block with a fixed class order so
 * the colours stay comparable between blocks.
 *
 * `vectorEffect="non-scaling-stroke"` keeps every line 1px no matter how the
 * viewBox scales, which is what stops these looking like stretched clip-art at
 * wide viewports.
 */

import type { ReactNode } from "react";
import { poolColor, TX_CLASS_COLORS, TX_CLASS_ORDER } from "./poolColors";

function Empty({ children }: { children: ReactNode }) {
  return <div className="z-chart-empty">{children}</div>;
}

/* ── sparkline ───────────────────────────────────────────────────────────── */

/**
 * A plain line, used for poller history and RPC latency.
 *
 * A flat series is drawn through the vertical middle rather than at the bottom:
 * with `max === min` the naive scale divides by zero, and pinning it to the floor
 * makes a perfectly steady value look like a dead sensor.
 */
export function ZSparkline({
  values,
  color = "var(--z-amber)",
  height = 40,
  fill = true,
  label,
}: {
  values: number[];
  color?: string;
  height?: number;
  fill?: boolean;
  label?: string;
}) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 2) return <Empty>not enough samples yet</Empty>;

  const width = 320;
  const pad = 3;
  const max = Math.max(...clean);
  const min = Math.min(...clean);
  const span = max - min;

  const x = (index: number) => (index / (clean.length - 1)) * (width - pad * 2) + pad;
  const y = (value: number) =>
    span === 0 ? height / 2 : height - pad - ((value - min) / span) * (height - pad * 2);

  const line = clean.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(clean.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`;
  const gradientId = `z-spark-${color.replace(/[^a-z0-9]/gi, "")}-${clean.length}`;

  return (
    <svg
      className="z-chart"
      viewBox={`0 0 ${width} ${height}`}
      height={height}
      role="img"
      aria-label={label ?? `sparkline of ${clean.length} samples`}
      preserveAspectRatio="none"
    >
      {fill ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} stroke="none" />
        </>
      ) : null}
      <path d={line} className="z-spark-line" stroke={color} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/* ── signed bar series ───────────────────────────────────────────────────── */

/**
 * Per-block deltas around a zero line — the turnstile chart.
 *
 * Bars below the line are value leaving the pool. Orchard is exit-only since NU6
 * activated Ironwood, so a healthy reading here is a row of downward bars, and
 * that has to be visually unmistakable rather than a colour difference alone.
 */
export function ZBarSeries({
  values,
  labels,
  positiveColor = "var(--z-good)",
  negativeColor = "var(--z-bad)",
  height = 96,
  unit = "ZEC",
}: {
  values: number[];
  labels?: number[];
  positiveColor?: string;
  negativeColor?: string;
  height?: number;
  unit?: string;
}) {
  if (values.length === 0) return <Empty>no blocks in this window</Empty>;

  const width = 640;
  const magnitude = Math.max(...values.map((value) => Math.abs(value)), Number.EPSILON);
  const allZero = values.every((value) => value === 0);
  const mid = height / 2;
  const slot = width / values.length;
  const barWidth = Math.max(slot * 0.68, 1);

  return (
    <svg
      className="z-chart"
      viewBox={`0 0 ${width} ${height}`}
      height={height}
      role="img"
      aria-label={`per-block change, ${values.length} blocks`}
      preserveAspectRatio="none"
    >
      <line x1="0" y1={mid} x2={width} y2={mid} className="z-chart-zero" vectorEffect="non-scaling-stroke" />
      {allZero
        ? null
        : values.map((value, index) => {
            const scaled = (Math.abs(value) / magnitude) * (mid - 4);
            const barHeight = Math.max(scaled, value === 0 ? 0 : 1);
            const up = value > 0;
            return (
              <rect
                key={index}
                x={index * slot + (slot - barWidth) / 2}
                y={up ? mid - barHeight : mid}
                width={barWidth}
                height={barHeight}
                fill={up ? positiveColor : negativeColor}
                opacity={0.85}
              >
                <title>
                  {labels?.[index] !== undefined ? `Block ${labels[index]}: ` : ""}
                  {value > 0 ? "+" : ""}
                  {value.toFixed(4)} {unit}
                </title>
              </rect>
            );
          })}
      {allZero ? (
        <text x={width / 2} y={mid - 8} textAnchor="middle" fill="var(--z-text-faint)" fontSize="13">
          no movement in this window
        </text>
      ) : null}
    </svg>
  );
}

/* ── stacked pool bar ────────────────────────────────────────────────────── */

/**
 * Value distribution across pools, as one horizontal bar.
 *
 * Segments come from whatever the node reported — nothing is hardcoded, so a pool
 * that did not exist when this was written still gets a segment and a colour.
 */
export function ZPoolBar({
  segments,
}: {
  segments: Array<{ id: string; label: string; value: number }>;
}) {
  const usable = segments.filter((segment) => segment.value > 0);
  const total = usable.reduce((sum, segment) => sum + segment.value, 0);
  if (total <= 0) return <Empty>no pool balances reported</Empty>;

  return (
    <div className="z-poolbar" role="img" aria-label="value distribution across pools">
      {usable.map((segment) => (
        <div
          key={segment.id}
          className="z-poolbar-seg"
          style={{
            width: `${(segment.value / total) * 100}%`,
            background: poolColor(segment.id),
          }}
          title={`${segment.label}: ${segment.value.toLocaleString(undefined, {
            maximumFractionDigits: 0,
          })} ZEC (${((segment.value / total) * 100).toFixed(2)}%)`}
        />
      ))}
    </div>
  );
}

/* ── privacy block strip ─────────────────────────────────────────────────── */

/**
 * One column per block, each stacked by transaction class.
 *
 * Columns are normalised to their own user-transaction count so a quiet block and
 * a busy block are comparable as *mixes*; the tooltip carries the absolute counts.
 * The coinbase is excluded from the denominator upstream, because a block whose
 * only transaction is the coinbase is not "0% shielded" — it is empty.
 */
export function ZBlockStrip({
  blocks,
}: {
  blocks: Array<{ height: number; userTxCount: number; counts: Record<string, number> }>;
}) {
  if (blocks.length === 0) return <Empty>no blocks in this window</Empty>;

  return (
    <>
      <div className="z-strip">
        {blocks.map((block) => {
          const total = TX_CLASS_ORDER.reduce((sum, klass) => sum + (block.counts[klass] ?? 0), 0);
          const summary = TX_CLASS_ORDER.filter((klass) => (block.counts[klass] ?? 0) > 0)
            .map((klass) => `${klass}: ${block.counts[klass]}`)
            .join(", ");

          return (
            <div
              className="z-strip-block"
              key={block.height}
              title={`Block ${block.height} — ${block.userTxCount} user tx${
                block.userTxCount === 1 ? "" : "s"
              }${summary ? `\n${summary}` : ""}`}
            >
              {total === 0
                ? null
                : TX_CLASS_ORDER.map((klass) => {
                    const count = block.counts[klass] ?? 0;
                    if (count === 0) return null;
                    return (
                      <div
                        key={klass}
                        className="z-strip-seg"
                        style={{
                          height: `${(count / total) * 100}%`,
                          background: TX_CLASS_COLORS[klass],
                        }}
                      />
                    );
                  })}
            </div>
          );
        })}
      </div>
      <div className="z-strip-labels">
        <span>{blocks[0]?.height}</span>
        <span>{blocks[blocks.length - 1]?.height} (tip)</span>
      </div>
    </>
  );
}
