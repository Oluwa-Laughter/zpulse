/**
 * ZPulse presentational primitives.
 *
 * All pure — no hooks, no fetches — so they work in both server and client trees.
 *
 * The one with real opinions in it is `ZMeta`. Every panel in this app renders it,
 * and it exists because a blockchain dashboard that shows a number without saying
 * where the number came from is not verifiable. It reports the source (live node,
 * server cache, or demo fixture), how old the value is, the endpoint host, and the
 * exact RPC methods the panel used. That last part is what turns the app from
 * "trust these figures" into "here is how to check them".
 */

import type { ReactNode } from "react";
import type { Meta } from "@/lib/data";
import type { ApiError } from "./useEnvelope";
import { poolColor } from "./poolColors";

/* ── card ────────────────────────────────────────────────────────────────── */

export function ZCard({
  title,
  aside,
  note,
  meta,
  span,
  children,
}: {
  title?: string;
  aside?: ReactNode;
  note?: ReactNode;
  meta?: Meta | null;
  span?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={span ? "z-card z-card-span" : "z-card"}>
      {(title || aside) && (
        <div className="z-card-head">
          {title ? <h2 className="z-card-title">{title}</h2> : <span />}
          {aside}
        </div>
      )}
      {children}
      {note ? <p className="z-card-note">{note}</p> : null}
      {meta ? <ZMeta meta={meta} /> : null}
    </section>
  );
}

/* ── stat ────────────────────────────────────────────────────────────────── */

export function ZStat({
  label,
  value,
  unit,
  sub,
  accent,
  small,
  loading,
  flash,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  accent?: boolean;
  small?: boolean;
  loading?: boolean;
  flash?: boolean;
}) {
  const classes = ["z-stat-value"];
  if (small) classes.push("z-sm");
  if (accent) classes.push("z-accent");
  if (flash) classes.push("z-tip-flash");

  return (
    <div>
      <div className="z-label">{label}</div>
      <span className={classes.join(" ")}>
        {loading ? <span className="z-skeleton" style={{ width: "6ch" }} /> : value}
        {unit && !loading ? <span className="z-stat-unit">{unit}</span> : null}
      </span>
      {sub ? <div className="z-stat-sub">{sub}</div> : null}
    </div>
  );
}

/* ── source indicator ────────────────────────────────────────────────────── */

/**
 * The live/cache/demo dot.
 *
 * `demo` is deliberately amber-warning rather than green: demo mode is a valid
 * state but it must never be mistaken for a working node connection.
 */
export function ZLiveDot({ meta, error }: { meta?: Meta | null; error?: ApiError | null }) {
  let kind = "z-down";
  let text = "no data";

  if (error) {
    kind = "z-down";
    text = "degraded";
  } else if (meta?.mode === "demo") {
    kind = "z-demo";
    text = "demo";
  } else if (meta?.source === "live") {
    kind = "z-live";
    text = "live";
  } else if (meta?.source === "cache") {
    kind = "z-cache";
    text = "cached";
  }

  return (
    <span className="z-badge">
      <span className={`z-dot ${kind}`} aria-hidden="true" />
      {text}
    </span>
  );
}

export function ZBadge({
  tone,
  children,
}: {
  tone?: "ok" | "warn" | "bad" | "accent";
  children: ReactNode;
}) {
  return <span className={tone ? `z-badge z-${tone}` : "z-badge"}>{children}</span>;
}

/* ── provenance strip ────────────────────────────────────────────────────── */

function ageText(ageMs: number): string {
  if (ageMs < 1_500) return "just now";
  if (ageMs < 60_000) return `${Math.round(ageMs / 1000)}s ago`;
  if (ageMs < 3_600_000) return `${Math.round(ageMs / 60_000)}m ago`;
  return `${Math.round(ageMs / 3_600_000)}h ago`;
}

export function ZMeta({ meta }: { meta: Meta }) {
  return (
    <div className="z-meta">
      <ZLiveDot meta={meta} />
      <span>{ageText(meta.ageMs)}</span>
      {meta.via.length > 0 ? (
        <span className="z-meta-via">
          {meta.via.map((method) => (
            <code key={method}>{method}</code>
          ))}
        </span>
      ) : null}
    </div>
  );
}

import { HiOutlineExclamationTriangle, HiOutlineInformationCircle } from "react-icons/hi2";

/**
 * Shown whenever the app is serving preview fixtures.
 */
export function ZDemoBanner({ meta }: { meta?: Meta | null }) {
  if (!meta || meta.mode !== "demo") return null;
  return (
    <div className="z-banner" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <HiOutlineInformationCircle style={{ fontSize: 18, color: "var(--z-amber)", flexShrink: 0 }} />
      <span>
        <strong>Preview Mode.</strong> Displaying simulated Zebra node state for interactive exploration.
      </span>
    </div>
  );
}

/**
 * The failure display.
 *
 * It shows the reason, and it never suggests the data might be fine. When the
 * node is unreachable this is the whole screen, so it has to be legible rather
 * than a red toast that disappears.
 */
export function ZErrorNote({ error, meta }: { error?: ApiError | null; meta?: Meta | null }) {
  const notes = meta?.notes ?? [];
  if (!error && notes.length === 0) return null;

  return (
    <div className={error ? "z-banner z-bad" : "z-banner"} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <HiOutlineExclamationTriangle style={{ fontSize: 18, color: error ? "var(--z-bad)" : "var(--z-warn)", flexShrink: 0, marginTop: 2 }} />
      <div>
        {error ? (
          <>
            <strong>{error.kind}.</strong> {error.message}
          </>
        ) : (
          <strong>Partially degraded.</strong>
        )}
        {notes.length > 0 ? (
          <ul className="z-note-list">
            {notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function ZSkeleton({ width = "8ch" }: { width?: string }) {
  return <span className="z-skeleton" style={{ width }} />;
}

/* ── pool legend ─────────────────────────────────────────────────────────── */

export function ZLegend({
  items,
}: {
  items: Array<{ id: string; label: string; value?: string; color?: string }>;
}) {
  return (
    <div className="z-legend">
      {items.map((item) => (
        <span className="z-legend-item" key={item.id}>
          <span
            className="z-legend-swatch"
            style={{ background: item.color ?? poolColor(item.id) }}
            aria-hidden="true"
          />
          {item.label}
          {item.value !== undefined ? <span className="z-legend-value">{item.value}</span> : null}
        </span>
      ))}
    </div>
  );
}
