/**
 * Privacy mix.
 *
 * For each transaction in a window of blocks: does it use shielded components,
 * and is value entering the shielded set, leaving it, or staying inside?
 *
 * The classification is *structural* — derived from which component containers a
 * transaction actually has, not from a field the node conveniently labels. That
 * matters for the same reason it matters in supply.ts: it is checkable. A
 * transaction with transparent inputs and shielded outputs and no transparent
 * outputs is shielding, and that is true by construction rather than by our say-so.
 *
 * `detectShieldedComponents()` is the part written for the future. Zcash has
 * shipped three different shielded-component shapes so far (Sprout joinsplits,
 * Sapling spend/output pairs, Orchard actions) and Ironwood arrived after this
 * code's knowledge cutoff. So the detector recognises the *shapes* rather than a
 * list of pool names, and reports any pool it found but does not recognise, so
 * the UI can say so out loud instead of undercounting in silence.
 */

import type { Block, RawTransaction } from "../rpc/types";
import { titleCasePoolId } from "./format";

export type ShieldedShape = "joinsplit" | "spend-output" | "action";

export type ShieldedUse = {
  pool: string;
  shape: ShieldedShape;
  /** Joinsplits, spend+output pairs, or actions — whichever this pool uses. */
  components: number;
  /**
   * Net value the node reports moving between this pool and the transparent
   * pool, where available. Positive means value left the pool. Supporting
   * evidence only; classification does not depend on it.
   */
  valueBalanceZec: number | null;
  /** False when the pool was found by shape but its name is unknown to us. */
  recognised: boolean;
};

/** Pools whose names we can label. Detection never depends on this list. */
const KNOWN_POOLS = new Set(["sprout", "sapling", "orchard", "ironwood", "tachyon"]);

function countArray(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function readValueBalance(container: Record<string, unknown>): number | null {
  const zat = container.valueBalanceZat;
  if (typeof zat === "number") return zat / 100_000_000;
  const zec = container.valueBalance;
  return typeof zec === "number" ? zec : null;
}

/**
 * Find every shielded pool a transaction touches, by shape.
 *
 * Three shapes, in the order Zcash introduced them:
 *
 *   joinsplit     `vjoinsplit: []`                        — Sprout
 *   spend-output  `vShieldedSpend: []`, `vShieldedOutput`  — Sapling
 *   action        `<pool>: { actions: [] }`                — Orchard, and the
 *                                                            shape every pool
 *                                                            since has used
 *
 * The third rule is the forward-compatible one: any object-valued field carrying
 * an `actions` array is treated as a shielded pool named after its key. If
 * Ironwood serialises as `ironwood: { actions: [...] }` — the shape Orchard
 * established — it is counted correctly by code written before it existed.
 */
export function detectShieldedComponents(tx: RawTransaction): ShieldedUse[] {
  const uses: ShieldedUse[] = [];

  // Sprout.
  const joinsplits = countArray(tx.vjoinsplit);
  if (joinsplits > 0) {
    uses.push({
      pool: "sprout",
      shape: "joinsplit",
      components: joinsplits,
      valueBalanceZec: null,
      recognised: true,
    });
  }

  // Sapling. Its value balance sits on the transaction itself, not in a
  // sub-object, because Sapling predates the per-pool container convention.
  const saplingSpends = countArray(tx.vShieldedSpend);
  const saplingOutputs = countArray(tx.vShieldedOutput);
  if (saplingSpends + saplingOutputs > 0) {
    uses.push({
      pool: "sapling",
      shape: "spend-output",
      components: saplingSpends + saplingOutputs,
      valueBalanceZec: readValueBalance(tx as Record<string, unknown>),
      recognised: true,
    });
  }

  // Action-based pools: Orchard, and anything shaped like it.
  for (const [key, value] of Object.entries(tx)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const container = value as Record<string, unknown>;
    const actions = countArray(container.actions);
    if (actions === 0) continue;

    const pool = key.toLowerCase();
    uses.push({
      pool,
      shape: "action",
      components: actions,
      valueBalanceZec: readValueBalance(container),
      recognised: KNOWN_POOLS.has(pool),
    });
  }

  // Hypothetical future spend/output pools, e.g. `vIronwoodSpend`. Costs four
  // lines and means an unfamiliar pool is counted rather than missed.
  for (const [key, value] of Object.entries(tx)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    const match = /^v([A-Za-z]+?)(Spend|Output)s?$/.exec(key);
    if (!match) continue;
    const pool = (match[1] ?? "").toLowerCase();
    if (!pool || pool === "shielded" || pool === "joinsplit") continue; // already handled
    const existing = uses.find((use) => use.pool === pool);
    if (existing) existing.components += value.length;
    else
      uses.push({
        pool,
        shape: "spend-output",
        components: value.length,
        valueBalanceZec: null,
        recognised: KNOWN_POOLS.has(pool),
      });
  }

  return uses;
}

export type TxClass =
  | "coinbase"
  | "transparent"
  | "shielding"
  | "deshielding"
  | "fully-shielded"
  | "mixed";

export const TX_CLASS_LABELS: Record<TxClass, string> = {
  coinbase: "Coinbase",
  transparent: "Transparent only",
  shielding: "Shielding (in)",
  deshielding: "Deshielding (out)",
  "fully-shielded": "Fully shielded",
  mixed: "Mixed",
};

export type ClassifiedTx = {
  txid: string | null;
  klass: TxClass;
  transparentInputs: number;
  transparentOutputs: number;
  shieldedComponents: number;
  pools: string[];
  uses: ShieldedUse[];
};

/**
 * Classify one transaction.
 *
 * Coinbase is its own class rather than being lumped in with transparent. Every
 * block has exactly one, so folding it into the transparent bucket would put a
 * floor under the transparent share and make a fully-shielded block look mixed.
 * Note that since Heartwood a coinbase may pay directly to a shielded address,
 * which is why the coinbase branch still records its shielded components.
 */
export function classifyTx(tx: RawTransaction): ClassifiedTx {
  const vin = Array.isArray(tx.vin) ? tx.vin : [];
  const vout = Array.isArray(tx.vout) ? tx.vout : [];

  const isCoinbase = vin.some((input) => typeof input?.coinbase === "string");
  const transparentInputs = vin.filter((input) => typeof input?.coinbase !== "string").length;
  const transparentOutputs = vout.length;

  const uses = detectShieldedComponents(tx);
  const shieldedComponents = uses.reduce((total, use) => total + use.components, 0);
  const hasShielded = shieldedComponents > 0;

  let klass: TxClass;
  if (isCoinbase) klass = "coinbase";
  else if (!hasShielded) klass = "transparent";
  else if (transparentInputs > 0 && transparentOutputs > 0) klass = "mixed";
  else if (transparentInputs > 0) klass = "shielding";
  else if (transparentOutputs > 0) klass = "deshielding";
  else klass = "fully-shielded";

  return {
    txid: typeof tx.txid === "string" ? tx.txid : typeof tx.hash === "string" ? tx.hash : null,
    klass,
    transparentInputs,
    transparentOutputs,
    shieldedComponents,
    pools: uses.map((use) => use.pool),
    uses,
  };
}

export type BlockPrivacy = {
  height: number;
  hash: string;
  time: number | null;
  txCount: number;
  /** Excludes the coinbase — this is the denominator that means something. */
  userTxCount: number;
  counts: Record<TxClass, number>;
  /** Share of user transactions touching any shielded pool. null when the block had none. */
  shieldedShare: number | null;
  txs: ClassifiedTx[];
};

function emptyCounts(): Record<TxClass, number> {
  return {
    coinbase: 0,
    transparent: 0,
    shielding: 0,
    deshielding: 0,
    "fully-shielded": 0,
    mixed: 0,
  };
}

const SHIELDED_CLASSES: TxClass[] = ["shielding", "deshielding", "fully-shielded", "mixed"];

export function summarizeBlockPrivacy(block: Block, txs: RawTransaction[]): BlockPrivacy {
  const classified = txs.map(classifyTx);
  const counts = emptyCounts();
  for (const tx of classified) counts[tx.klass] += 1;

  const userTxCount = classified.length - counts.coinbase;
  const shieldedCount = SHIELDED_CLASSES.reduce((total, klass) => total + counts[klass], 0);

  return {
    height: block.height,
    hash: block.hash,
    time: typeof block.time === "number" ? block.time : null,
    txCount: classified.length,
    userTxCount,
    counts,
    shieldedShare: userTxCount > 0 ? shieldedCount / userTxCount : null,
    txs: classified,
  };
}

export type PoolUsage = {
  pool: string;
  label: string;
  txs: number;
  components: number;
  recognised: boolean;
};

export type PrivacyMix = {
  window: { fromHeight: number; toHeight: number; blocks: number };
  totalTxs: number;
  userTxs: number;
  counts: Record<TxClass, number>;
  /** Share of user transactions using any shielded pool. */
  shieldedShare: number | null;
  /** Share whose value never touched the transparent pool at all. */
  fullyShieldedShare: number | null;
  poolUsage: PoolUsage[];
  /** Per-block series, oldest first — drives the stacked block strip. */
  blocks: BlockPrivacy[];
  /** Pools found by shape whose names we do not recognise. */
  unrecognisedPools: string[];
  narrative: string;
};

/**
 * Aggregate the privacy mix over a window of blocks.
 *
 * Input is pairs, not a flat tx list, because the per-block strip in the UI needs
 * block boundaries and a flat list would have thrown them away.
 */
export function summarizePrivacy(entries: Array<{ block: Block; txs: RawTransaction[] }>): PrivacyMix {
  const blocks = entries
    .filter((entry) => entry?.block && typeof entry.block.height === "number")
    .map((entry) => summarizeBlockPrivacy(entry.block, entry.txs))
    .sort((a, b) => a.height - b.height);

  if (blocks.length === 0) {
    return {
      window: { fromHeight: 0, toHeight: 0, blocks: 0 },
      totalTxs: 0,
      userTxs: 0,
      counts: emptyCounts(),
      shieldedShare: null,
      fullyShieldedShare: null,
      poolUsage: [],
      blocks: [],
      unrecognisedPools: [],
      narrative: "No transaction data available for this window.",
    };
  }

  const counts = emptyCounts();
  let totalTxs = 0;
  const usageByPool = new Map<string, PoolUsage>();

  for (const block of blocks) {
    totalTxs += block.txCount;
    for (const klass of Object.keys(counts) as TxClass[]) {
      counts[klass] += block.counts[klass];
    }
    for (const tx of block.txs) {
      for (const use of tx.uses) {
        const existing = usageByPool.get(use.pool);
        if (existing) {
          existing.txs += 1;
          existing.components += use.components;
        } else {
          usageByPool.set(use.pool, {
            pool: use.pool,
            label: titleCasePoolId(use.pool),
            txs: 1,
            components: use.components,
            recognised: use.recognised,
          });
        }
      }
    }
  }

  const userTxs = totalTxs - counts.coinbase;
  const shieldedCount = SHIELDED_CLASSES.reduce((total, klass) => total + counts[klass], 0);
  const shieldedShare = userTxs > 0 ? shieldedCount / userTxs : null;
  const fullyShieldedShare = userTxs > 0 ? counts["fully-shielded"] / userTxs : null;

  const poolUsage = Array.from(usageByPool.values()).sort((a, b) => b.txs - a.txs);
  const unrecognisedPools = poolUsage.filter((usage) => !usage.recognised).map((usage) => usage.pool);

  const first = blocks[0];
  const last = blocks[blocks.length - 1];

  return {
    window: { fromHeight: first.height, toHeight: last.height, blocks: blocks.length },
    totalTxs,
    userTxs,
    counts,
    shieldedShare,
    fullyShieldedShare,
    poolUsage,
    blocks,
    unrecognisedPools,
    narrative: describeMix({
      blocks: blocks.length,
      userTxs,
      shieldedShare,
      fullyShieldedShare,
      poolUsage,
    }),
  };
}

function describeMix(input: {
  blocks: number;
  userTxs: number;
  shieldedShare: number | null;
  fullyShieldedShare: number | null;
  poolUsage: PoolUsage[];
}): string {
  if (input.userTxs === 0) {
    return `${input.blocks} blocks, no user transactions — coinbase only.`;
  }

  const pct = (share: number | null): string =>
    share === null ? "—" : `${(share * 100).toFixed(1)}%`;

  const busiest = input.poolUsage[0];
  const poolPhrase = busiest
    ? ` Most-used pool: ${busiest.label} (${busiest.txs} transactions).`
    : "";

  return (
    `Across ${input.blocks} blocks and ${input.userTxs} user transactions, ` +
    `${pct(input.shieldedShare)} used a shielded pool and ${pct(input.fullyShieldedShare)} ` +
    `stayed fully shielded end to end.${poolPhrase}`
  );
}
