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

export default function ObservatoryPage() {
  const [turnstileBlocks, setTurnstileBlocks] = useState(48);
  const [privacyBlocks, setPrivacyBlocks] = useState(12);

  const pools = useEnvelope<PoolsData>("/api/pools", 30_000);
  const turnstile = useEnvelope<TurnstileData>(`/api/turnstile?blocks=${turnstileBlocks}`, 60_000);
  const privacy = useEnvelope<PrivacyData>(`/api/privacy?blocks=${privacyBlocks}`, 60_000);
  const upgrades = useEnvelope<UpgradeTimeline>("/api/upgrades", 300_000);

  return (
    <>
      <div className="z-page-head">
        <h1>Observatory</h1>
        <p>
          Shielded supply integrity, turnstile flow and per-block privacy mix — all derived from a
          Zcash node over JSON-RPC. Every panel names the methods it used at its foot.
        </p>
      </div>

      <ZDemoBanner meta={pools.meta} />
      <ZErrorNote error={pools.error} meta={pools.meta} />

      <SupplyPanel pools={pools} />

      <div style={{ height: 16 }} />
      <TurnstilePanel
        turnstile={turnstile}
        blocks={turnstileBlocks}
        onBlocks={setTurnstileBlocks}
      />

      <div style={{ height: 16 }} />
      <PrivacyPanel privacy={privacy} blocks={privacyBlocks} onBlocks={setPrivacyBlocks} />

      <div style={{ height: 16 }} />
      <UpgradePanel upgrades={upgrades} />
    </>
  );
}

/* ── supply ──────────────────────────────────────────────────────────────── */

function SupplyPanel({ pools }: { pools: ReturnType<typeof useEnvelope<PoolsData>> }) {
  const supply = pools.data?.supply ?? null;
  const monitored = supply?.pools.filter((pool) => pool.balanceZec !== null) ?? [];

  // The bar shows what the node reports plus transparent value, so the segments
  // add up to something meaningful rather than to "the shielded pools only".
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
  // Biggest mover first — with Orchard exit-only that is usually the drain itself.
  const ranked = [...flows].sort((a, b) => Math.abs(b.netZec) - Math.abs(a.netZec));
  // Bar tooltips want a height per bar. The series is oldest-first over a
  // contiguous window, so the heights are the window walked forward.
  const heights = data
    ? Array.from({ length: data.window.blocks }, (_, index) => data.window.fromHeight + index)
    : [];

  return (
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
  );
}

/* ── upgrades ────────────────────────────────────────────────────────────── */

function UpgradePanel({ upgrades }: { upgrades: ReturnType<typeof useEnvelope<UpgradeTimeline>> }) {
  const data = upgrades.data;

  return (
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
        "Read from the consensus upgrades map on getblockchaininfo — a field most dashboards never open. ETAs use the measured block time where we have enough recent headers to trust it, and fall back to the 75s target otherwise."
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
  );
}
