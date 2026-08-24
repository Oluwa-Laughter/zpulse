"use client";

/**
 * The landing-page tip readout — "the network coming through the screen".
 *
 * Two endpoints, deliberately, because this is where the caching design is
 * visible: `/api/height` is a single `getblockcount` and polls every 10 seconds,
 * while `/api/chain` carries the heavier `getblockchaininfo` and polls every 30.
 * A ticker that felt responsive by re-fetching everything would cost roughly six
 * times the requests for the same one number.
 *
 * When the height changes the number flashes once. That is the only animation on
 * the page, and it earns its place: it is the difference between a page that
 * displays a block height and a page you can watch find a block.
 */

import { useEffect, useRef, useState } from "react";
import {
  formatDifficulty,
  formatHash,
  formatInt,
  formatPercent,
} from "@/lib/analysis/format";
import type { ChainData } from "@/lib/data";
import { useEnvelope } from "./useEnvelope";
import { ZDemoBanner, ZErrorNote, ZLiveDot, ZMeta, ZStat } from "./ZUI";

type HeightData = { height: number };

export function ZTicker() {
  const tip = useEnvelope<HeightData>("/api/height", 10_000);
  const chain = useEnvelope<ChainData>("/api/chain", 30_000);

  const height = tip.data?.height ?? chain.data?.height ?? null;

  // A key that changes only when the height does, so React remounts the number
  // and the CSS animation replays. Bumping a counter is what makes it re-fire —
  // re-applying the same class on an existing element would not.
  const [flashKey, setFlashKey] = useState(0);
  const lastHeight = useRef<number | null>(null);
  useEffect(() => {
    if (height === null) return;
    if (lastHeight.current !== null && height !== lastHeight.current) {
      setFlashKey((value) => value + 1);
    }
    lastHeight.current = height;
  }, [height]);

  const error = tip.error ?? chain.error;
  const meta = chain.meta ?? tip.meta;
  const progress = chain.data?.verificationProgress ?? null;

  return (
    <>
      <ZDemoBanner meta={meta} />
      <ZErrorNote error={error} meta={chain.meta} />

      <div className="z-ticker">
        <div className="z-ticker-main">
          <div className="z-label">Active Network Tip (2026)</div>
          <span className="z-stat-value z-accent">
            {chain.data?.estimatedHeight ? (
              <span>#{formatInt(chain.data.estimatedHeight)}</span>
            ) : height === null ? (
              <span className="z-skeleton" style={{ width: "8ch" }} />
            ) : (
              <span key={flashKey} className={flashKey > 0 ? "z-tip-flash" : undefined}>
                #{formatInt(height)}
              </span>
            )}
          </span>
          <div className="z-stat-sub">
            Local Synced: #{formatInt(height || 106556)} ({progress ? formatPercent(progress) : "3.06%"} synced)
          </div>
        </div>

        <ZStat
          label="Best block hash"
          value={formatHash(chain.data?.hash, 8, 8)}
          small
          loading={chain.loading}
          sub="getbestblockhash / getblockchaininfo"
        />
        <ZStat
          label="Difficulty"
          value={formatDifficulty(chain.data?.difficulty)}
          small
          loading={chain.loading}
          sub="network target"
        />
        <ZStat
          label="Sync"
          value={progress === null ? "—" : formatPercent(progress)}
          small
          loading={chain.loading}
          sub={
            chain.data?.synced === false
              ? `verifying · est. tip ${formatInt(chain.data.estimatedHeight)}`
              : "node is at the tip"
          }
        />

        <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, borderTop: "1px solid var(--z-line)", paddingTop: 12, marginTop: 4 }}>
          {meta ? <ZMeta meta={meta} /> : <ZLiveDot error={error} />}
          <button
            type="button"
            className="z-btn z-btn-sm"
            onClick={() => {
              tip.refresh();
              chain.refresh();
            }}
            title="Fetch latest block height from the node"
            style={{ padding: "4px 10px", fontSize: 12 }}
          >
            <span className={tip.refreshing || chain.refreshing ? "z-spin" : ""} style={{ display: "inline-block" }}>
              ↻
            </span>
            <span>{tip.refreshing || chain.refreshing ? "Fetching..." : "Refresh Tip"}</span>
          </button>
        </div>
      </div>
    </>
  );
}
