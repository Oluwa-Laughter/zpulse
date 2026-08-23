/**
 * The turnstile.
 *
 * Zcash's shielded pools are not interchangeable. When a new pool activates, the
 * previous one becomes exit-only: value may leave but not enter, so the old pool
 * drains and the new one fills. The workshop deck describes exactly this for
 * Ironwood's activation — Orchard is now the pool being drained.
 *
 * `getblock` reports, per block, a `valueDelta` for each pool. Summing those
 * deltas across a window of blocks makes the migration directly visible: one
 * pool trending negative, another trending positive, roughly offsetting. That is
 * the turnstile, measured rather than asserted.
 *
 * The reason this is affordable: it is **one RPC call per block**, and blocks are
 * immutable so each call is made once ever. A 48-block window costs 48 calls the
 * first time and nothing thereafter.
 *
 * No pool name appears in the logic below. Pools are whatever the node reported,
 * and a pool that ships next year charts itself.
 */

import type { Block } from "../rpc/types";
import { ZATOSHI_PER_ZEC, formatZec, titleCasePoolId } from "./format";

/** One block's worth of pool movement. */
export type TurnstileSample = {
  height: number;
  hash: string;
  time: number | null;
  /** Pool id → change in ZEC caused by this block. Positive means value entered. */
  deltas: Record<string, number>;
};

export type FlowDirection = "draining" | "filling" | "flat";

export type PoolFlow = {
  id: string;
  label: string;
  /** Net change across the window. Negative means the pool lost value. */
  netZec: number;
  /** Total value that entered across the window. */
  inflowZec: number;
  /** Total value that left, as a positive magnitude. */
  outflowZec: number;
  /** How many blocks in the window moved this pool at all. */
  activeBlocks: number;
  /** Per-block deltas, oldest first — drives the bar chart. */
  series: number[];
  /** Running total, oldest first — drives the cumulative line. */
  cumulative: number[];
  direction: FlowDirection;
};

export type TurnstileSummary = {
  window: { fromHeight: number; toHeight: number; blocks: number };
  /** Wall-clock span of the window, from block timestamps. */
  timespanSeconds: number | null;
  /** Observed average spacing. Zcash targets 75s; this is the measured figure. */
  avgBlockSeconds: number | null;
  flows: PoolFlow[];
  /** Net movement across all pools combined — positive means pools grew overall. */
  netAllPoolsZec: number;
  /** Plain-language reading of what the window shows. */
  narrative: string;
  /** Pool ids seen anywhere in the window, stable order for consistent colours. */
  poolIds: string[];
};

/**
 * Below this, a net movement is noise rather than a trend. Chosen at 1 ZEC
 * because per-block shielded flow on Zcash is routinely tens to hundreds of ZEC,
 * so a sub-1-ZEC net over dozens of blocks says "flat", not "draining".
 */
const DIRECTION_THRESHOLD_ZEC = 1;

/** Extract per-pool deltas from a block, preferring the exact integer field. */
export function sampleFromBlock(block: Block): TurnstileSample {
  const deltas: Record<string, number> = {};

  for (const pool of block.valuePools ?? []) {
    const id = pool.id;
    if (!id) continue;
    if (typeof pool.valueDeltaZat === "number") {
      deltas[id] = pool.valueDeltaZat / ZATOSHI_PER_ZEC;
    } else if (typeof pool.valueDelta === "number") {
      deltas[id] = pool.valueDelta;
    }
  }

  return {
    height: block.height,
    hash: block.hash,
    time: typeof block.time === "number" ? block.time : null,
    deltas,
  };
}

function directionOf(netZec: number): FlowDirection {
  if (netZec > DIRECTION_THRESHOLD_ZEC) return "filling";
  if (netZec < -DIRECTION_THRESHOLD_ZEC) return "draining";
  return "flat";
}

/**
 * Describe the window in a sentence.
 *
 * Deliberately hedged. A drain and a matching fill are *consistent with*
 * migration through the turnstile, but block deltas alone do not prove that any
 * individual ZEC moved from one pool to the other — a user could equally have
 * deshielded from one pool while someone else shielded into the other. The
 * wording says what was measured and leaves the inference to the reader.
 */
function describeFlows(flows: PoolFlow[], blocks: number): string {
  const moving = flows.filter((flow) => flow.direction !== "flat");
  if (blocks === 0) return "No blocks in the window yet.";
  if (moving.length === 0) {
    return `No pool moved by more than ${DIRECTION_THRESHOLD_ZEC} ZEC across these ${blocks} blocks.`;
  }

  const draining = moving
    .filter((flow) => flow.direction === "draining")
    .sort((a, b) => a.netZec - b.netZec);
  const filling = moving
    .filter((flow) => flow.direction === "filling")
    .sort((a, b) => b.netZec - a.netZec);

  const biggestDrain = draining[0];
  const biggestFill = filling[0];

  if (biggestDrain && biggestFill) {
    const drained = Math.abs(biggestDrain.netZec);
    const filled = biggestFill.netZec;
    const offset = Math.min(drained, filled) / Math.max(drained, filled);
    // Within 15% of offsetting is the pattern a turnstile produces.
    const turnstile = offset > 0.85;
    return turnstile
      ? `${biggestDrain.label} fell ${formatZec(drained)} ZEC while ${biggestFill.label} rose ${formatZec(filled)} ZEC across ${blocks} blocks — the offsetting pattern expected as value migrates through the turnstile.`
      : `${biggestDrain.label} fell ${formatZec(drained)} ZEC and ${biggestFill.label} rose ${formatZec(filled)} ZEC across ${blocks} blocks. The two do not offset, so this window reflects ordinary shielding and deshielding as well as any pool migration.`;
  }

  if (biggestDrain) {
    return `${biggestDrain.label} fell ${formatZec(Math.abs(biggestDrain.netZec))} ZEC across ${blocks} blocks, with no pool gaining materially — net value left the shielded set.`;
  }

  const fill = biggestFill as PoolFlow;
  return `${fill.label} rose ${formatZec(fill.netZec)} ZEC across ${blocks} blocks, with no pool draining materially — net value entered the shielded set.`;
}

/**
 * Build the turnstile view from a window of blocks.
 *
 * Blocks may arrive in any order and may contain gaps (a `getblock` in the
 * window can fail without sinking the panel); they are sorted by height here.
 */
export function summarizeTurnstile(blocks: Block[]): TurnstileSummary {
  const samples = blocks
    .filter((block) => typeof block?.height === "number")
    .map(sampleFromBlock)
    .sort((a, b) => a.height - b.height);

  if (samples.length === 0) {
    return {
      window: { fromHeight: 0, toHeight: 0, blocks: 0 },
      timespanSeconds: null,
      avgBlockSeconds: null,
      flows: [],
      netAllPoolsZec: 0,
      narrative: "No block data available for this window.",
      poolIds: [],
    };
  }

  // Union of pool ids across the window: a pool that moved in only one block
  // still gets a full-length series, zero-filled.
  const poolIds: string[] = [];
  for (const sample of samples) {
    for (const id of Object.keys(sample.deltas)) {
      if (!poolIds.includes(id)) poolIds.push(id);
    }
  }

  const flows: PoolFlow[] = poolIds.map((id) => {
    const series = samples.map((sample) => sample.deltas[id] ?? 0);

    let inflowZec = 0;
    let outflowZec = 0;
    let activeBlocks = 0;
    let running = 0;
    const cumulative: number[] = [];

    for (const delta of series) {
      if (delta > 0) inflowZec += delta;
      else if (delta < 0) outflowZec += -delta;
      if (delta !== 0) activeBlocks += 1;
      running += delta;
      cumulative.push(running);
    }

    const netZec = running;
    return {
      id,
      label: titleCasePoolId(id),
      netZec,
      inflowZec,
      outflowZec,
      activeBlocks,
      series,
      cumulative,
      direction: directionOf(netZec),
    };
  });

  // Largest absolute mover first — the interesting pool leads the chart.
  flows.sort((a, b) => Math.abs(b.netZec) - Math.abs(a.netZec));

  const first = samples[0];
  const last = samples[samples.length - 1];
  const times = samples
    .map((sample) => sample.time)
    .filter((time): time is number => time !== null);

  let timespanSeconds: number | null = null;
  let avgBlockSeconds: number | null = null;
  if (times.length >= 2) {
    timespanSeconds = Math.max(...times) - Math.min(...times);
    // Divide by intervals, not blocks: n timestamps bound n-1 gaps.
    const intervals = times.length - 1;
    if (intervals > 0 && timespanSeconds >= 0) {
      avgBlockSeconds = timespanSeconds / intervals;
    }
  }

  return {
    window: {
      fromHeight: first.height,
      toHeight: last.height,
      blocks: samples.length,
    },
    timespanSeconds,
    avgBlockSeconds,
    flows,
    netAllPoolsZec: flows.reduce((total, flow) => total + flow.netZec, 0),
    narrative: describeFlows(flows, samples.length),
    poolIds,
  };
}
