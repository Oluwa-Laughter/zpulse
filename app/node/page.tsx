"use client";

/**
 * Node page — is the endpoint healthy, what does it speak, and what is it costing us?
 *
 * Three things live here that a plain dashboard would not have:
 *
 *  · **The dialect report.** zcashd is deprecated and Zebra implements neither
 *    `getnetworkinfo` nor `getmempoolinfo`, so ZPulse probes the node once and
 *    records what it answers. This table is that probe made visible — the
 *    unsupported rows are the interesting ones, because they are the calls the app
 *    is deliberately routing around rather than crashing on.
 *
 *  · **Per-method latency**, measured on the way through the real transport, with
 *    a sparkline per method. This is how you tell a slow provider from a slow app.
 *
 *  · **Cache effectiveness.** The hit rate is the number that decides whether this
 *    app survives a 40,000-request daily quota. It is on screen because it is a
 *    load-bearing claim, not an implementation detail.
 */

import { ZSparkline } from "@/components/ZCharts";
import { ZBadge, ZCard, ZDemoBanner, ZErrorNote, ZStat } from "@/components/ZUI";
import { useEnvelope } from "@/components/useEnvelope";
import {
  formatAgo,
  formatBytes,
  formatInt,
  formatPercent,
  formatSolps,
  formatZecCompact,
} from "@/lib/analysis/format";
import type { Alert } from "@/lib/alerts/rules";
import type { CapabilityReport } from "@/lib/rpc/capabilities";
import type { NodeData, Snapshot } from "@/lib/data";
import type { StoreDescription } from "@/lib/store/types";

type HistoryData = {
  snapshots: Snapshot[];
  alerts: Alert[];
  thresholds: { minPeers: number; stallMinutes: number; minSyncProgress: number };
  sinks: { discord: boolean; webhook: boolean };
  store: StoreDescription;
};

type CapabilitiesData = CapabilityReport & {
  config: {
    mode: "live" | "demo";
    endpoint: string;
    tipTtlMs: number;
    slowTtlMs: number;
    turnstileWindow: number;
    privacyWindow: number;
  };
};

export default function NodePage() {
  const node = useEnvelope<NodeData>("/api/node", 15_000);
  const history = useEnvelope<HistoryData>("/api/history?limit=240", 30_000);
  const capabilities = useEnvelope<CapabilitiesData>("/api/capabilities", 0);

  const data = node.data;
  const alerts = history.data?.alerts ?? [];

  return (
    <>
      <div className="z-page-head">
        <h1>Node</h1>
        <p>
          Health of the endpoint ZPulse is reading from, which RPC dialect it speaks, how fast each
          method answers, and how much of the traffic the server cache is absorbing.
        </p>
      </div>

      <ZDemoBanner meta={node.meta} />
      <ZErrorNote error={node.error} meta={node.meta} />

      {alerts.length > 0 ? (
        <div style={{ marginBottom: 20 }}>
          {alerts.map((alert) => (
            <div
              className={alert.severity === "critical" ? "z-alert z-critical" : "z-alert"}
              key={alert.id}
            >
              <ZBadge tone={alert.severity === "critical" ? "bad" : "warn"}>{alert.severity}</ZBadge>
              <span>{alert.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      <ZCard title="Endpoint health" meta={node.meta} span>
        <div className="z-grid">
          <ZStat
            label="Height"
            value={formatInt(data?.height)}
            accent
            loading={node.loading}
            sub={
              data?.peers?.bestPeerHeight
                ? `best peer claims ${formatInt(data.peers.bestPeerHeight)}`
                : "chain tip as this node sees it"
            }
          />
          <ZStat
            label="Sync"
            value={formatPercent(data?.verificationProgress)}
            small
            loading={node.loading}
            sub={data?.synced === false ? `estimated tip ${formatInt(data.estimatedHeight)}` : "at the tip"}
          />
          <ZStat
            label="Peers"
            value={formatInt(data?.peers?.count)}
            small
            loading={node.loading}
            sub={
              data?.peers
                ? `${data.peers.outbound} out · ${data.peers.inbound} in`
                : "getpeerinfo unavailable"
            }
          />
          <ZStat
            label="Mempool"
            value={formatInt(data?.mempool?.size)}
            unit="tx"
            small
            loading={node.loading}
            sub={data?.mempool?.bytes !== null && data?.mempool ? formatBytes(data.mempool.bytes) : "size only"}
          />
          <ZStat
            label="Network hashrate"
            value={formatSolps(data?.solps)}
            small
            loading={node.loading}
            sub="getnetworksolps"
          />
          <ZStat
            label="Node version"
            value={data?.version ?? "—"}
            small
            loading={node.loading}
            sub={data?.chain ? `chain: ${data.chain}` : "getinfo / getnetworkinfo"}
          />
        </div>
      </ZCard>

      <div style={{ height: 16 }} />

      <div className="z-grid-2">
        <ZCard
          title="RPC dialect detected"
          aside={
            capabilities.data ? (
              <ZBadge tone="accent">{capabilities.data.dialect}</ZBadge>
            ) : null
          }
          note="Detected by calling each method once and reading the error. JSON-RPC returns −32601 for a method that does not exist, and any other error proves the method is there — so an unsupported row here is a fact about the node, not a guess."
        >
          {capabilities.data ? (
            <>
              <div className="z-row" style={{ marginBottom: 12 }}>
                <ZStat
                  label="Methods answered"
                  value={`${capabilities.data.supportedCount}/${capabilities.data.totalCount}`}
                  small
                />
              </div>
              <div className="z-table-wrap">
                <table className="z-table">
                  <thead>
                    <tr>
                      <th>Method</th>
                      <th>Provides</th>
                      <th className="z-n">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {capabilities.data.entries.map((entry) => (
                      <tr key={entry.key}>
                        <td style={{ fontFamily: "var(--z-mono)", fontSize: 12 }}>
                          {entry.method}
                          {entry.feature ? <span style={{ color: "var(--z-text-faint)" }}> (feature)</span> : null}
                        </td>
                        <td style={{ fontSize: 12 }}>{entry.label}</td>
                        <td className="z-n">
                          {entry.supported ? (
                            <span style={{ color: "var(--z-good)" }}>supported</span>
                          ) : (
                            <span style={{ color: "var(--z-warn)" }}>unsupported</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="z-chart-empty">probing the node…</div>
          )}
        </ZCard>

        <ZCard
          title="Request budget"
          aside={
            data ? (
              <ZBadge tone={data.cache.hitRate > 0.5 ? "ok" : "warn"}>
                {formatPercent(data.cache.hitRate, 1)} cache hits
              </ZBadge>
            ) : null
          }
          note="Hosted Zcash providers meter requests, so the cache is not an optimisation here — it is the reason a page anyone can open does not exhaust a daily quota. Identical concurrent reads are coalesced into one upstream call, and block data is cached by hash because it can never change."
        >
          <div className="z-grid">
            <ZStat label="Upstream calls" value={formatInt(data?.calls.calls)} small loading={node.loading} sub={`${formatInt(data?.calls.errors)} errors`} />
            <ZStat label="Cache hits" value={formatInt(data?.cache.hits)} small loading={node.loading} sub={`${formatInt(data?.cache.misses)} misses`} />
            <ZStat label="Cached entries" value={formatInt(data?.cache.entries)} small loading={node.loading} sub="live in this process" />
          </div>
          {capabilities.data ? (
            <p className="z-card-note">
              Endpoint <code>{capabilities.data.config.endpoint}</code> in{" "}
              <strong>{capabilities.data.config.mode}</strong> mode · tip TTL{" "}
              {Math.round(capabilities.data.config.tipTtlMs / 1000)}s · slow TTL{" "}
              {Math.round(capabilities.data.config.slowTtlMs / 1000)}s. Only the host is ever shown:
              hosted providers put the access token in the URL path, so the path never leaves the
              server.
            </p>
          ) : null}
        </ZCard>
      </div>

      <div style={{ height: 16 }} />

      <ZCard
        title="Per-method latency"
        note="Measured inside the transport on every call, so these are the timings the app actually experienced — not a synthetic ping."
        span
      >
        <div className="z-table-wrap">
          <table className="z-table">
            <thead>
              <tr>
                <th>Method</th>
                <th className="z-n">Calls</th>
                <th className="z-n">Errors</th>
                <th className="z-n">Last</th>
                <th className="z-n">Avg</th>
                <th className="z-n">Min / max</th>
                <th style={{ width: 140 }}>Recent</th>
                <th className="z-n">Last called</th>
              </tr>
            </thead>
            <tbody>
              {(data?.methods ?? []).length === 0 ? (
                <tr>
                  <td colSpan={8}>No calls recorded yet in this process.</td>
                </tr>
              ) : (
                data?.methods.map((stat) => (
                  <tr key={stat.method}>
                    <td style={{ fontFamily: "var(--z-mono)", fontSize: 12 }}>{stat.method}</td>
                    <td className="z-n">{formatInt(stat.calls)}</td>
                    <td className="z-n" style={{ color: stat.errors > 0 ? "var(--z-bad)" : undefined }}>
                      {formatInt(stat.errors)}
                    </td>
                    <td className="z-n">{stat.lastLatencyMs === null ? "—" : `${stat.lastLatencyMs}ms`}</td>
                    <td className="z-n">{stat.avgLatencyMs === null ? "—" : `${Math.round(stat.avgLatencyMs)}ms`}</td>
                    <td className="z-n">
                      {stat.minLatencyMs === null ? "—" : `${stat.minLatencyMs} / ${stat.maxLatencyMs}`}
                    </td>
                    <td style={{ minWidth: 120 }}>
                      <ZSparkline
                        values={stat.samples}
                        height={26}
                        color="var(--z-amber)"
                        fill={false}
                        label={`latency samples for ${stat.method}`}
                      />
                    </td>
                    <td className="z-n">{formatAgo(stat.lastCalledAt ? stat.lastCalledAt / 1000 : null)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </ZCard>

      <div style={{ height: 16 }} />

      <HistoryPanel history={history} />
    </>
  );
}

/* ── poller history ──────────────────────────────────────────────────────── */

function HistoryPanel({ history }: { history: ReturnType<typeof useEnvelope<HistoryData>> }) {
  const data = history.data;
  const snapshots = data?.snapshots ?? [];

  const series = (pick: (snapshot: Snapshot) => number | null) =>
    snapshots.map(pick).filter((value): value is number => value !== null);

  const thresholds = data?.thresholds;

  return (
    <ZCard
      title="Poller history"
      aside={
        data ? (
          <ZBadge tone={data.store.durable ? undefined : "warn"}>
            {data.store.kind} · {data.store.entries} rows · {data.store.durable ? "durable" : "in memory only"}
          </ZBadge>
        ) : null
      }
      meta={history.meta}
      note={
        snapshots.length === 0
          ? 'Nothing recorded yet. Run "npm run poll" next to the dev server, or point a scheduler at /api/cron/poll, and these fill in.'
          : `${snapshots.length} samples. Alerts fire below ${thresholds?.minPeers} peers, after ${thresholds?.stallMinutes} minutes without a new block, or below ${formatPercent(thresholds?.minSyncProgress, 1)} sync${
              data?.sinks.discord || data?.sinks.webhook
                ? " — and are delivered to the configured webhook on transition only, never repeatedly."
                : ". No webhook configured, so transitions are logged server-side only."
            }`
      }
      span
    >
      {snapshots.length === 0 ? (
        <div className="z-chart-empty">no samples yet</div>
      ) : (
        <div className="z-grid-2">
          <div>
            <div className="z-label">Height</div>
            <ZSparkline values={series((snapshot) => snapshot.height)} color="var(--z-amber)" height={52} />
          </div>
          <div>
            <div className="z-label">Peers</div>
            <ZSparkline values={series((snapshot) => snapshot.peers)} color="var(--z-good)" height={52} />
          </div>
          <div>
            <div className="z-label">Mempool size</div>
            <ZSparkline values={series((snapshot) => snapshot.mempoolSize)} color="var(--z-pool-orchard)" height={52} />
          </div>
          <div>
            <div className="z-label">
              Shielded value · latest {formatZecCompact(snapshots[snapshots.length - 1]?.shieldedZec)} ZEC
            </div>
            <ZSparkline values={series((snapshot) => snapshot.shieldedZec)} color="var(--z-pool-sapling)" height={52} />
          </div>
        </div>
      )}
    </ZCard>
  );
}
