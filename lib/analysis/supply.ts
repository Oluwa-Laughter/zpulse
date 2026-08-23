/**
 * Supply integrity.
 *
 * The workshop deck's Ironwood slide makes a specific claim: at activation,
 * "users can independently verify the circulating supply by checking active pool
 * balances." This module is that check, done honestly.
 *
 * Honesty matters here because it is easy to fake. A dashboard can print
 * "circulating supply: 16,911,875 ZEC" from a hardcoded constant and nobody can
 * tell. So the numbers are split into three clearly-labelled kinds:
 *
 *   reported  — read straight off the node's `valuePools`. Not our arithmetic.
 *   modelled  — computed here from the consensus issuance schedule (ZIP-208).
 *   derived   — reported minus modelled. Only as trustworthy as both inputs.
 *
 * And the model does not get to grade its own homework. `checkSubsidy()` compares
 * our modelled per-block subsidy against the node's own `getblocksubsidy` at the
 * same height. If they disagree, the panel says so rather than showing a
 * confident wrong number — which is the one outcome worse than showing nothing.
 *
 * Pool identity is never hardcoded. See `classifyPool()`.
 */

import type { BlockSubsidy, ValuePool } from "../rpc/types";
import { ZATOSHI_PER_ZEC, titleCasePoolId } from "./format";

/* ── consensus constants (ZIP-208 and the protocol spec) ─────────────────── */

/** Blocks 1..20,000 ramp the subsidy up from zero. */
const SLOW_START_INTERVAL = 20_000;
/** The ramp is shifted so total slow-start issuance equals 10,000 full blocks. */
const SLOW_START_SHIFT = SLOW_START_INTERVAL / 2;
/** 12.5 ZEC, the pre-Blossom block subsidy. */
const MAX_BLOCK_SUBSIDY_ZAT = 1_250_000_000;
/** 62,500 zatoshi per block of ramp. Exact integer — no rounding to worry about. */
const SLOW_START_RATE_ZAT = MAX_BLOCK_SUBSIDY_ZAT / SLOW_START_INTERVAL;

/** Blossom halved the block target from 150s to 75s. */
const BLOSSOM_ACTIVATION_HEIGHT = 653_600;
/** ...and so the subsidy was halved with it, to keep ZEC/second constant. */
const BLOSSOM_SPACING_RATIO = 2;

const PRE_BLOSSOM_HALVING_INTERVAL = 840_000;
const POST_BLOSSOM_HALVING_INTERVAL = PRE_BLOSSOM_HALVING_INTERVAL * BLOSSOM_SPACING_RATIO;

/**
 * The two halvings that have actually happened, used as a self-test of the
 * formulas below. Both are matters of public record: the first coincided with
 * Canopy in November 2020, the second landed in November 2024.
 */
export const KNOWN_HALVING_HEIGHTS = [1_046_400, 2_726_400] as const;

/**
 * Height at which halving `index` takes effect, for index >= 1.
 *
 * Derived from the halving formula rather than tabulated, so it keeps producing
 * correct answers for halvings that have not happened yet.
 */
export function halvingHeight(index: number): number {
  if (index <= 0) return SLOW_START_SHIFT;
  return (
    BLOSSOM_ACTIVATION_HEIGHT +
    index * POST_BLOSSOM_HALVING_INTERVAL -
    BLOSSOM_SPACING_RATIO * (BLOSSOM_ACTIVATION_HEIGHT - SLOW_START_SHIFT)
  );
}

/**
 * How many halvings have occurred by `height`.
 *
 * Blossom changed the interval mid-flight, so the count is the sum of a
 * pre-Blossom term and a post-Blossom one. Because POST is exactly 2x PRE, the
 * whole thing reduces to one integer division — no floating-point drift at an
 * epoch boundary, which is exactly where a float would bite.
 */
export function halvingIndex(height: number): number {
  if (height < SLOW_START_SHIFT) return 0;
  if (height < BLOSSOM_ACTIVATION_HEIGHT) {
    return Math.floor((height - SLOW_START_SHIFT) / PRE_BLOSSOM_HALVING_INTERVAL);
  }
  const scaled =
    BLOSSOM_SPACING_RATIO * (BLOSSOM_ACTIVATION_HEIGHT - SLOW_START_SHIFT) +
    (height - BLOSSOM_ACTIVATION_HEIGHT);
  return Math.floor(scaled / POST_BLOSSOM_HALVING_INTERVAL);
}

/** Block subsidy in zatoshi at `height`, per consensus rules. */
export function blockSubsidyZat(height: number): number {
  if (height <= 0) return 0;

  // Slow start ramp.
  if (height < SLOW_START_SHIFT) return SLOW_START_RATE_ZAT * height;
  if (height < SLOW_START_INTERVAL) return SLOW_START_RATE_ZAT * (height + 1);

  const divisor = 2 ** halvingIndex(height);
  const spacing = height >= BLOSSOM_ACTIVATION_HEIGHT ? BLOSSOM_SPACING_RATIO : 1;
  return Math.floor(MAX_BLOCK_SUBSIDY_ZAT / (spacing * divisor));
}

/** Total issued during the slow start, for heights 1..min(n, 20000). */
function slowStartIssuanceZat(n: number): number {
  if (n <= 0) return 0;
  const capped = Math.min(n, SLOW_START_INTERVAL - 1);

  // Heights 1..9,999 pay rate*h.
  const firstEnd = Math.min(capped, SLOW_START_SHIFT - 1);
  let total = SLOW_START_RATE_ZAT * ((firstEnd * (firstEnd + 1)) / 2);

  // Heights 10,000..19,999 pay rate*(h+1).
  if (capped >= SLOW_START_SHIFT) {
    const from = SLOW_START_SHIFT + 1;
    const to = capped + 1;
    const sum = (to * (to + 1)) / 2 - (from * (from - 1)) / 2;
    total += SLOW_START_RATE_ZAT * sum;
  }
  return total;
}

/**
 * Cumulative issuance in zatoshi from genesis through `height`, inclusive.
 *
 * Computed as a closed form per epoch rather than a loop over 3.5M blocks —
 * this runs inside a request handler.
 *
 * Caveat worth stating plainly: this is *issuance*, the value consensus created.
 * It is not the same as spendable supply, since it counts unclaimed subsidies
 * and any provably-burned value as issued. The reconciliation panel labels it
 * as modelled for exactly that reason.
 */
export function cumulativeIssuanceZat(height: number): number {
  if (height <= 0) return 0;

  let total = slowStartIssuanceZat(height);
  if (height < SLOW_START_INTERVAL) return total;

  // Flat 12.5 ZEC from the end of the ramp to Blossom.
  const preBlossomEnd = Math.min(height, BLOSSOM_ACTIVATION_HEIGHT - 1);
  if (preBlossomEnd >= SLOW_START_INTERVAL) {
    total += MAX_BLOCK_SUBSIDY_ZAT * (preBlossomEnd - SLOW_START_INTERVAL + 1);
  }
  if (height < BLOSSOM_ACTIVATION_HEIGHT) return total;

  // Then one flat rate per halving epoch. The 64 bound is a safety rail; the
  // subsidy floors to zero long before that.
  for (let index = 0; index < 64; index += 1) {
    const epochStart = index === 0 ? BLOSSOM_ACTIVATION_HEIGHT : halvingHeight(index);
    if (epochStart > height) break;

    const epochEnd = halvingHeight(index + 1) - 1;
    const end = Math.min(height, epochEnd);
    const subsidy = Math.floor(MAX_BLOCK_SUBSIDY_ZAT / (BLOSSOM_SPACING_RATIO * 2 ** index));
    if (subsidy <= 0) break;

    total += subsidy * (end - epochStart + 1);
    if (end === height) break;
  }

  return total;
}

/**
 * Does the model reproduce the halvings that already happened?
 *
 * Surfaced in the UI as a footnote. A self-check that is only ever run in a test
 * file is a self-check nobody sees fail.
 */
export function issuanceModelSelfCheck(): { ok: boolean; detail: string } {
  const failures: string[] = [];
  KNOWN_HALVING_HEIGHTS.forEach((height, offset) => {
    const index = offset + 1;
    if (halvingHeight(index) !== height) {
      failures.push(`halving ${index} modelled at ${halvingHeight(index)}, expected ${height}`);
    }
    if (halvingIndex(height) !== index) {
      failures.push(`halvingIndex(${height}) = ${halvingIndex(height)}, expected ${index}`);
    }
  });

  // 15,750,000 ZEC issued through the last block *before* the second halving —
  // exactly, not approximately. Note the -1: block 2,726,400 is already the
  // first block paying the reduced 1.5625 ZEC subsidy.
  const beforeSecondHalving =
    cumulativeIssuanceZat(KNOWN_HALVING_HEIGHTS[1] - 1) / ZATOSHI_PER_ZEC;
  if (beforeSecondHalving !== 15_750_000) {
    failures.push(
      `issuance through block ${KNOWN_HALVING_HEIGHTS[1] - 1} modelled as ${beforeSecondHalving}, expected exactly 15,750,000`,
    );
  }

  return failures.length === 0
    ? { ok: true, detail: "Model reproduces both historical halvings and the 15.75M ZEC checkpoint." }
    : { ok: false, detail: failures.join("; ") };
}

/* ── pool classification ─────────────────────────────────────────────────── */

/**
 * Pool ids known *not* to be shielded.
 *
 * An allowlist of shielded names would be the wrong shape: it would silently
 * misclassify the next pool Zcash ships as transparent. A denylist of
 * non-shielded names fails the other way — an unrecognised pool is assumed
 * shielded and *flagged as an assumption*, so the UI can say "we think this is
 * shielded but we have not been told" instead of quietly getting it wrong.
 *
 * `lockbox` is here because NU6's deferred development funding accumulates in a
 * value pool that is not a shielded pool.
 */
const NON_SHIELDED_POOL_IDS = new Set(["transparent", "lockbox", "deferred", "deferredpool"]);

/** Pool ids we can describe. Missing entries are fine — the label falls back to the id. */
const POOL_NOTES: Record<string, string> = {
  sprout: "Original shielded pool. Closed to new value; only withdrawals remain.",
  sapling: "Efficient shielded pool, active since 2018.",
  orchard: "Halo 2 shielded pool. Exit-only since Ironwood — value drains toward the new pool.",
  ironwood: "Current shielded pool, activated July 2026. Destination of the Orchard turnstile.",
  tachyon: "Proposed future pool. Present here only if the node reports it.",
  lockbox: "NU6 deferred development funding. Not a shielded pool.",
  transparent: "Unshielded value, visible on-chain like Bitcoin.",
};

export type PoolClassification = "shielded" | "not-shielded" | "assumed-shielded";

export type PoolBalance = {
  id: string;
  label: string;
  classification: PoolClassification;
  shielded: boolean;
  /** True when the id was not recognised — the UI marks these. */
  unrecognised: boolean;
  balanceZec: number | null;
  balanceZat: number | null;
  monitored: boolean;
  note?: string;
};

const KNOWN_SHIELDED_POOL_IDS = new Set(["sprout", "sapling", "orchard", "ironwood", "tachyon"]);

/** Normalise one node-reported pool, without assuming its name is one we know. */
export function classifyPool(pool: ValuePool): PoolBalance {
  const id = (pool.id ?? "").toLowerCase();
  const zat =
    typeof pool.chainValueZat === "number"
      ? pool.chainValueZat
      : typeof pool.chainValue === "number"
        ? Math.round(pool.chainValue * ZATOSHI_PER_ZEC)
        : null;

  let classification: PoolClassification;
  if (NON_SHIELDED_POOL_IDS.has(id)) classification = "not-shielded";
  else if (KNOWN_SHIELDED_POOL_IDS.has(id)) classification = "shielded";
  else classification = "assumed-shielded";

  const note = POOL_NOTES[id];
  return {
    id: pool.id ?? "unknown",
    label: titleCasePoolId(pool.id ?? "unknown"),
    classification,
    shielded: classification !== "not-shielded",
    unrecognised: classification === "assumed-shielded",
    balanceZec: zat === null ? null : zat / ZATOSHI_PER_ZEC,
    balanceZat: zat,
    monitored: pool.monitored !== false,
    ...(note ? { note } : {}),
  };
}

/* ── the reconciliation ──────────────────────────────────────────────────── */

export type SubsidyCheck = {
  /** null when the node does not implement getblocksubsidy. */
  nodeZec: number | null;
  modelledZec: number;
  /** null when there is nothing to compare against. */
  deltaZec: number | null;
  agrees: boolean | null;
  detail: string;
};

/**
 * Compare our modelled subsidy against the node's own answer at the same height.
 *
 * This is the part of the panel that cannot be faked: two independent
 * computations of the same quantity, one of them not ours.
 */
export function checkSubsidy(height: number, subsidy: BlockSubsidy | null): SubsidyCheck {
  const modelledZec = blockSubsidyZat(height) / ZATOSHI_PER_ZEC;

  if (!subsidy) {
    return {
      nodeZec: null,
      modelledZec,
      deltaZec: null,
      agrees: null,
      detail: "Node does not report getblocksubsidy, so the model is unverified here.",
    };
  }

  // The subsidy is split across recipients; the total is what consensus issued.
  const streams = [...(subsidy.fundingstreams ?? []), ...(subsidy.lockboxstreams ?? [])];
  const streamTotal = streams.reduce((total, stream) => {
    if (typeof stream.value === "number") return total + stream.value;
    if (typeof stream.valueZat === "number") return total + stream.valueZat / ZATOSHI_PER_ZEC;
    return total;
  }, 0);

  const miner = typeof subsidy.miner === "number" ? subsidy.miner : 0;
  const founders = typeof subsidy.founders === "number" ? subsidy.founders : 0;
  const nodeZec = miner + founders + streamTotal;

  if (nodeZec <= 0) {
    return {
      nodeZec: null,
      modelledZec,
      deltaZec: null,
      agrees: null,
      detail: "getblocksubsidy returned no recognisable amounts.",
    };
  }

  const deltaZec = nodeZec - modelledZec;
  // One zatoshi of tolerance: consensus rounds stream allocations down, so the
  // parts can sum to marginally less than the whole.
  const agrees = Math.abs(deltaZec) < 1 / ZATOSHI_PER_ZEC + 1e-9;

  return {
    nodeZec,
    modelledZec,
    deltaZec,
    agrees,
    detail: agrees
      ? `Node and model agree on the block ${height} subsidy (${modelledZec} ZEC).`
      : `Node reports ${nodeZec} ZEC at block ${height}; model says ${modelledZec} ZEC. Trust the node.`,
  };
}

export type SupplySummary = {
  height: number;
  pools: PoolBalance[];
  /** Sum of every pool the node classifies as shielded. Reported, not modelled. */
  shieldedZec: number;
  /** Sum of non-shielded pools the node reports (lockbox, and transparent if given). */
  otherReportedZec: number;
  /** Modelled cumulative issuance at this height. */
  issuedZec: number;
  /**
   * Transparent value. `reported` when the node gives a transparent pool,
   * `derived` when we had to subtract shielded from modelled issuance.
   */
  transparent: { zec: number | null; basis: "reported" | "derived" | "unknown" };
  /** Shielded / issued. null when issuance is unknown. */
  shieldedShare: number | null;
  /**
   * Reported total minus modelled issuance. Meaningful only when the node
   * reports a transparent pool; otherwise the two are equal by construction and
   * `meaningful` is false.
   */
  reconciliation: { deltaZec: number | null; meaningful: boolean; detail: string };
  subsidyCheck: SubsidyCheck;
  modelCheck: { ok: boolean; detail: string };
  /** Every pool id the node returned that we did not recognise. */
  unrecognisedPools: string[];
};

/**
 * Build the supply panel's data from node-reported pools plus the model.
 *
 * Everything that could be a lie is labelled with where it came from.
 */
export function summarizeSupply(input: {
  height: number;
  valuePools: ValuePool[] | null | undefined;
  subsidy: BlockSubsidy | null;
}): SupplySummary {
  const { height } = input;
  const pools = (input.valuePools ?? []).map(classifyPool);

  const sum = (list: PoolBalance[]): number =>
    list.reduce((total, pool) => total + (pool.balanceZec ?? 0), 0);

  const shieldedPools = pools.filter((pool) => pool.shielded);
  const otherPools = pools.filter((pool) => !pool.shielded);
  const transparentPool = pools.find((pool) => pool.id.toLowerCase() === "transparent");

  const shieldedZec = sum(shieldedPools);
  const otherReportedZec = sum(otherPools);
  const issuedZec = cumulativeIssuanceZat(height) / ZATOSHI_PER_ZEC;

  let transparent: SupplySummary["transparent"];
  if (transparentPool && transparentPool.balanceZec !== null) {
    transparent = { zec: transparentPool.balanceZec, basis: "reported" };
  } else if (pools.length > 0) {
    // Non-transparent, non-shielded pools (lockbox) are already accounted for in
    // issuance, so they come out of the transparent remainder too.
    transparent = { zec: issuedZec - shieldedZec - otherReportedZec, basis: "derived" };
  } else {
    transparent = { zec: null, basis: "unknown" };
  }

  const reportedTotal = shieldedZec + otherReportedZec + (transparentPool?.balanceZec ?? 0);
  const reconciliation: SupplySummary["reconciliation"] = transparentPool
    ? {
        deltaZec: reportedTotal - issuedZec,
        meaningful: true,
        detail:
          "This node reports a transparent pool, so reported total and modelled issuance are independent — the delta is a real check.",
      }
    : {
        deltaZec: null,
        meaningful: false,
        detail:
          "This node reports shielded pools only, so transparent value is derived by subtraction and cannot check itself. The subsidy comparison below is the independent check.",
      };

  return {
    height,
    pools,
    shieldedZec,
    otherReportedZec,
    issuedZec,
    transparent,
    shieldedShare: issuedZec > 0 ? shieldedZec / issuedZec : null,
    reconciliation,
    subsidyCheck: checkSubsidy(height, input.subsidy),
    modelCheck: issuanceModelSelfCheck(),
    unrecognisedPools: pools.filter((pool) => pool.unrecognised).map((pool) => pool.id),
  };
}
