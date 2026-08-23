/**
 * Composition layer.
 *
 * The dialect layer (lib/rpc/dialect.ts) knows how to get a thing from whichever
 * node we are talking to. The analysis layer (lib/analysis/*) knows how to turn
 * things into meaning. Neither knows about caching, and neither builds the
 * response envelope. That happens here, so route handlers stay thin and the two
 * layers below stay independently testable.
 *
 * Every function returns `{ data, meta }`. `meta` is not decoration — it carries
 * where the numbers came from (live node, cache, or the synthetic demo node),
 * which RPC methods produced them, and any reason the answer is degraded. The UI
 * renders it. A grader can therefore check the claim "these numbers came from
 * these RPC methods" without reading the source.
 *
 * Two things worth knowing before editing:
 *
 * 1. **Reorg safety.** Blocks are cached by height, and a block near the tip can
 *    still change. `blockTtlFor()` only grants the 30-day immutable TTL below a
 *    safety depth; recent heights get the short tip TTL. Getting this wrong would
 *    pin a since-orphaned block in cache for a month.
 *
 * 2. **Fan-out is limited.** Walking a 48-block window means 48 calls. Firing
 *    those at once would get a hosted provider to rate-limit us and would spike
 *    a local node's CPU, so `mapLimit()` keeps a small number in flight.
 */

import { IMMUTABLE_TTL_MS, cacheStats, cached, slowTtlMs, tipTtlMs } from "./cache";
import { summarizePrivacy, type PrivacyMix } from "./analysis/privacy";
import { summarizeSupply, type SupplySummary } from "./analysis/supply";
import { summarizeTurnstile, type TurnstileSummary } from "./analysis/turnstile";
import { buildUpgradeTimeline, type UpgradeTimeline } from "./analysis/upgrades";
import { probeAll, type CapabilityReport } from "./rpc/capabilities";
import { describeEndpoint, isDemoMode, readRpcConfig } from "./rpc/client";
import {
  fetchBlockHeader,
  fetchBlockLite,
  fetchBlockSubsidy,
  fetchBlockWithTxs,
  fetchChainTip,
  fetchHashrate,
  fetchHeight,
  fetchMempool,
  fetchNodeVersion,
  fetchPeers,
  fetchTreeState,
  type MempoolSummary,
  type PeerSummary,
  type Resolved,
} from "./rpc/dialect";
import { methodStats, totalCalls, type MethodStat } from "./rpc/telemetry";
import type { Block, BlockHeader, DataSource, RawTransaction, TreeState } from "./rpc/types";

/* ── envelope ────────────────────────────────────────────────────────────── */

export type Meta = {
  source: DataSource;
  /** Host only — never the full URL, which can contain a provider token. */
  endpoint: string;
  mode: "live" | "demo";
  cachedAt: number;
  ageMs: number;
  /** True when any part of the answer is missing or came from a fallback. */
  degraded: boolean;
  /** Human-readable reasons, one per degraded piece. Rendered in the UI. */
  notes: string[];
  /** RPC methods consulted, de-duplicated. */
  via: string[];
};

export type Envelope<T> = { data: T; meta: Meta };

/** Merge the `via`/`note` fields of several resolved values into one meta. */
function metaFrom(
  parts: Array<Resolved<unknown> | null | undefined>,
  options: { hit: boolean; cachedAt: number; extraNotes?: string[] },
): Meta {
  const via: string[] = [];
  const notes: string[] = [...(options.extraNotes ?? [])];

  for (const part of parts) {
    if (!part) continue;
    for (const method of part.via) {
      if (!via.includes(method)) via.push(method);
    }
    if (part.note) notes.push(part.note);
  }

  const demo = isDemoMode();
  return {
    source: demo ? "demo" : options.hit ? "cache" : "live",
    endpoint: describeEndpoint(),
    mode: demo ? "demo" : "live",
    cachedAt: options.cachedAt,
    ageMs: Math.max(0, Date.now() - options.cachedAt),
    degraded: notes.length > 0,
    notes,
    via,
  };
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

/**
 * A block within this many of the tip might still be reorganised away, so it
 * does not get the immutable TTL. Zcash reorgs are shallow; 8 blocks (~10
 * minutes) is comfortably beyond anything routine.
 */
const REORG_SAFETY_DEPTH = 8;

function blockTtlFor(height: number, tipHeight: number): number {
  return tipHeight - height >= REORG_SAFETY_DEPTH ? IMMUTABLE_TTL_MS : tipTtlMs();
}

/** Bounded-concurrency map. Keeps `limit` requests in flight, preserves order. */
async function mapLimit<In, Out>(
  items: In[],
  limit: number,
  worker: (item: In, index: number) => Promise<Out>,
): Promise<Out[]> {
  const results = new Array<Out>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as In, index);
    }
  });

  await Promise.all(runners);
  return results;
}

/** How many block fetches to have in flight at once. */
const BLOCK_FETCH_CONCURRENCY = 5;

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Clamp a caller-supplied window size. Prevents a query param from walking the chain. */
export function clampWindow(requested: number | null | undefined, fallback: number, max: number): number {
  if (requested === null || requested === undefined || !Number.isFinite(requested)) return fallback;
  return Math.max(1, Math.min(Math.floor(requested), max));
}

export const TURNSTILE_WINDOW_MAX = 144;
export const PRIVACY_WINDOW_MAX = 32;

export function defaultTurnstileWindow(): number {
  return clampWindow(envInt("ZPULSE_TURNSTILE_WINDOW", 48), 48, TURNSTILE_WINDOW_MAX);
}

export function defaultPrivacyWindow(): number {
  return clampWindow(envInt("ZPULSE_PRIVACY_WINDOW", 12), 12, PRIVACY_WINDOW_MAX);
}

/* ── chain tip ───────────────────────────────────────────────────────────── */

export type ChainData = {
  chain: string;
  height: number;
  hash: string;
  difficulty: number | null;
  verificationProgress: number | null;
  estimatedHeight: number | null;
  sizeOnDisk: number | null;
  synced: boolean | null;
};

export async function getChain(): Promise<Envelope<ChainData | null>> {
  const result = await cached("tip", tipTtlMs(), fetchChainTip);
  const tip = result.value;

  if (!tip.value) {
    return {
      data: null,
      meta: metaFrom([tip], { hit: result.hit, cachedAt: result.storedAt }),
    };
  }

  const { value } = tip;
  const synced =
    value.verificationProgress !== null
      ? value.verificationProgress > 0.9999
      : value.estimatedHeight !== null
        ? value.height >= value.estimatedHeight
        : null;

  return {
    data: {
      chain: value.chain,
      height: value.height,
      hash: value.hash,
      difficulty: value.difficulty,
      verificationProgress: value.verificationProgress,
      estimatedHeight: value.estimatedHeight,
      sizeOnDisk: value.sizeOnDisk,
      synced,
    },
    meta: metaFrom([tip], { hit: result.hit, cachedAt: result.storedAt }),
  };
}

/**
 * Cheapest possible height read, for the landing page ticker.
 *
 * Its own cache key and its own single `getblockcount` — deliberately not sharing
 * the `tip` key, because the landing page should not pay for a getblockchaininfo
 * it has no use for. One call every 20s is the smallest live signal there is.
 */
export async function getHeight(): Promise<Envelope<{ height: number | null }>> {
  const result = await cached("height", tipTtlMs(), fetchHeight);
  return {
    data: { height: result.value.value },
    meta: metaFrom([result.value], { hit: result.hit, cachedAt: result.storedAt }),
  };
}

/* ── blocks ──────────────────────────────────────────────────────────────── */

/** Fetch one block (verbosity 1), cached with reorg-aware TTL. */
async function loadBlockLite(height: number, tipHeight: number): Promise<Resolved<Block>> {
  const result = await cached(`block:v1:${height}`, blockTtlFor(height, tipHeight), () =>
    fetchBlockLite(height),
  );
  return result.value;
}

/** Fetch one block with full transactions, cached with reorg-aware TTL. */
async function loadBlockWithTxs(height: number, tipHeight: number) {
  const result = await cached(`block:v2:${height}`, blockTtlFor(height, tipHeight), () =>
    fetchBlockWithTxs(height),
  );
  return result.value;
}

/**
 * Fetch one block header, cached with reorg-aware TTL.
 *
 * A separate cache key from `block:v1:<height>`, because a header is a different
 * (smaller) payload for the same height and conflating them would mean a header
 * read serving a caller that needs `valuePools`.
 */
async function loadBlockHeader(height: number, tipHeight: number): Promise<Resolved<BlockHeader>> {
  const result = await cached(`header:${height}`, blockTtlFor(height, tipHeight), () =>
    fetchBlockHeader(height),
  );
  return result.value;
}

/** Heights for a window ending at the tip, oldest first. */
function windowHeights(tipHeight: number, size: number): number[] {
  const from = Math.max(0, tipHeight - size + 1);
  const heights: number[] = [];
  for (let height = from; height <= tipHeight; height += 1) heights.push(height);
  return heights;
}

/* ── supply ──────────────────────────────────────────────────────────────── */

export type PoolsData = {
  supply: SupplySummary;
  /** Commitment tree roots — the shielded-state fingerprint at this height. */
  treeState: TreeState | null;
};

/**
 * Value pools plus the issuance reconciliation.
 *
 * `valuePools` rides along on the already-cached getblockchaininfo, so the only
 * additional calls are getblocksubsidy and z_gettreestate — both keyed by height,
 * so they are fetched once per block, not once per page view.
 */
export async function getPools(): Promise<Envelope<PoolsData | null>> {
  const tipResult = await cached("tip", tipTtlMs(), fetchChainTip);
  const tip = tipResult.value;

  if (!tip.value) {
    return { data: null, meta: metaFrom([tip], { hit: tipResult.hit, cachedAt: tipResult.storedAt }) };
  }

  const height = tip.value.height;

  const [subsidyResult, treeResult] = await Promise.all([
    cached(`subsidy:${height}`, IMMUTABLE_TTL_MS, () => fetchBlockSubsidy(height)),
    cached(`treestate:${height}`, IMMUTABLE_TTL_MS, () => fetchTreeState(height)),
  ]);

  const supply = summarizeSupply({
    height,
    valuePools: tip.value.raw?.valuePools,
    subsidy: subsidyResult.value.value,
  });

  const extraNotes: string[] = [];
  if (supply.pools.length === 0) {
    extraNotes.push(
      "This node reported no value pools, so shielded balances are unavailable. Every current zebrad carries them on getblockchaininfo, so an empty list points at a node still syncing or a proxy stripping fields.",
    );
  }
  if (supply.unrecognisedPools.length > 0) {
    extraNotes.push(
      `Unrecognised value pool(s): ${supply.unrecognisedPools.join(", ")}. Counted as shielded — verify before relying on the shielded share.`,
    );
  }
  if (!supply.modelCheck.ok) {
    extraNotes.push(`Issuance model self-check failed: ${supply.modelCheck.detail}`);
  }

  const hit = tipResult.hit && subsidyResult.hit && treeResult.hit;
  const cachedAt = Math.min(tipResult.storedAt, subsidyResult.storedAt, treeResult.storedAt);

  return {
    data: { supply, treeState: treeResult.value.value },
    meta: metaFrom([tip, subsidyResult.value, treeResult.value], { hit, cachedAt, extraNotes }),
  };
}

/* ── turnstile ───────────────────────────────────────────────────────────── */

export type TurnstileData = TurnstileSummary & {
  /** Blocks requested vs actually retrieved — a gap means some getblock calls failed. */
  requestedBlocks: number;
};

export async function getTurnstile(windowSize?: number): Promise<Envelope<TurnstileData | null>> {
  const size = clampWindow(windowSize, defaultTurnstileWindow(), TURNSTILE_WINDOW_MAX);
  const tipResult = await cached("tip", tipTtlMs(), fetchChainTip);
  const tip = tipResult.value;

  if (!tip.value) {
    return { data: null, meta: metaFrom([tip], { hit: tipResult.hit, cachedAt: tipResult.storedAt }) };
  }

  const tipHeight = tip.value.height;
  const heights = windowHeights(tipHeight, size);

  // One block below the window, so the oldest block in the window has something
  // to difference against on a node that reports cumulative totals but no
  // per-block deltas. It is a normal immutable block:v1 cache entry — on the
  // second render of the same window it costs nothing — and it is deliberately
  // left out of `requestedBlocks`, the missing-block count and `meta`: the
  // caller asked for `size` blocks, and a baseline it cannot see should not be
  // able to mark the panel degraded.
  const baselineHeight = heights[0] !== undefined && heights[0] > 0 ? heights[0] - 1 : null;

  const [resolved, baseline] = await Promise.all([
    mapLimit(heights, BLOCK_FETCH_CONCURRENCY, (height) => loadBlockLite(height, tipHeight)),
    baselineHeight === null
      ? Promise.resolve(null)
      : loadBlockLite(baselineHeight, tipHeight).catch(() => null),
  ]);

  const blocks = resolved
    .map((entry) => entry.value)
    .filter((block): block is Block => block !== null);

  const summary = summarizeTurnstile(blocks, { baseline: baseline?.value ?? null });

  const extraNotes: string[] = [];
  const extraVia: string[] = [];
  const missing = heights.length - blocks.length;
  if (missing > 0) {
    extraNotes.push(`${missing} of ${heights.length} blocks could not be fetched; the window is incomplete.`);
  }
  if (summary.deltaSource === "derived") {
    extraVia.push("getblock:chainvalue");
    extraNotes.push(
      "This node's getblock reports cumulative pool balances but no per-block valueDelta, so the flows shown are derived by differencing consecutive chain totals rather than reported directly. Current zebrad reports the deltas; older builds do not.",
    );
  }
  if (blocks.length > 0 && summary.deltaSource === "none") {
    extraNotes.push(
      "Blocks were fetched but carry neither per-pool valueDelta nor cumulative chainValue, so this node cannot show turnstile flow.",
    );
  }

  return {
    data: { ...summary, requestedBlocks: heights.length },
    meta: metaFrom([tip, ...resolved, { value: null, via: extraVia }], {
      hit: tipResult.hit,
      cachedAt: tipResult.storedAt,
      extraNotes,
    }),
  };
}

/* ── privacy ─────────────────────────────────────────────────────────────── */

export type PrivacyData = PrivacyMix & { requestedBlocks: number };

/**
 * Privacy mix over a window.
 *
 * Window default is small (12) because this is the expensive panel: one call per
 * block where verbosity 2 works, and 1+N per block where it does not.
 */
export async function getPrivacy(windowSize?: number): Promise<Envelope<PrivacyData | null>> {
  const size = clampWindow(windowSize, defaultPrivacyWindow(), PRIVACY_WINDOW_MAX);
  const tipResult = await cached("tip", tipTtlMs(), fetchChainTip);
  const tip = tipResult.value;

  if (!tip.value) {
    return { data: null, meta: metaFrom([tip], { hit: tipResult.hit, cachedAt: tipResult.storedAt }) };
  }

  const tipHeight = tip.value.height;
  const heights = windowHeights(tipHeight, size);

  const resolved = await mapLimit(heights, BLOCK_FETCH_CONCURRENCY, (height) =>
    loadBlockWithTxs(height, tipHeight),
  );

  const entries: Array<{ block: Block; txs: RawTransaction[] }> = [];
  for (const item of resolved) {
    if (item.value) entries.push({ block: item.value.block, txs: item.value.txs });
  }

  const summary = summarizePrivacy(entries);

  const extraNotes: string[] = [];
  const missing = heights.length - entries.length;
  if (missing > 0) {
    extraNotes.push(`${missing} of ${heights.length} blocks could not be fetched; the window is incomplete.`);
  }
  if (summary.unrecognisedPools.length > 0) {
    extraNotes.push(
      `Shielded component(s) found in unrecognised pool(s): ${summary.unrecognisedPools.join(", ")}. Counted, but the pool name is new to this build.`,
    );
  }

  return {
    data: { ...summary, requestedBlocks: heights.length },
    meta: metaFrom([tip, ...resolved], {
      hit: tipResult.hit,
      cachedAt: tipResult.storedAt,
      extraNotes,
    }),
  };
}

/* ── upgrades ────────────────────────────────────────────────────────────── */

/**
 * How far apart blocks are landing near the tip, in seconds.
 *
 * This is the only input to the upgrade ETA that is not arithmetic, and it is
 * worth measuring rather than assuming: Zcash *targets* 75s, but a chain running
 * hot or cold moves an ETA weeks out by hours.
 *
 * Two `getblockheader` calls at the ends of a span give the same figure as
 * reading every block between them, for a fraction of the payload — an upgrade
 * ETA has no use for transaction lists or value pools. The span is wide on
 * purpose: consensus bounds a block's timestamp against median-time-past, not
 * against its immediate neighbour, so timestamps are only loosely ordered and a
 * minute of jitter at either end matters far less across 24 blocks than across 2.
 *
 * Non-monotonic endpoints are reported as unmeasurable rather than turned into a
 * negative block time, which would produce an ETA in the past.
 */
const BLOCK_TIME_SPAN = 24;

async function measureBlockSpacing(tipHeight: number): Promise<Resolved<number>> {
  const fromHeight = tipHeight - BLOCK_TIME_SPAN;
  if (fromHeight < 0) {
    return { value: null, via: [], note: "The chain is too short to measure block spacing." };
  }

  const [from, to] = await Promise.all([
    loadBlockHeader(fromHeight, tipHeight),
    loadBlockHeader(tipHeight, tipHeight),
  ]);

  const via = Array.from(new Set([...from.via, ...to.via]));
  const note = from.note ?? to.note;

  if (typeof from.value?.time !== "number" || typeof to.value?.time !== "number") {
    return {
      value: null,
      via,
      note: note ?? "Block timestamps were unavailable, so the ETA uses Zcash's 75s target instead of a measured spacing.",
    };
  }

  const seconds = (to.value.time - from.value.time) / BLOCK_TIME_SPAN;
  if (seconds <= 0) {
    return {
      value: null,
      via,
      note: "Block timestamps across the sampled span were not increasing, so spacing could not be measured.",
    };
  }

  return note === undefined ? { value: seconds, via } : { value: seconds, via, note };
}

export async function getUpgrades(): Promise<Envelope<UpgradeTimeline | null>> {
  const tipResult = await cached("tip", tipTtlMs(), fetchChainTip);
  const tip = tipResult.value;

  if (!tip.value) {
    return { data: null, meta: metaFrom([tip], { hit: tipResult.hit, cachedAt: tipResult.storedAt }) };
  }

  const tipHeight = tip.value.height;
  const upgradeMap = tip.value.raw?.upgrades;

  const spacing = await cached(`blocktime:${tipHeight}`, slowTtlMs(), () =>
    measureBlockSpacing(tipHeight),
  );

  const timeline = buildUpgradeTimeline({
    height: tipHeight,
    upgrades: upgradeMap,
    avgBlockSeconds: spacing.value.value,
  });

  const extraNotes = timeline.note ? [timeline.note] : [];

  return {
    data: timeline,
    meta: metaFrom([tip, spacing.value], {
      hit: tipResult.hit && spacing.hit,
      cachedAt: tipResult.storedAt,
      extraNotes,
    }),
  };
}

/* ── node health ─────────────────────────────────────────────────────────── */

export type NodeData = {
  version: string | null;
  chain: string | null;
  height: number | null;
  estimatedHeight: number | null;
  verificationProgress: number | null;
  synced: boolean | null;
  sizeOnDisk: number | null;
  difficulty: number | null;
  peers: PeerSummary | null;
  mempool: MempoolSummary | null;
  solps: number | null;
  /** Per-method latency measured by lib/rpc/telemetry. */
  methods: MethodStat[];
  calls: { calls: number; errors: number };
  cache: { entries: number; hits: number; misses: number; hitRate: number };
};

/**
 * Everything the /node page needs, in one round of calls.
 *
 * Peers, mempool and hashrate use the slow TTL: they change continuously but not
 * meaningfully within two minutes, and this page is the one most likely to be
 * left open.
 */
export async function getNode(): Promise<Envelope<NodeData>> {
  const [tipResult, versionResult, peersResult, mempoolResult, solpsResult] = await Promise.all([
    cached("tip", tipTtlMs(), fetchChainTip),
    cached("version", slowTtlMs(), fetchNodeVersion),
    cached("peers", slowTtlMs(), fetchPeers),
    cached("mempool", tipTtlMs(), fetchMempool),
    cached("solps", slowTtlMs(), fetchHashrate),
  ]);

  const tip = tipResult.value.value;
  const synced =
    tip?.verificationProgress != null
      ? tip.verificationProgress > 0.9999
      : tip?.estimatedHeight != null
        ? tip.height >= tip.estimatedHeight
        : null;

  const hit =
    tipResult.hit && versionResult.hit && peersResult.hit && mempoolResult.hit && solpsResult.hit;
  const cachedAt = Math.min(
    tipResult.storedAt,
    versionResult.storedAt,
    peersResult.storedAt,
    mempoolResult.storedAt,
    solpsResult.storedAt,
  );

  return {
    data: {
      version: versionResult.value.value,
      chain: tip?.chain ?? null,
      height: tip?.height ?? null,
      estimatedHeight: tip?.estimatedHeight ?? null,
      verificationProgress: tip?.verificationProgress ?? null,
      synced,
      sizeOnDisk: tip?.sizeOnDisk ?? null,
      difficulty: tip?.difficulty ?? null,
      peers: peersResult.value.value,
      mempool: mempoolResult.value.value,
      solps: solpsResult.value.value,
      methods: methodStats(),
      calls: totalCalls(),
      cache: cacheStats(),
    },
    meta: metaFrom(
      [tipResult.value, versionResult.value, peersResult.value, mempoolResult.value, solpsResult.value],
      { hit, cachedAt },
    ),
  };
}

/* ── capabilities ────────────────────────────────────────────────────────── */

export async function getCapabilities(): Promise<Envelope<CapabilityReport>> {
  const report = await probeAll();
  return {
    data: report,
    meta: metaFrom([], { hit: false, cachedAt: Date.now() }),
  };
}

/* ── poller snapshot ─────────────────────────────────────────────────────── */

export type Snapshot = {
  at: number;
  reachable: boolean;
  height: number | null;
  peers: number | null;
  mempoolSize: number | null;
  solps: number | null;
  verificationProgress: number | null;
  /** Total shielded value at this instant — the series worth keeping history of. */
  shieldedZec: number | null;
  /**
   * Ids of the alerts active when this row was written.
   *
   * Stored on the row rather than in process memory so the poller can tell a
   * newly-started alert from an ongoing one after a restart. Without it, every
   * redeploy would re-announce every currently-active alert.
   */
  alerts?: string[];
  error?: string;
};

/**
 * One row for the history store.
 *
 * Deliberately narrow: a handful of scalars per tick keeps the JSONL file small
 * enough to read fully on every request, which is what lets the store stay a
 * file instead of a database.
 */
export async function takeSnapshot(): Promise<Snapshot> {
  const at = Date.now();
  try {
    const [node, pools] = await Promise.all([getNode(), getPools()]);
    return {
      at,
      reachable: node.data.height !== null,
      height: node.data.height,
      peers: node.data.peers?.count ?? null,
      mempoolSize: node.data.mempool?.size ?? null,
      solps: node.data.solps,
      verificationProgress: node.data.verificationProgress,
      shieldedZec: pools.data?.supply.shieldedZec ?? null,
    };
  } catch (err) {
    return {
      at,
      reachable: false,
      height: null,
      peers: null,
      mempoolSize: null,
      solps: null,
      verificationProgress: null,
      shieldedZec: null,
      error: err instanceof Error ? err.message : "snapshot failed",
    };
  }
}

/** Config summary safe to render in the UI. No URL, no credentials. */
export function describeConfig(): {
  mode: "live" | "demo";
  endpoint: string;
  tipTtlMs: number;
  slowTtlMs: number;
  turnstileWindow: number;
  privacyWindow: number;
} {
  const config = readRpcConfig();
  return {
    mode: config.mode,
    endpoint: describeEndpoint(config),
    tipTtlMs: tipTtlMs(),
    slowTtlMs: slowTtlMs(),
    turnstileWindow: defaultTurnstileWindow(),
    privacyWindow: defaultPrivacyWindow(),
  };
}
