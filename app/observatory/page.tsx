"use client";

/**
 * The observatory — the three derived panels that are the point of the app.
 *
 * Each one shows something no single RPC field gives you:
 *
 *  · **Supply integrity** sums the pool balances the node reports and reconciles
 *    them against modelled ZIP-208 issuance. Two independent cross-checks are on
 *    screen: the node's own `getblocksubsidy` against our issuance model at this
 *    height, and reported total against modelled total.
 *
 *  · **Turnstile** charts per-pool value deltas block by block. Orchard is
 *    exit-only, so it can only drain; seeing that drain is the demonstration.
 *
 *  · **Privacy mix** classifies every transaction in the recent window and stacks
 *    each block as a column.
 *
 * The window sizes are user-adjustable, and each change re-requests — which the
 * server clamps, so no query parameter can make ZPulse walk the whole chain.
 * Because block data is immutable and cached by hash, widening a window and going
 * back costs nothing the second time.
 */

import { useState } from "react";
import {
  HiOutlineShieldCheck,
  HiOutlineArrowsRightLeft,
  HiOutlineChartBarSquare,
  HiOutlineClock,
  HiOutlineArrowPath,
  HiOutlineCube,
  HiOutlineLockClosed,
  HiOutlineScale,
  HiOutlineArrowTrendingDown,
  HiOutlineArrowTrendingUp,
} from "react-icons/hi2";
import { ZBarSeries, ZBlockStrip, ZPoolBar, ZSparkline } from "@/components/ZCharts";
import { poolColor, TX_CLASS_COLORS, TX_CLASS_ORDER } from "@/components/poolColors";
import { ZBadge, ZCard, ZDemoBanner, ZErrorNote, ZLegend, ZStat } from "@/components/ZUI";
import { useEnvelope } from "@/components/useEnvelope";
import {
  formatDelta,
  formatDuration,
  formatInt,
  formatPercent,
  formatZec,
  formatZecCompact,
} from "@/lib/analysis/format";
import { TX_CLASS_LABELS, type TxClass } from "@/lib/analysis/privacy";
import type { PoolsData, PrivacyData, TurnstileData } from "@/lib/data";
import type { UpgradeTimeline } from "@/lib/analysis/upgrades";

const TURNSTILE_WINDOWS = [16, 48, 96, 144];
const PRIVACY_WINDOWS = [4, 8, 12, 24, 32];

type ObservatoryTab = "all" | "supply" | "turnstile" | "privacy" | "upgrades";

export default function ObservatoryPage() {
  const [activeTab, setActiveTab] = useState<ObservatoryTab>("all");
  const [turnstileBlocks, setTurnstileBlocks] = useState(48);
  const [privacyBlocks, setPrivacyBlocks] = useState(12);

  const pools = useEnvelope<PoolsData>("/api/pools", 30_000);
  const turnstile = useEnvelope<TurnstileData>(`/api/turnstile?blocks=${turnstileBlocks}`, 60_000);
  const privacy = useEnvelope<PrivacyData>(`/api/privacy?blocks=${privacyBlocks}`, 60_000);
  const upgrades = useEnvelope<UpgradeTimeline>("/api/upgrades", 300_000);

  const isRefreshing = pools.refreshing || turnstile.refreshing || privacy.refreshing || upgrades.refreshing;

  const handleRefreshAll = () => {
    pools.refresh();
    turnstile.refresh();
    privacy.refresh();
    upgrades.refresh();
  };

  return (
    <>
      <div className="z-page-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1>Observatory</h1>
          <p>
            Shielded supply integrity, cross-pool turnstile flows, and per-block privacy analytics.
          </p>
        </div>
        <button
          type="button"
          className="z-btn z-primary"
          onClick={handleRefreshAll}
          title="Fetch latest block data and pool balances from the Zebra node"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px" }}
        >
          <HiOutlineArrowPath className={isRefreshing ? "z-spin" : ""} style={{ fontSize: 16 }} />
          <span>{isRefreshing ? "Fetching Live Data…" : "Refresh Live Data"}</span>
        </button>
      </div>

      <div className="z-tabs">
        <button
          type="button"
          className={`z-tab ${activeTab === "all" ? "z-active" : ""}`}
          onClick={() => setActiveTab("all")}
        >
          All Panels
        </button>
        <button
          type="button"
          className={`z-tab ${activeTab === "supply" ? "z-active" : ""}`}
          onClick={() => setActiveTab("supply")}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <HiOutlineShieldCheck style={{ fontSize: 15 }} />
          <span>Shielded Supply</span>
        </button>
        <button
          type="button"
          className={`z-tab ${activeTab === "turnstile" ? "z-active" : ""}`}
          onClick={() => setActiveTab("turnstile")}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <HiOutlineArrowsRightLeft style={{ fontSize: 15 }} />
          <span>Turnstile Flow</span>
        </button>
        <button
          type="button"
          className={`z-tab ${activeTab === "privacy" ? "z-active" : ""}`}
          onClick={() => setActiveTab("privacy")}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <HiOutlineChartBarSquare style={{ fontSize: 15 }} />
          <span>Privacy Mix</span>
        </button>
        <button
          type="button"
          className={`z-tab ${activeTab === "upgrades" ? "z-active" : ""}`}
          onClick={() => setActiveTab("upgrades")}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <HiOutlineClock style={{ fontSize: 15 }} />
          <span>Upgrades</span>
        </button>
      </div>

      <ZDemoBanner meta={pools.meta} />
      <ZErrorNote error={pools.error} meta={pools.meta} />

      {(activeTab === "all" || activeTab === "supply") && (
        <>
          <SupplyPanel pools={pools} />
          <div style={{ height: 20 }} />
        </>
      )}

      {(activeTab === "all" || activeTab === "turnstile") && (
        <>
          <TurnstilePanel
            turnstile={turnstile}
            blocks={turnstileBlocks}
            onBlocks={setTurnstileBlocks}
          />
          <div style={{ height: 20 }} />
        </>
      )}

      {(activeTab === "all" || activeTab === "privacy") && (
        <>
          <PrivacyPanel privacy={privacy} blocks={privacyBlocks} onBlocks={setPrivacyBlocks} />
          <div style={{ height: 20 }} />
        </>
      )}

      {(activeTab === "all" || activeTab === "upgrades") && (
        <UpgradePanel upgrades={upgrades} />
      )}
    </>
  );
}

/* ── supply ──────────────────────────────────────────────────────────────── */

function SupplyPanel({ pools }: { pools: ReturnType<typeof useEnvelope<PoolsData>> }) {
  const supply = pools.data?.supply ?? null;
  const monitored = supply?.pools.filter((pool) => pool.balanceZec !== null) ?? [];

  const segments = monitored.map((pool) => ({
    id: pool.id,
    label: pool.label,
    value: pool.balanceZec ?? 0,
  }));
  if (supply?.transparent.zec && supply.transparent.zec > 0) {
    segments.push({ id: "transparent", label: "Transparent", value: supply.transparent.zec });
  }

  const subsidy = supply?.subsidyCheck;

  return (
    <div className="z-stack">
      {/* Straight-to-the-point Explainer */}
      <div className="z-explainer-card">
        <div className="z-explainer-head">
          <HiOutlineShieldCheck style={{ fontSize: 18, color: "var(--z-amber)" }} />
          <h3 className="z-explainer-title">Shielded Supply Integrity</h3>
        </div>
        <p className="z-explainer-desc">
          Cryptographic proof of circulating ZEC across all Value Pools reconciled against the ZIP-208 halving curve.
        </p>
        <div className="z-explainer-terms">
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineCube style={{ fontSize: 13, color: "var(--z-amber)" }} />
              <span>Value Pools</span>
            </div>
            <p className="z-term-desc">Balances in Sprout, Sapling, Orchard, Ironwood, and Transparent storage.</p>
          </div>
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineLockClosed style={{ fontSize: 13, color: "var(--z-amber)" }} />
              <span>Shielded vs Transparent</span>
            </div>
            <p className="z-term-desc">Shielded is zero-knowledge encrypted; Transparent is public on-chain.</p>
          </div>
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineScale style={{ fontSize: 13, color: "var(--z-amber)" }} />
              <span>ZIP-208 Model Check</span>
            </div>
            <p className="z-term-desc">Validates live block rewards against the mathematical issuance schedule.</p>
          </div>
        </div>
      </div>

      <ZCard
        title="Shielded supply integrity"
        aside={
          supply ? (
            <ZBadge tone={supply.shieldedShare && supply.shieldedShare > 0.1 ? "ok" : undefined}>
              {formatPercent(supply.shieldedShare, 2)} shielded
            </ZBadge>
          ) : null
        }
        meta={pools.meta}
        note={
          supply
            ? `${supply.reconciliation.detail} ${supply.modelCheck.detail}`
            : "Waiting for the node's valuePools."
        }
      >
        <div className="z-grid" style={{ marginBottom: 18 }}>
          <ZStat
            label="Shielded value"
            value={formatZecCompact(supply?.shieldedZec)}
            unit="ZEC"
            accent
            loading={pools.loading}
            sub="sum of every pool the node classifies as shielded"
          />
          <ZStat
            label="Modelled issuance"
            value={formatZecCompact(supply?.issuedZec)}
            unit="ZEC"
            loading={pools.loading}
            sub={`ZIP-208 schedule at height ${formatInt(supply?.height)}`}
          />
          <ZStat
            label="Transparent"
            value={formatZecCompact(supply?.transparent.zec)}
            unit="ZEC"
            loading={pools.loading}
            sub={
              supply?.transparent.basis === "reported"
                ? "reported by the node"
                : supply?.transparent.basis === "derived"
                  ? "derived: issuance − shielded"
                  : "not determinable"
            }
          />
          <ZStat
            label="Shielded share"
            value={formatPercent(supply?.shieldedShare, 2)}
            loading={pools.loading}
            sub="of total issued value"
          />
        </div>

        <ZPoolBar segments={segments} />
        <ZLegend
          items={segments.map((segment) => ({
            id: segment.id,
            label: segment.label,
            value: formatZecCompact(segment.value),
          }))}
        />

        {supply && supply.unrecognisedPools.length > 0 ? (
          <p className="z-card-note">
            <strong style={{ color: "var(--z-pool-unknown)" }}>
              Pool{supply.unrecognisedPools.length === 1 ? "" : "s"} this build does not recognise:
            </strong>{" "}
            {supply.unrecognisedPools.join(", ")}. Rendered anyway, from the node&apos;s own
            <code> valuePools</code> — which is how a pool added after this app was written still
            shows up.
          </p>
        ) : null}
      </ZCard>

      <div className="z-grid-2">
        <ZCard title="Pool balances, as reported">
          <div className="z-table-wrap">
            <table className="z-table">
              <thead>
                <tr>
                  <th>Pool</th>
                  <th>Class</th>
                  <th className="z-n">Balance (ZEC)</th>
                </tr>
              </thead>
              <tbody>
                {supply?.pools.map((pool) => (
                  <tr key={pool.id}>
                    <td>
                      <span
                        className="z-legend-swatch"
                        style={{ background: poolColor(pool.id), display: "inline-block", marginRight: 7 }}
                      />
                      {pool.label}
                      {pool.unrecognised ? " *" : ""}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {pool.shielded ? "shielded" : "not shielded"}
                      {pool.classification === "assumed-shielded" ? " (assumed)" : ""}
                    </td>
                    <td className="z-n">
                      {pool.balanceZec === null ? "not reported" : formatZec(pool.balanceZec, 0)}
                    </td>
                  </tr>
                )) ?? (
                  <tr>
                    <td colSpan={3}>Waiting for the node…</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </ZCard>

        <ZCard
          title="Independent cross-check"
          aside={
            subsidy?.agrees === true ? (
              <ZBadge tone="ok">model agrees</ZBadge>
            ) : subsidy?.agrees === false ? (
              <ZBadge tone="bad">disagrees</ZBadge>
            ) : (
              <ZBadge>not comparable</ZBadge>
            )
          }
          note={subsidy?.detail}
        >
          <div className="z-grid">
            <ZStat
              label="Node getblocksubsidy"
              value={subsidy?.nodeZec === null || subsidy === undefined ? "—" : formatZec(subsidy.nodeZec, 4)}
              unit="ZEC"
              small
              loading={pools.loading}
              sub="block reward at this height, per the node"
            />
            <ZStat
              label="ZPulse model"
              value={subsidy ? formatZec(subsidy.modelledZec, 4) : "—"}
              unit="ZEC"
              small
              loading={pools.loading}
              sub="halving schedule computed here"
            />
            <ZStat
              label="Difference"
              value={subsidy?.deltaZec === null || subsidy === undefined ? "—" : formatDelta(subsidy.deltaZec)}
              unit="ZEC"
              small
              accent={subsidy?.agrees === false}
              loading={pools.loading}
              sub="two derivations of the same number"
            />
          </div>
          <p className="z-card-note">
            This is the panel that makes the supply figure checkable rather than decorative: the
            node&apos;s own subsidy answer and an independent model of the ZIP-208 schedule have to
            land on the same value. If they ever diverge, one of them is wrong and the app says so
            instead of averaging them.
          </p>
        </ZCard>
      </div>

      {pools.data?.treeState ? <TreeStateCard treeState={pools.data.treeState} /> : null}
    </div>
  );
}

function TreeStateCard({ treeState }: { treeState: NonNullable<PoolsData["treeState"]> }) {
  const pools = ["sprout", "sapling", "orchard", "ironwood"] as const;
  const rows = pools
    .map((name) => {
      const entry = treeState[name] as { commitments?: { finalRoot?: string } } | undefined;
      return { name, root: entry?.commitments?.finalRoot ?? null };
    })
    .filter((row) => row.root !== null);

  if (rows.length === 0) return null;

  return (
    <ZCard
      title="Commitment tree roots"
      note="The shielded state fingerprint at this height, from z_gettreestate. Two nodes that agree on the chain must agree on these roots — which is what makes them worth showing next to the balances."
    >
      <div className="z-table-wrap">
        <table className="z-table">
          <thead>
            <tr>
              <th>Pool</th>
              <th>Final root</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.name}>
                <td style={{ textTransform: "capitalize" }}>{row.name}</td>
                <td className="z-n" style={{ textAlign: "left", fontSize: 11.5, wordBreak: "break-all" }}>
                  {row.root}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ZCard>
  );
}

/* ── turnstile ───────────────────────────────────────────────────────────── */

function WindowPicker({
  options,
  value,
  onChange,
  unit = "blocks",
}: {
  options: number[];
  value: number;
  onChange: (next: number) => void;
  unit?: string;
}) {
  return (
    <span className="z-row" style={{ gap: 4 }}>
      <span className="z-label">{unit}</span>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className="z-btn"
          style={{
            padding: "3px 9px",
            fontSize: 12,
            fontFamily: "var(--z-mono)",
            borderColor: option === value ? "var(--z-amber)" : undefined,
            color: option === value ? "var(--z-amber)" : undefined,
          }}
          onClick={() => onChange(option)}
          aria-pressed={option === value}
        >
          {option}
        </button>
      ))}
    </span>
  );
}

function TurnstilePanel({
  turnstile,
  blocks,
  onBlocks,
}: {
  turnstile: ReturnType<typeof useEnvelope<TurnstileData>>;
  blocks: number;
  onBlocks: (next: number) => void;
}) {
  const data = turnstile.data;
  const flows = data?.flows ?? [];
  const ranked = [...flows].sort((a, b) => Math.abs(b.netZec) - Math.abs(a.netZec));
  const heights = data
    ? Array.from({ length: data.window.blocks }, (_, index) => data.window.fromHeight + index)
    : [];

  return (
    <div className="z-stack">
      {/* Turnstile Explainer */}
      <div className="z-explainer-card">
        <div className="z-explainer-head">
          <HiOutlineArrowsRightLeft style={{ fontSize: 18, color: "var(--z-amber)" }} />
          <h3 className="z-explainer-title">Turnstile Flow & Migration</h3>
        </div>
        <p className="z-explainer-desc">
          Tracks cross-pool ZEC movements as funds migrate out of exit-only pools into active shielded pools.
        </p>
        <div className="z-explainer-terms">
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineArrowTrendingDown style={{ fontSize: 13, color: "var(--z-warn)" }} />
              <span>Draining (Exit-Only)</span>
            </div>
            <p className="z-term-desc">Funds migrating out of an older pool into modern shielded storage.</p>
          </div>
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineArrowTrendingUp style={{ fontSize: 13, color: "var(--z-good)" }} />
              <span>Filling</span>
            </div>
            <p className="z-term-desc">Receiving incoming shielded value from migrations or shielding transactions.</p>
          </div>
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineScale style={{ fontSize: 13, color: "var(--z-amber)" }} />
              <span>valueDelta</span>
            </div>
            <p className="z-term-desc">Net ZEC balance change for a specific pool in each block (+ or -).</p>
          </div>
        </div>
      </div>

      <ZCard
        title="Turnstile — value moving between pools"
        aside={<WindowPicker options={TURNSTILE_WINDOWS} value={blocks} onChange={onBlocks} />}
        meta={turnstile.meta}
        note={data?.narrative}
        span
      >
        <div className="z-grid" style={{ marginBottom: 18 }}>
          <ZStat
            label="Window"
            value={data ? `${formatInt(data.window.fromHeight)}–${formatInt(data.window.toHeight)}` : "—"}
            small
            loading={turnstile.loading}
            sub={`${data?.window.blocks ?? blocks} blocks`}
          />
          <ZStat
            label="Timespan"
            value={formatDuration(data?.timespanSeconds)}
            small
            loading={turnstile.loading}
            sub="from block timestamps"
          />
          <ZStat
            label="Measured block time"
            value={data?.avgBlockSeconds ? `${data.avgBlockSeconds.toFixed(1)}` : "—"}
            unit="s"
            small
            loading={turnstile.loading}
            sub="Zcash targets 75s"
          />
          <ZStat
            label="Net across all pools"
            value={formatDelta(data?.netAllPoolsZec, 2)}
            unit="ZEC"
            small
            accent
            loading={turnstile.loading}
            sub="positive means pools grew overall"
          />
        </div>

        {ranked.length === 0 ? (
          <div className="z-chart-empty">
            {turnstile.loading ? "reading blocks…" : "no pool movement reported in this window"}
          </div>
        ) : (
          <div className="z-stack">
            {ranked.slice(0, 4).map((flow) => (
              <div key={flow.id}>
                <div className="z-row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
                  <span className="z-row" style={{ gap: 7 }}>
                    <span className="z-legend-swatch" style={{ background: poolColor(flow.id) }} />
                    <strong style={{ fontSize: 13.5 }}>{flow.label}</strong>
                    <ZBadge
                      tone={
                        flow.direction === "draining" ? "warn" : flow.direction === "filling" ? "ok" : undefined
                      }
                    >
                      {flow.direction}
                    </ZBadge>
                  </span>
                  <span className="z-num" style={{ fontSize: 13 }}>
                    {formatDelta(flow.netZec, 4)} ZEC net · {flow.activeBlocks}/{blocks} blocks active
                  </span>
                </div>
                <ZBarSeries
                  values={flow.series}
                  labels={heights}
                  positiveColor={poolColor(flow.id)}
                  negativeColor="var(--z-bad)"
                  height={72}
                />
                <div className="z-row" style={{ justifyContent: "space-between", fontSize: 11.5, color: "var(--z-text-faint)" }}>
                  <span className="z-num">in {formatZec(flow.inflowZec, 4)}</span>
                  <span className="z-num">cumulative {formatDelta(flow.cumulative[flow.cumulative.length - 1], 4)}</span>
                  <span className="z-num">out {formatZec(flow.outflowZec, 4)}</span>
                </div>
              </div>
            ))}

            {ranked.length > 0 ? (
              <div>
                <div className="z-label" style={{ marginBottom: 4 }}>
                  Cumulative movement, largest mover
                </div>
                <ZSparkline
                  values={ranked[0].cumulative}
                  color={poolColor(ranked[0].id)}
                  height={56}
                  label={`cumulative movement for ${ranked[0].label}`}
                />
              </div>
            ) : null}
          </div>
        )}
      </ZCard>
    </div>
  );
}

/* ── privacy ─────────────────────────────────────────────────────────────── */

function PrivacyPanel({
  privacy,
  blocks,
  onBlocks,
}: {
  privacy: ReturnType<typeof useEnvelope<PrivacyData>>;
  blocks: number;
  onBlocks: (next: number) => void;
}) {
  const data = privacy.data;

  return (
    <div className="z-stack">
      {/* Privacy Mix Explainer */}
      <div className="z-explainer-card">
        <div className="z-explainer-head">
          <HiOutlineChartBarSquare style={{ fontSize: 18, color: "var(--z-amber)" }} />
          <h3 className="z-explainer-title">Privacy Mix Analytics</h3>
        </div>
        <p className="z-explainer-desc">
          Classifies real-world transaction privacy directly from block transaction payloads.
        </p>
        <div className="z-explainer-terms">
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineLockClosed style={{ fontSize: 13, color: "var(--z-good)" }} />
              <span>Fully Shielded</span>
            </div>
            <p className="z-term-desc">100% private. Sender, recipient, and amount are all encrypted.</p>
          </div>
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineArrowsRightLeft style={{ fontSize: 13, color: "var(--z-amber)" }} />
              <span>Shielding / Deshielding</span>
            </div>
            <p className="z-term-desc">Depositing public ZEC into a private pool, or withdrawing back to public.</p>
          </div>
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineCube style={{ fontSize: 13, color: "var(--z-text-dim)" }} />
              <span>Transparent</span>
            </div>
            <p className="z-term-desc">Public transfer where addresses and amounts are visible.</p>
          </div>
        </div>
      </div>

      <ZCard
        title="Privacy mix — how shielded were the recent blocks?"
        aside={<WindowPicker options={PRIVACY_WINDOWS} value={blocks} onChange={onBlocks} />}
        meta={privacy.meta}
        note={data?.narrative}
        span
      >
      <div className="z-grid" style={{ marginBottom: 18 }}>
        <ZStat
          label="Shielded share"
          value={formatPercent(data?.shieldedShare, 1)}
          accent
          loading={privacy.loading}
          sub="user transactions touching any shielded pool"
        />
        <ZStat
          label="Fully shielded"
          value={formatPercent(data?.fullyShieldedShare, 1)}
          small
          loading={privacy.loading}
          sub="never touched the transparent pool"
        />
        <ZStat
          label="User transactions"
          value={formatInt(data?.userTxs)}
          small
          loading={privacy.loading}
          sub={`${formatInt(data?.totalTxs)} including coinbases`}
        />
        <ZStat
          label="Window"
          value={data ? `${formatInt(data.window.fromHeight)}–${formatInt(data.window.toHeight)}` : "—"}
          small
          loading={privacy.loading}
          sub={`${data?.window.blocks ?? blocks} blocks`}
        />
      </div>

      <ZBlockStrip blocks={data?.blocks ?? []} />
      <ZLegend
        items={TX_CLASS_ORDER.map((klass) => ({
          id: klass,
          label: TX_CLASS_LABELS[klass as TxClass],
          color: TX_CLASS_COLORS[klass],
          value: data ? formatInt(data.counts[klass as TxClass] ?? 0) : undefined,
        }))}
      />

      {data && data.poolUsage.length > 0 ? (
        <div className="z-table-wrap" style={{ marginTop: 18 }}>
          <table className="z-table">
            <thead>
              <tr>
                <th>Shielded pool used</th>
                <th className="z-n">Transactions</th>
                <th className="z-n">Components</th>
              </tr>
            </thead>
            <tbody>
              {data.poolUsage.map((usage) => (
                <tr key={usage.pool}>
                  <td>
                    <span
                      className="z-legend-swatch"
                      style={{ background: poolColor(usage.pool), display: "inline-block", marginRight: 7 }}
                    />
                    {usage.label}
                    {usage.recognised ? "" : " *"}
                  </td>
                  <td className="z-n">{formatInt(usage.txs)}</td>
                  <td className="z-n">{formatInt(usage.components)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {data && data.unrecognisedPools.length > 0 ? (
        <p className="z-card-note">
          * Found by transaction shape but not by name: {data.unrecognisedPools.join(", ")}. A pool
          that produces actions ZPulse has never seen still gets counted.
        </p>
      ) : null}
    </ZCard>
    </div>
  );
}

/* ── upgrades ────────────────────────────────────────────────────────────── */

function UpgradePanel({ upgrades }: { upgrades: ReturnType<typeof useEnvelope<UpgradeTimeline>> }) {
  const data = upgrades.data;

  return (
    <div className="z-stack">
      {/* Upgrades Explainer */}
      <div className="z-explainer-card">
        <div className="z-explainer-head">
          <HiOutlineClock style={{ fontSize: 18, color: "var(--z-amber)" }} />
          <h3 className="z-explainer-title">Network Upgrade Timeline</h3>
        </div>
        <p className="z-explainer-desc">
          Consensus upgrade status and arrival ETAs calculated from measured block times.
        </p>
        <div className="z-explainer-terms">
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineCube style={{ fontSize: 13, color: "var(--z-amber)" }} />
              <span>Network Upgrade (NU)</span>
            </div>
            <p className="z-term-desc">Hard fork upgrades (Sapling, Canopy, NU5, NU6) introducing protocol enhancements.</p>
          </div>
          <div className="z-term-item">
            <div className="z-term-title">
              <HiOutlineClock style={{ fontSize: 13, color: "var(--z-amber)" }} />
              <span>Measured Block Time</span>
            </div>
            <p className="z-term-desc">Calculated from recent header timestamps for real-world activation timing.</p>
          </div>
        </div>
      </div>

      <ZCard
        title="Network upgrade timeline"
        aside={
          data ? (
            <ZBadge tone={data.blockSecondsBasis === "measured" ? "ok" : undefined}>
              ETAs from {data.blockSecondsBasis} block time · {data.blockSeconds.toFixed(1)}s
            </ZBadge>
          ) : null
        }
        meta={upgrades.meta}
        note={
          data?.note ??
          "Read from the consensus upgrades map on getblockchaininfo. ETAs use the measured block time where recent headers are available."
        }
        span
      >
        {!data ? (
          <div className="z-chart-empty">{upgrades.loading ? "reading upgrade map…" : "no upgrade data"}</div>
        ) : (
          <ul className="z-timeline">
            {data.upgrades.map((upgrade) => {
              const isNext = data.next?.branchId === upgrade.branchId;
              return (
                <li
                  key={upgrade.branchId}
                  className={upgrade.status === "active" ? "z-active" : isNext ? "z-next" : undefined}
                >
                  <div className="z-row" style={{ gap: 9 }}>
                    <span className="z-timeline-name">{upgrade.name}</span>
                    <ZBadge tone={upgrade.status === "active" ? "ok" : isNext ? "accent" : undefined}>
                      {upgrade.status}
                    </ZBadge>
                    {isNext ? <ZBadge tone="accent">next</ZBadge> : null}
                  </div>
                  <div className="z-timeline-meta">
                    height {formatInt(upgrade.activationHeight)} · branch {upgrade.branchId}
                    {upgrade.blocksAway < 0
                      ? ` · ${formatInt(Math.abs(upgrade.blocksAway))} blocks ago`
                      : ` · in ${formatInt(upgrade.blocksAway)} blocks`}
                    {upgrade.etaSeconds !== null
                      ? ` · ~${formatDuration(upgrade.etaSeconds)} (${upgrade.confidence})`
                      : ""}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </ZCard>
    </div>
  );
}

