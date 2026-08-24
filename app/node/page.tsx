"use client";

/**
 * Node page — is the endpoint healthy, what does it speak, and what is it costing us?
 *
 * Three things live here that a plain dashboard would not have:
 *
 *  · **The capability report.** zcashd is deprecated, so zebrad is the node to
 *    expect — but zebrad gained `getmempoolinfo`, `getnetworkinfo` and per-pool
 *    `valueDelta` partway through its life, so which zebrad matters. ZPulse probes
 *    the node once and records what it answers, separately from reading what
 *    software it says it is. This table is that probe made visible — the
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

import { useState } from "react";
import Link from "next/link";
import {
  HiOutlineServerStack,
  HiOutlineServer,
  HiOutlineCube,
  HiOutlineSignal,
  HiOutlineInboxStack,
  HiOutlineBolt,
  HiOutlineArrowPath,
  HiOutlineAdjustmentsHorizontal,
  HiOutlineCloud,
  HiOutlineComputerDesktop,
  HiOutlineShieldCheck,
} from "react-icons/hi2";
import { ZNodeSwitcherModal } from "@/components/ZNodeSwitcherModal";

export default function NodePage() {
  const node = useEnvelope<NodeData>("/api/node", 15_000);
  const history = useEnvelope<HistoryData>("/api/history?limit=240", 30_000);
  const capabilities = useEnvelope<CapabilitiesData>("/api/capabilities", 0);
  const [isSwitcherOpen, setIsSwitcherOpen] = useState(false);

  const data = node.data;
  const alerts = history.data?.alerts ?? [];
  const progressPercent = data?.verificationProgress ? Math.min(Math.round(data.verificationProgress * 1000) / 10, 100) : 0;

  const isRefreshing = node.refreshing || history.refreshing || capabilities.refreshing;
  const isDemo = node.meta?.mode === "demo";

  const handleRefreshAll = () => {
    node.refresh();
    history.refresh();
    capabilities.refresh();
  };

  return (
    <>
      <div className="z-page-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1>Zebra Node Operations & Sync</h1>
          <p>
            Real-time health, sync progress, P2P topology, mempool footprint, and RPC performance.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="z-btn"
            onClick={() => setIsSwitcherOpen(true)}
            title="Switch Node: Demo Mode, Local Zebra Node, or 3rd-Party Cloud RPC"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px" }}
          >
            <HiOutlineAdjustmentsHorizontal style={{ fontSize: 16, color: "var(--z-amber)" }} />
            <span>Switch Node Source</span>
          </button>

          <button
            type="button"
            className="z-btn z-primary"
            onClick={handleRefreshAll}
            title="Fetch latest node status, peer count, and mempool size"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px" }}
          >
            <HiOutlineArrowPath className={isRefreshing ? "z-spin" : ""} style={{ fontSize: 16 }} />
            <span>{isRefreshing ? "Refreshing Node…" : "Refresh Node Status"}</span>
          </button>
        </div>
      </div>

      {/* Node Connection Source Banner */}
      <div style={{ background: "var(--z-bg-raised)", border: "1px solid var(--z-line)", borderRadius: "var(--z-radius)", padding: "14px 18px", marginBottom: 20, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {isDemo ? (
            <HiOutlineShieldCheck style={{ fontSize: 24, color: "var(--z-amber)", flexShrink: 0 }} />
          ) : capabilities.data?.config.endpoint.includes("127.0.0.1") || capabilities.data?.config.endpoint.includes("localhost") ? (
            <HiOutlineComputerDesktop style={{ fontSize: 24, color: "var(--z-ok)", flexShrink: 0 }} />
          ) : (
            <HiOutlineCloud style={{ fontSize: 24, color: "var(--z-accent)", flexShrink: 0 }} />
          )}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Active Connection:</span>
              <ZBadge tone={isDemo ? "warn" : "ok"}>
                {isDemo ? "Demo Sandbox" : capabilities.data?.config.endpoint.includes("127.0.0.1") ? "Local Node" : "3rd-Party Remote RPC"}
              </ZBadge>
            </div>
            <div style={{ fontSize: 12, color: "var(--z-text-muted)", marginTop: 2 }}>
              {isDemo
                ? "Simulated Zebra mainnet dialect (zero setup required)"
                : `Connected to ${capabilities.data?.config.endpoint || "Live Node"}`}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="z-btn z-btn-sm"
          onClick={() => setIsSwitcherOpen(true)}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <HiOutlineAdjustmentsHorizontal style={{ fontSize: 14 }} />
          <span>Change Connection</span>
        </button>
      </div>

      <ZDemoBanner meta={node.meta} />
      <ZErrorNote error={node.error} meta={node.meta} />

      <ZNodeSwitcherModal
        isOpen={isSwitcherOpen}
        onClose={() => setIsSwitcherOpen(false)}
        onChanged={handleRefreshAll}
      />

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

      {/* Zebra Node Operations & Sync HUD */}
      <div className="z-hud-card" style={{ marginBottom: 20 }}>
        <div className="z-row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <span className="z-label" style={{ color: "var(--z-amber)", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <HiOutlineServerStack style={{ fontSize: 14 }} />
            <span>Zebra Node Sync HUD</span>
          </span>
          <div className="z-row" style={{ gap: 6 }}>
            <ZBadge tone={data?.synced === false ? "warn" : "ok"}>
              {data?.synced === false ? "Syncing Chain" : "Fully Synchronized"}
            </ZBadge>
            <span className="z-num" style={{ fontSize: 12, color: "var(--z-text)" }}>
              {formatPercent(data?.verificationProgress, 2)}
            </span>
          </div>
        </div>

        <div className="z-sync-bar-wrap">
          <div className="z-sync-bar">
            <div
              className="z-sync-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <div className="z-row" style={{ justifyContent: "space-between", fontSize: 12, color: "var(--z-text-faint)", marginTop: 6 }}>
          <span>Current Tip: <strong style={{ color: "var(--z-text)" }}>{data?.height ? formatInt(data.height) : "—"}</strong></span>
          <span>
            {data?.synced === false
              ? `Estimated Target: ${formatInt(data?.estimatedHeight ?? 0)} blocks`
              : `At Network Head (#${formatInt(data?.height ?? 0)})`}
          </span>
        </div>
      </div>

      {/* Straight-to-the-point Node Explainer */}
      <div className="z-explainer-card">
        <div className="z-explainer-head">
          <HiOutlineServer style={{ fontSize: 18, color: "var(--z-amber)" }} />
          <h3 className="z-explainer-title">Zebra Node Diagnostics</h3>
        </div>
        <p className="z-explainer-desc">
          Live telemetry from your connected Zebra (<code>zebrad</code>) full node over JSON-RPC.
        </p>
        <div className="z-explainer-terms">
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineCube style={{ fontSize: 13, color: "var(--z-amber)" }} />
              <span>Block Height (Tip)</span>
            </div>
            <p className="z-term-desc">The highest validated block on the chain.</p>
          </div>
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineSignal style={{ fontSize: 13, color: "var(--z-amber)" }} />
              <span>P2P Peers</span>
            </div>
            <p className="z-term-desc">Connected network nodes sharing blocks and transactions.</p>
          </div>
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineInboxStack style={{ fontSize: 13, color: "var(--z-amber)" }} />
              <span>Mempool</span>
            </div>
            <p className="z-term-desc">Pending unconfirmed transactions waiting to be mined.</p>
          </div>
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineBolt style={{ fontSize: 13, color: "var(--z-amber)" }} />
              <span>Sol/s (Hashrate)</span>
            </div>
            <p className="z-term-desc">Proof-of-Work computational mining power securing the network.</p>
          </div>
        </div>
      </div>

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
            label="Sync Progress"
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
            label="Network Hashrate"
            value={formatSolps(data?.solps)}
            small
            loading={node.loading}
            sub="getnetworksolps"
          />
          <ZStat
            label="Node Version"
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
          title="RPC surface probed"
          aside={
            capabilities.data ? (
              <ZBadge tone="accent">{capabilities.data.implementation}</ZBadge>
            ) : null
          }
          note="What the node implements is probed by calling each method once and reading the error: JSON-RPC returns −32601 for a method that does not exist, and any other error proves the method is there. Which software it is comes from its own user agent."
        >
          {capabilities.data ? (
            <>
              <div className="z-row" style={{ marginBottom: 12 }}>
                <ZStat
                  label="Methods answered"
                  value={`${capabilities.data.supportedCount}/${capabilities.data.totalCount}`}
                  small
                />
                <ZStat
                  label="Reported user agent"
                  value={capabilities.data.userAgent ?? "—"}
                  small
                  sub={
                    capabilities.data.userAgent
                      ? "getinfo / getnetworkinfo"
                      : "no method here reports one"
                  }
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
                          <Link href={`/rpc?method=${entry.method}`} style={{ color: "inherit" }} title="Open in RPC Console">
                            {entry.method} ↗
                          </Link>
                          {entry.kind !== "method" ? (
                            <span style={{ color: "var(--z-text-faint)" }}> ({entry.kind})</span>
                          ) : null}
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
          title="RPC query telemetry"
          aside={
            data ? (
              <ZBadge tone={data.calls.errors === 0 ? "ok" : "warn"}>
                {data.calls.errors === 0 ? "100% successful" : `${data.calls.errors} errors`}
              </ZBadge>
            ) : null
          }
          note="Live telemetry tracking all JSON-RPC calls sent to the connected Zebra node."
        >
          <div className="z-grid">
            <ZStat label="Total Calls" value={formatInt(data?.calls.calls)} small loading={node.loading} sub="queries executed" />
            <ZStat label="Successful" value={formatInt((data?.calls.calls ?? 0) - (data?.calls.errors ?? 0))} small loading={node.loading} sub="valid responses" />
            <ZStat label="Errors" value={formatInt(data?.calls.errors)} small loading={node.loading} sub={data?.calls.errors === 0 ? "zero faults" : "failed queries"} />
          </div>
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
