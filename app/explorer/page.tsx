"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  HiOutlineMagnifyingGlass,
  HiOutlineCube,
  HiOutlineArrowsRightLeft,
  HiOutlineLockClosed,
  HiOutlineArrowLeft,
  HiOutlineArrowRight,
  HiOutlineArrowPath,
  HiOutlineDocumentDuplicate,
  HiCheck,
} from "react-icons/hi2";
import { ZBadge, ZCard, ZDemoBanner, ZErrorNote, ZStat } from "@/components/ZUI";
import { ZJsonView } from "@/components/ZJsonView";
import { useEnvelope } from "@/components/useEnvelope";
import { formatBlockAge, formatDelta, formatInt, formatUtcDateTime, formatZec } from "@/lib/analysis/format";
import { TX_CLASS_LABELS } from "@/lib/analysis/privacy";
import { poolColor } from "@/components/poolColors";
import type { ExplorerBlockData, ExplorerTxData } from "@/lib/data";

const QUICK_JUMPS = [
  { label: "Genesis (#0)", height: 0 },
  { label: "Overwinter (#347.5k)", height: 347500 },
  { label: "Sapling (#419k)", height: 419200 },
  { label: "Blossom (#653k)", height: 653600 },
  { label: "Canopy (#1.04M)", height: 1046400 },
  { label: "NU5 / Orchard (#1.68M)", height: 1687104 },
  { label: "NU6 / Lockbox (#2.72M)", height: 2726400 },
];

export default function ExplorerPage() {
  return (
    <Suspense fallback={<div className="z-chart-empty">Loading Block Explorer...</div>}>
      <ExplorerContent />
    </Suspense>
  );
}

function ExplorerContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? searchParams.get("block") ?? "";

  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);
  const [selectedTx, setSelectedTx] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const endpointUrl = activeQuery ? `/api/explorer?q=${encodeURIComponent(activeQuery)}` : "/api/explorer";
  const envelope = useEnvelope<ExplorerBlockData & ExplorerTxData & { isTx?: boolean }>(endpointUrl, 0);

  const data = envelope.data;
  const isTxResult = Boolean(data?.isTx || data?.tx);
  const block = data?.block;
  const txs = data?.txs ?? [];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (query) {
      setActiveQuery(query);
      router.push(`/explorer?q=${encodeURIComponent(query)}`);
    }
  };

  const handleQuickJump = (height: number) => {
    setSearchQuery(String(height));
    setActiveQuery(String(height));
    router.push(`/explorer?q=${height}`);
  };

  const handlePrevBlock = () => {
    if (block && block.height > 0) {
      const prev = block.height - 1;
      setSearchQuery(String(prev));
      setActiveQuery(String(prev));
      router.push(`/explorer?q=${prev}`);
    }
  };

  const handleNextBlock = () => {
    if (block) {
      const next = block.height + 1;
      setSearchQuery(String(next));
      setActiveQuery(String(next));
      router.push(`/explorer?q=${next}`);
    }
  };

  const handleCopy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <>
      <div className="z-page-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1>Block & Transaction Explorer</h1>
          <p>
            Inspect live Zcash blocks, verify transparent vs shielded transaction structures, and audit pool value deltas directly from the Zebra node.
          </p>
        </div>
        <button
          type="button"
          className="z-btn z-primary"
          onClick={() => envelope.refresh()}
          title="Refresh current block from the Zebra node"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px" }}
        >
          <HiOutlineArrowPath className={envelope.refreshing ? "z-spin" : ""} style={{ fontSize: 16 }} />
          <span>{envelope.refreshing ? "Fetching..." : "Refresh Block"}</span>
        </button>
      </div>

      <ZDemoBanner meta={envelope.meta} />
      <ZErrorNote error={envelope.error} meta={envelope.meta} />

      {/* Search Bar */}
      <div className="z-card" style={{ marginBottom: 20 }}>
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: 1, minWidth: 260 }}>
            <HiOutlineMagnifyingGlass
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 16,
                color: "var(--z-text-faint)",
              }}
            />
            <input
              type="text"
              className="z-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Block Height (#20491), Block Hash (00000000...), or TxID..."
              style={{ paddingLeft: 36 }}
            />
          </div>
          <button type="submit" className="z-btn z-primary" style={{ padding: "8px 18px" }}>
            Search
          </button>
          <button
            type="button"
            className="z-btn"
            onClick={() => {
              setSearchQuery("");
              setActiveQuery("");
              router.push("/explorer");
            }}
          >
            Latest Tip
          </button>
        </form>

        {/* Quick jump pills */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
          <span className="z-label" style={{ fontSize: 11, marginRight: 4 }}>Quick Jumps:</span>
          {QUICK_JUMPS.map((jump) => (
            <button
              key={jump.height}
              type="button"
              className="z-btn z-btn-sm"
              onClick={() => handleQuickJump(jump.height)}
              style={{ fontSize: 11.5, padding: "3px 8px" }}
            >
              {jump.label}
            </button>
          ))}
        </div>
      </div>

      {/* If Transaction Detail Result */}
      {isTxResult && data?.tx ? (
        <div className="z-stack" style={{ gap: 16 }}>
          <ZCard
            title={`Transaction ${data.tx.txid || data.tx.hash || ""}`}
            aside={
              <button
                type="button"
                className="z-btn z-btn-sm"
                onClick={() => {
                  const id = data.tx.txid || data.tx.hash || "";
                  handleCopy(id, id);
                }}
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                {copiedId === (data.tx.txid || data.tx.hash) ? <HiCheck style={{ color: "var(--z-good)" }} /> : <HiOutlineDocumentDuplicate />}
                <span>{copiedId === (data.tx.txid || data.tx.hash) ? "Copied" : "Copy TxID"}</span>
              </button>
            }
            meta={envelope.meta}
          >
            <div className="z-grid" style={{ marginBottom: 16 }}>
              <ZStat label="Tx Type" value={
                <ZBadge tone={data.classified.klass === "fully-shielded" ? "ok" : data.classified.klass === "shielding" || data.classified.klass === "deshielding" ? "accent" : undefined}>
                  {TX_CLASS_LABELS[data.classified.klass]}
                </ZBadge>
              } />
              <ZStat label="Transparent Inputs" value={data.classified.transparentInputs} small />
              <ZStat label="Transparent Outputs" value={data.classified.transparentOutputs} small />
              <ZStat label="Shielded Components" value={data.classified.shieldedComponents} small accent />
            </div>

            {data.classified.uses.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div className="z-label" style={{ marginBottom: 6 }}>Shielded Pool Operations</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {data.classified.uses.map((use, i) => (
                    <div key={i} className="z-badge z-ok" style={{ padding: "4px 10px" }}>
                      <span className="z-legend-swatch" style={{ background: poolColor(use.pool), marginRight: 6 }} />
                      <strong>{use.pool.toUpperCase()}</strong>: {use.components} {use.shape}s
                      {use.valueBalanceZec !== null ? ` (${formatDelta(use.valueBalanceZec, 4)} ZEC)` : ""}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="z-label" style={{ marginBottom: 6 }}>Raw Transaction Payload</div>
            <ZJsonView value={data.tx} maxHeight={380} />
          </ZCard>
        </div>
      ) : block ? (
        /* Block Detail Result */
        <div className="z-stack" style={{ gap: 20 }}>
          {/* Header Card */}
          <ZCard
            title={`Block #${formatInt(block.height)}`}
            aside={
              <div className="z-row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="z-btn z-btn-sm"
                  onClick={handlePrevBlock}
                  disabled={block.height <= 0}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <HiOutlineArrowLeft />
                  <span>#{block.height - 1}</span>
                </button>
                <button
                  type="button"
                  className="z-btn z-btn-sm"
                  onClick={handleNextBlock}
                  style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                >
                  <span>#{block.height + 1}</span>
                  <HiOutlineArrowRight />
                </button>
              </div>
            }
            meta={envelope.meta}
            span
          >
            <div className="z-grid" style={{ marginBottom: 18 }}>
              <ZStat label="Block Height" value={`#${formatInt(block.height)}`} accent />
              <ZStat
                label="Timestamp (UTC)"
                value={formatUtcDateTime(block.time)}
                sub={typeof block.time === "number" ? `${formatBlockAge(block.time)} · Epoch ${block.time}` : undefined}
                small
              />
              <ZStat label="Transactions" value={formatInt(txs.length || block.tx?.length || 0)} small />
              <ZStat label="Size on Disk" value={`${formatInt(block.size)} B`} small />
              <ZStat label="Confirmations" value={formatInt(block.confirmations)} small />
              <ZStat label="Difficulty" value={block.difficulty ? block.difficulty.toFixed(2) : "—"} small />
            </div>

            <div className="z-row" style={{ justifyContent: "space-between", alignItems: "center", background: "var(--z-bg-deep)", padding: "8px 12px", borderRadius: "var(--z-radius)", border: "1px solid var(--z-line)" }}>
              <span style={{ fontSize: 12, color: "var(--z-text-faint)", wordBreak: "break-all" }}>
                <strong>Hash:</strong> {block.hash}
              </span>
              <button
                type="button"
                className="z-btn z-btn-sm"
                onClick={() => handleCopy("block-hash", block.hash)}
                style={{ marginLeft: 8, flexShrink: 0 }}
              >
                {copiedId === "block-hash" ? "Copied" : "Copy"}
              </button>
            </div>
          </ZCard>

          {/* Block Value Pools & Deltas */}
          {block.valuePools && block.valuePools.length > 0 && (
            <ZCard title="Shielded Value Pools & Block Delta" span>
              <div className="z-table-wrap">
                <table className="z-table">
                  <thead>
                    <tr>
                      <th>Pool</th>
                      <th className="z-n">Chain Total (ZEC)</th>
                      <th className="z-n">Block Value Delta (valueDelta)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {block.valuePools.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <span
                            className="z-legend-swatch"
                            style={{ background: poolColor(p.id), display: "inline-block", marginRight: 7 }}
                          />
                          <strong>{p.id.toUpperCase()}</strong>
                        </td>
                        <td className="z-n">{formatZec(p.chainValue, 4)} ZEC</td>
                        <td className="z-n" style={{ color: p.valueDelta && p.valueDelta > 0 ? "var(--z-good)" : p.valueDelta && p.valueDelta < 0 ? "var(--z-bad)" : "inherit" }}>
                          {p.valueDelta !== undefined ? formatDelta(p.valueDelta, 4) + " ZEC" : "—"}
                        </td>
                        <td>
                          <ZBadge tone={p.monitored ? "ok" : undefined}>
                            {p.monitored ? "Monitored" : "Inactive"}
                          </ZBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ZCard>
          )}

          {/* Transactions List */}
          <ZCard title={`Transactions in Block (${txs.length})`} span>
            {txs.length === 0 ? (
              <p className="z-card-note">No transactions recorded in this block.</p>
            ) : (
              <div className="z-stack" style={{ gap: 10 }}>
                {txs.map((txItem, index) => {
                  const isSelected = selectedTx === txItem.txid;
                  return (
                    <div
                      key={txItem.txid || index}
                      style={{
                        border: "1px solid var(--z-line)",
                        borderRadius: "var(--z-radius)",
                        background: "var(--z-panel-2)",
                        padding: "12px 14px",
                      }}
                    >
                      <div className="z-row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
                        <div className="z-row" style={{ gap: 8 }}>
                          <ZBadge tone={txItem.klass === "coinbase" ? "accent" : txItem.klass === "fully-shielded" ? "ok" : undefined}>
                            {TX_CLASS_LABELS[txItem.klass]}
                          </ZBadge>
                          <code style={{ fontSize: 12, color: "var(--z-amber)" }}>
                            {txItem.txid ? `${txItem.txid.slice(0, 16)}...${txItem.txid.slice(-16)}` : `Tx #${index}`}
                          </code>
                        </div>
                        <div className="z-row" style={{ gap: 6 }}>
                          <button
                            type="button"
                            className="z-btn z-btn-sm"
                            onClick={() => txItem.txid && handleCopy(txItem.txid, txItem.txid)}
                            title="Copy TxID"
                          >
                            {copiedId === txItem.txid ? "Copied" : "Copy TxID"}
                          </button>
                          <button
                            type="button"
                            className="z-btn z-btn-sm"
                            onClick={() => setSelectedTx(isSelected ? null : txItem.txid)}
                          >
                            {isSelected ? "Hide JSON" : "View JSON"}
                          </button>
                        </div>
                      </div>

                      <div className="z-row" style={{ fontSize: 12, color: "var(--z-text-dim)", gap: 16, flexWrap: "wrap" }}>
                        <span>Transparent: {txItem.transparentInputs} in / {txItem.transparentOutputs} out</span>
                        <span>Shielded Components: <strong style={{ color: "var(--z-text)" }}>{txItem.shieldedComponents}</strong></span>
                        {txItem.pools.length > 0 && (
                          <span>Pools: {txItem.pools.map((p) => p.toUpperCase()).join(", ")}</span>
                        )}
                      </div>

                      {isSelected && (
                        <div style={{ marginTop: 12, borderTop: "1px solid var(--z-line)", paddingTop: 10 }}>
                          <ZJsonView value={txItem.raw} maxHeight={300} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </ZCard>

          {/* Raw Block JSON */}
          <ZCard title="Raw Block JSON from Zebra Node" span>
            <ZJsonView value={block} maxHeight={340} />
          </ZCard>
        </div>
      ) : null}
    </>
  );
}
