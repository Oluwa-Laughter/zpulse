/**
 * Demo mode: a synthetic Zcash node.
 *
 * Why this exists: the app has to be buildable, reviewable and demonstrable
 * before an RPC endpoint is in hand, and a live demo should not hard-fail if
 * the provider picks that moment to rate-limit.
 *
 * Two rules this module obeys, and they matter:
 *
 *  1. Demo mode is ONLY entered when explicitly configured (ZCASH_RPC_MODE=demo,
 *     or no ZCASH_RPC_URL at all). It is never a fallback for a failed live
 *     call — a broken node must look broken, not look live. Every response is
 *     tagged `source: "demo"` and the UI badges it.
 *
 *  2. The synthetic node deliberately emulates **zebrad**, not zcashd: it
 *     answers `getrawmempool`/`getpeerinfo`/`getinfo` and returns -32601 for
 *     `getnetworkinfo`/`getmempoolinfo`. That means the dialect layer's
 *     fallbacks are exercised on every demo run instead of being discovered
 *     for the first time against a real endpoint.
 *
 * Values are deterministic functions of block height, so charts are stable
 * across restarts, and the tip advances on a ~75s cadence off a fixed epoch
 * so the live ticker genuinely ticks.
 *
 * The numbers are plausible, not real. Do not cite them.
 */

import { RpcUnsupportedError } from "./errors";
import type {
  Block,
  BlockHeader,
  BlockSubsidy,
  BlockchainInfo,
  NodeInfo,
  PeerInfo,
  RawTransaction,
  TreeState,
  ValuePool,
  VerboseMempool,
} from "./types";

/** Anchor for the synthetic chain. Fixed, so height is stable across restarts. */
const DEMO_EPOCH_MS = Date.UTC(2026, 7, 22, 0, 0, 0);
const DEMO_BASE_HEIGHT = 3_470_000;
const TARGET_SPACING_S = 75;

/** Cumulative pool balances at DEMO_BASE_HEIGHT, in ZEC. */
const DEMO_POOL_BASE: Record<string, number> = {
  sprout: 4_812.16,
  sapling: 548_930.44,
  // Orchard is exit-only post-Ironwood, so it drains.
  orchard: 1_902_774.03,
  // Ironwood is the current destination for new shielded value, so it grows.
  ironwood: 913_408.77,
};
const DEMO_TRANSPARENT_BASE = 13_559_664.6;

export function demoTipHeight(nowMs: number = Date.now()): number {
  const elapsed = Math.max(0, nowMs - DEMO_EPOCH_MS);
  return DEMO_BASE_HEIGHT + Math.floor(elapsed / (TARGET_SPACING_S * 1000));
}

function demoBlockTime(height: number, nowMs: number = Date.now()): number {
  const tip = demoTipHeight(nowMs);
  return Math.floor(nowMs / 1000) - (tip - height) * TARGET_SPACING_S;
}

/* ── deterministic pseudo-randomness ─────────────────────────────────────── */

/** FNV-1a. Small, dependency-free, good enough to make synthetic data look organic. */
function hash32(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic float in [0,1) for a given seed. */
function rand(seed: string): number {
  return hash32(seed) / 0x1_0000_0000;
}

/** Deterministic integer in [min,max]. */
function randInt(seed: string, min: number, max: number): number {
  return min + Math.floor(rand(seed) * (max - min + 1));
}

/** Deterministic 64-char hex string — stands in for a block hash or txid. */
function hex64(seed: string): string {
  let out = "";
  let i = 0;
  while (out.length < 64) {
    out += hash32(`${seed}:${i}`).toString(16).padStart(8, "0");
    i++;
  }
  return out.slice(0, 64);
}

function blockHash(height: number): string {
  // Real Zcash hashes lead with zeros from proof of work; mimic that so the
  // UI's hash truncation is exercised realistically.
  return "0000" + hex64(`block:${height}`).slice(4);
}

function heightFromHash(hash: string): number | null {
  // Reverse lookup by scanning a window around the tip. Only demo code does
  // this; a real node has an index.
  const tip = demoTipHeight();
  for (let h = tip; h > tip - 5000 && h >= 0; h--) {
    if (blockHash(h) === hash) return h;
  }
  return null;
}

/* ── per-block value pool deltas: the turnstile story ────────────────────── */

/**
 * Orchard drains, Ironwood fills, Sapling drifts, Sprout is dormant.
 * Roughly 3 blocks in 4 move some shielded value.
 */
function poolDeltas(height: number): Record<string, number> {
  const active = rand(`active:${height}`) > 0.25;
  if (!active) return {};

  const exiting = Number((rand(`orchard:${height}`) * 420).toFixed(8));
  const entering = Number((rand(`ironwood:${height}`) * 510).toFixed(8));
  const saplingDrift = Number(((rand(`sapling:${height}`) - 0.5) * 90).toFixed(8));

  const deltas: Record<string, number> = {};
  if (exiting > 1) deltas.orchard = -exiting;
  if (entering > 1) deltas.ironwood = entering;
  if (Math.abs(saplingDrift) > 1) deltas.sapling = saplingDrift;
  return deltas;
}

/**
 * Cumulative balances at a height, by summing deltas forward from the base.
 *
 * The walk is clamped to a fixed window: this runs per request, and the demo
 * tip advances with wall-clock time, so an unclamped loop would get slower
 * every day the file sits here. Synthetic balances drifting slightly from a
 * true running total costs nothing.
 */
const DEMO_BALANCE_WALK_LIMIT = 20_000;

function poolBalances(height: number): Record<string, number> {
  const balances: Record<string, number> = { ...DEMO_POOL_BASE };
  const from = Math.max(DEMO_BASE_HEIGHT + 1, height - DEMO_BALANCE_WALK_LIMIT);
  for (let h = from; h <= height; h++) {
    const deltas = poolDeltas(h);
    for (const [id, delta] of Object.entries(deltas)) {
      balances[id] = (balances[id] ?? 0) + delta;
    }
  }
  return balances;
}

function toValuePools(balances: Record<string, number>): ValuePool[] {
  return Object.entries(balances).map(([id, value]) => ({
    id,
    monitored: true,
    chainValue: Number(value.toFixed(8)),
    chainValueZat: Math.round(value * 1e8),
  }));
}

/* ── transactions ────────────────────────────────────────────────────────── */

function coinbaseTx(height: number): RawTransaction {
  const subsidy = demoSubsidy(height);
  return {
    txid: hex64(`cb:${height}`),
    size: 231,
    vin: [{ coinbase: hex64(`cbin:${height}`).slice(0, 20), sequence: 4294967295 }],
    vout: [
      { value: subsidy.miner ?? 0, valueZat: Math.round((subsidy.miner ?? 0) * 1e8), n: 0 },
      { value: 0.3125, valueZat: 31_250_000, n: 1 },
    ],
    vjoinsplit: [],
    vShieldedSpend: [],
    vShieldedOutput: [],
  };
}

/**
 * A synthetic transaction whose shape lands in one of the four classes
 * lib/analysis/privacy.ts recognises, weighted to look like real Zcash
 * traffic (transparent-heavy, with a meaningful shielded minority).
 */
function syntheticTx(height: number, index: number): RawTransaction {
  const seed = `tx:${height}:${index}`;
  const roll = rand(seed);
  const txid = hex64(seed);

  // Fully shielded: Orchard/Ironwood-style actions, no transparent parts.
  if (roll < 0.28) {
    const actions = randInt(`${seed}:actions`, 2, 6);
    return {
      txid,
      size: 2000 + actions * 820,
      vin: [],
      vout: [],
      vjoinsplit: [],
      vShieldedSpend: [],
      vShieldedOutput: [],
      orchard: {
        actions: new Array(actions).fill(null).map((_, i) => ({ nullifier: hex64(`${seed}:n:${i}`) })),
        valueBalance: 0,
        valueBalanceZat: 0,
      },
    };
  }

  // Shielding: transparent in, shielded out.
  if (roll < 0.4) {
    const outs = randInt(`${seed}:so`, 1, 3);
    return {
      txid,
      size: 1400 + outs * 950,
      vin: [{ txid: hex64(`${seed}:in`), vout: 0 }],
      vout: [],
      vjoinsplit: [],
      vShieldedSpend: [],
      vShieldedOutput: new Array(outs).fill(null).map((_, i) => ({ cmu: hex64(`${seed}:cmu:${i}`) })),
      valueBalance: -Number((rand(`${seed}:vb`) * 60).toFixed(8)),
    };
  }

  // Deshielding: shielded in, transparent out.
  if (roll < 0.48) {
    const spends = randInt(`${seed}:ss`, 1, 2);
    return {
      txid,
      size: 1300 + spends * 900,
      vin: [],
      vout: [{ value: Number((rand(`${seed}:v`) * 40).toFixed(8)), n: 0 }],
      vjoinsplit: [],
      vShieldedSpend: new Array(spends).fill(null).map((_, i) => ({ nullifier: hex64(`${seed}:sn:${i}`) })),
      vShieldedOutput: [],
      valueBalance: Number((rand(`${seed}:vb2`) * 40).toFixed(8)),
    };
  }

  // Transparent only.
  const outs = randInt(`${seed}:to`, 1, 3);
  return {
    txid,
    size: 220 + outs * 34,
    vin: [{ txid: hex64(`${seed}:in`), vout: randInt(`${seed}:vo`, 0, 1) }],
    vout: new Array(outs).fill(null).map((_, i) => ({
      value: Number((rand(`${seed}:v:${i}`) * 120).toFixed(8)),
      n: i,
    })),
    vjoinsplit: [],
    vShieldedSpend: [],
    vShieldedOutput: [],
  };
}

function blockTxs(height: number): RawTransaction[] {
  const count = randInt(`txcount:${height}`, 1, 7);
  const txs: RawTransaction[] = [coinbaseTx(height)];
  for (let i = 0; i < count; i++) txs.push(syntheticTx(height, i));
  return txs;
}

/* ── issuance ────────────────────────────────────────────────────────────── */

/**
 * Post-second-halving block subsidy, split per ZIP-1015.
 *
 * The parts must sum to the whole: 1.25 + 0.125 + 0.1875 = 1.5625 ZEC, the
 * subsidy after the November 2024 halving. This is load-bearing, because
 * lib/analysis/supply.ts cross-checks its own issuance model against whatever
 * getblocksubsidy reports — so a demo node whose split did not add up would make
 * the supply panel accuse itself of being broken.
 *
 * ZIP-1015 replaced the ZIP-214 ECC/ZF streams at NU6 with 8% to Zcash Community
 * Grants and 12% to a deferred lockbox, which is why the old streams are absent.
 */
function demoSubsidy(height: number): BlockSubsidy {
  void height;
  return {
    miner: 1.25,
    fundingstreams: [
      {
        recipient: "Zcash Community Grants",
        specification: "https://zips.z.cash/zip-1015",
        value: 0.125,
        valueZat: 12_500_000,
      },
    ],
    lockboxstreams: [
      {
        recipient: "Deferred development fund",
        specification: "https://zips.z.cash/zip-1015",
        value: 0.1875,
        valueZat: 18_750_000,
      },
    ],
  };
}

/* ── the synthetic node ──────────────────────────────────────────────────── */

function demoBlock(height: number, verbosity: number): Block | string {
  const hash = blockHash(height);
  if (verbosity === 0) return hex64(`raw:${height}`);

  const txs = blockTxs(height);
  const deltas = poolDeltas(height);
  const valuePools: ValuePool[] = Object.keys(DEMO_POOL_BASE).map((id) => {
    const delta = deltas[id] ?? 0;
    return {
      id,
      monitored: true,
      valueDelta: Number(delta.toFixed(8)),
      valueDeltaZat: Math.round(delta * 1e8),
    };
  });

  const tip = demoTipHeight();
  return {
    hash,
    height,
    confirmations: tip - height + 1,
    size: txs.reduce((sum, tx) => sum + (tx.size ?? 0), 0) + 1_500,
    time: demoBlockTime(height),
    difficulty: 108_000_000 + randInt(`diff:${height}`, -4_000_000, 4_000_000),
    tx: verbosity >= 2 ? txs : txs.map((tx) => tx.txid ?? ""),
    valuePools,
    previousblockhash: height > 0 ? blockHash(height - 1) : undefined,
    nextblockhash: height < tip ? blockHash(height + 1) : undefined,
  };
}

function demoBlockchainInfo(): BlockchainInfo {
  const tip = demoTipHeight();
  const balances = poolBalances(tip);
  return {
    chain: "main",
    blocks: tip,
    headers: tip,
    bestblockhash: blockHash(tip),
    difficulty: 108_442_919.31,
    verificationprogress: 1,
    estimatedheight: tip,
    size_on_disk: 219_884_401_664,
    valuePools: toValuePools(balances),
    upgrades: {
      "5ba81b19": { name: "Overwinter", activationheight: 347_500, status: "active", info: "See https://z.cash/upgrade/overwinter/" },
      "76b809bb": { name: "Sapling", activationheight: 419_200, status: "active", info: "See https://z.cash/upgrade/sapling/" },
      "2bb40e60": { name: "Blossom", activationheight: 653_600, status: "active", info: "See https://z.cash/upgrade/blossom/" },
      f5b9230b: { name: "Heartwood", activationheight: 903_000, status: "active", info: "See https://z.cash/upgrade/heartwood/" },
      e9ff75a6: { name: "Canopy", activationheight: 1_046_400, status: "active", info: "See https://z.cash/upgrade/canopy/" },
      c2d6d0b4: { name: "NU5", activationheight: 1_687_104, status: "active", info: "See https://z.cash/upgrade/nu5/" },
      c8e71055: { name: "NU6", activationheight: 2_726_400, status: "active", info: "See https://z.cash/upgrade/nu6/" },
      "7360f6a6": { name: "Ironwood", activationheight: 3_366_400, status: "active", info: "Synthetic demo value — verify against your node." },
    },
    consensus: { chaintip: "7360f6a6", nextblock: "7360f6a6" },
  };
}

function demoTreeState(height: number): TreeState {
  return {
    hash: blockHash(height),
    height,
    time: demoBlockTime(height),
    sprout: { commitments: { finalRoot: hex64(`root:sprout:${height}`), finalState: "01" + hex64(`state:sprout:${height}`) } },
    sapling: { commitments: { finalRoot: hex64(`root:sapling:${height}`), finalState: "01" + hex64(`state:sapling:${height}`) } },
    orchard: { commitments: { finalRoot: hex64(`root:orchard:${height}`), finalState: "01" + hex64(`state:orchard:${height}`) } },
  };
}

function demoMempool(): VerboseMempool {
  const tip = demoTipHeight();
  const count = randInt(`mempool:${Math.floor(Date.now() / 30_000)}`, 0, 14);
  const out: VerboseMempool = {};
  for (let i = 0; i < count; i++) {
    const seed = `mp:${tip}:${i}`;
    out[hex64(seed)] = {
      size: randInt(`${seed}:size`, 220, 9_400),
      fee: 0.0001,
      time: Math.floor(Date.now() / 1000) - randInt(`${seed}:age`, 1, 240),
      height: tip,
    };
  }
  return out;
}

function demoPeers(): PeerInfo[] {
  const tip = demoTipHeight();
  const count = randInt(`peers:${Math.floor(Date.now() / 120_000)}`, 6, 11);
  const peers: PeerInfo[] = [];
  for (let i = 0; i < count; i++) {
    const seed = `peer:${i}`;
    peers.push({
      id: i + 1,
      addr: `${randInt(`${seed}:a`, 5, 220)}.${randInt(`${seed}:b`, 0, 255)}.${randInt(`${seed}:c`, 0, 255)}.${randInt(`${seed}:d`, 1, 254)}:8233`,
      subver: i % 3 === 0 ? "/Zebra:2.4.1/" : "/MagicBean:6.3.0/",
      inbound: i % 4 === 0,
      startingheight: tip - randInt(`${seed}:h`, 0, 3),
      conntime: Math.floor(Date.now() / 1000) - randInt(`${seed}:t`, 300, 86_400),
      pingtime: Number((rand(`${seed}:p`) * 0.4).toFixed(4)),
    });
  }
  return peers;
}

function demoNodeInfo(): NodeInfo {
  const tip = demoTipHeight();
  return {
    version: 2_004_001,
    subversion: "/Zebra:2.4.1/",
    build: "v2.4.1",
    blocks: tip,
    connections: demoPeers().length,
    difficulty: 108_442_919.31,
    errors: "",
  };
}

function demoBlockHeader(height: number): BlockHeader {
  return {
    hash: blockHash(height),
    height,
    time: demoBlockTime(height),
    difficulty: 108_000_000 + randInt(`diff:${height}`, -4_000_000, 4_000_000),
    previousblockhash: height > 0 ? blockHash(height - 1) : undefined,
  };
}

/** Resolve a block identifier that may be a height (number or numeric string) or a hash. */
function resolveHeight(param: unknown): number {
  if (typeof param === "number" && Number.isFinite(param)) return param;
  if (typeof param === "string") {
    if (/^\d+$/.test(param)) return Number(param);
    const height = heightFromHash(param);
    if (height !== null) return height;
  }
  return demoTipHeight();
}

/**
 * The synthetic node's dispatch table.
 *
 * Methods absent from this switch throw RpcUnsupportedError, which is exactly
 * what a real node returns as JSON-RPC -32601 — including `getnetworkinfo` and
 * `getmempoolinfo`, on purpose, because zebrad does not implement them.
 */
export function getDemoResult(method: string, params: unknown[] = []): unknown {
  switch (method) {
    case "getblockchaininfo":
      return demoBlockchainInfo();

    case "getblockcount":
      return demoTipHeight();

    case "getbestblockhash":
      return blockHash(demoTipHeight());

    case "getblockhash":
      return blockHash(resolveHeight(params[0]));

    case "getblock": {
      const height = resolveHeight(params[0]);
      const verbosityParam = params[1];
      const verbosity =
        typeof verbosityParam === "number"
          ? verbosityParam
          : typeof verbosityParam === "string" && /^\d+$/.test(verbosityParam)
            ? Number(verbosityParam)
            : 1;
      return demoBlock(height, verbosity);
    }

    case "getblockheader": {
      const height = resolveHeight(params[0]);
      const verbose = params[1];
      if (verbose === false) return hex64(`hdr:${height}`);
      return demoBlockHeader(height);
    }

    case "getrawtransaction": {
      const txid = typeof params[0] === "string" ? params[0] : hex64("unknown");
      const verbose = params[1];
      if (verbose === 0 || verbose === false || verbose === undefined) return hex64(`rawtx:${txid}`);
      // The demo node cannot reverse a txid back to a block, so it returns a
      // shape-correct transaction seeded by the txid itself.
      const tx = syntheticTx(demoTipHeight(), hash32(txid) % 7);
      return { ...tx, txid, confirmations: randInt(`conf:${txid}`, 1, 120) };
    }

    case "z_gettreestate":
      return demoTreeState(resolveHeight(params[0]));

    case "getblocksubsidy":
      return demoSubsidy(resolveHeight(params[0]));

    case "getrawmempool": {
      const verbose = params[0];
      const mempool = demoMempool();
      return verbose === true ? mempool : Object.keys(mempool);
    }

    case "getpeerinfo":
      return demoPeers();

    case "getnetworksolps":
      return 9_400_000_000 + randInt(`solps:${Math.floor(Date.now() / 60_000)}`, -400_000_000, 400_000_000);

    case "getmininginfo": {
      const tip = demoTipHeight();
      return {
        blocks: tip,
        difficulty: 108_442_919.31,
        networksolps: 9_400_000_000,
        chain: "main",
      };
    }

    case "getinfo":
      return demoNodeInfo();

    // Deliberately unimplemented, matching zebrad:
    //   getnetworkinfo, getmempoolinfo
    default:
      throw new RpcUnsupportedError(method);
  }
}

/** Methods the synthetic node answers. Used by the capability probe in demo mode. */
export const DEMO_SUPPORTED_METHODS = [
  "getblockchaininfo",
  "getblockcount",
  "getbestblockhash",
  "getblockhash",
  "getblock",
  "getblockheader",
  "getrawtransaction",
  "z_gettreestate",
  "getblocksubsidy",
  "getrawmempool",
  "getpeerinfo",
  "getnetworksolps",
  "getmininginfo",
  "getinfo",
] as const;
