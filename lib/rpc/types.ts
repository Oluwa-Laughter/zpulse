/**
 * Response shapes for the Zcash JSON-RPC methods ZPulse uses.
 *
 * Two deliberate choices run through this file:
 *
 * 1. Almost every field is optional. ZPulse targets zcashd, zebrad and
 *    zecd, and those three do not return identical objects for the same
 *    method. Code that reads these types must handle absence — the dialect
 *    layer (./dialect.ts) exists precisely so a missing field degrades a
 *    panel instead of throwing.
 *
 * 2. Shielded pools are never enumerated as a union of known names. Zcash has
 *    had Sprout, Sapling, Orchard and now Ironwood, and Tachyon-era pools are
 *    on the roadmap. Pool identity is a `string` and pools arrive as a list to
 *    be iterated. Hardcoding pool names is how an app like this quietly breaks
 *    at the next network upgrade.
 */

/** A shielded (or transparent) value pool as reported by the node. */
export type ValuePool = {
  /** e.g. "sprout", "sapling", "orchard", "transparent", or a pool that did not exist when this was written. */
  id: string;
  /** Whether the node tracks a running balance for this pool. */
  monitored?: boolean;
  /** Cumulative pool balance in ZEC (present on getblockchaininfo when monitored). */
  chainValue?: number;
  /** Cumulative pool balance in zatoshi. */
  chainValueZat?: number;
  /** Change in this pool caused by one block, in ZEC (present on getblock). */
  valueDelta?: number;
  /** Change in this pool caused by one block, in zatoshi. */
  valueDeltaZat?: number;
};

/** One entry of getblockchaininfo's `upgrades` map. */
export type NetworkUpgrade = {
  name: string;
  activationheight: number;
  /** "active" | "pending" | "disabled" — string, because nodes disagree on the vocabulary. */
  status: string;
  info?: string;
};

export type BlockchainInfo = {
  chain: string;
  blocks: number;
  headers?: number;
  bestblockhash: string;
  difficulty?: number;
  /** 0..1. zcashd spells it verificationprogress; some nodes omit it entirely. */
  verificationprogress?: number;
  estimatedheight?: number;
  size_on_disk?: number;
  commitments?: number;
  valuePools?: ValuePool[];
  upgrades?: Record<string, NetworkUpgrade>;
  consensus?: { chaintip?: string; nextblock?: string };
};

/**
 * A transaction as returned inline by getblock verbosity 2, or by
 * getrawtransaction with verbose=1.
 *
 * The index signature is load-bearing, not laziness: lib/analysis/privacy.ts
 * scans for shielded-component containers generically so that a pool added
 * after this file was written still counts toward a transaction's privacy
 * classification.
 */
export type RawTransaction = {
  txid?: string;
  hash?: string;
  size?: number;
  /** Transparent inputs. A coinbase transaction's single vin carries a `coinbase` field. */
  vin?: Array<{ coinbase?: string; txid?: string; [key: string]: unknown }>;
  /** Transparent outputs. */
  vout?: Array<{ value?: number; valueZat?: number; n?: number; [key: string]: unknown }>;
  /** Sprout. */
  vjoinsplit?: unknown[];
  /** Sapling. */
  vShieldedSpend?: unknown[];
  vShieldedOutput?: unknown[];
  /** Orchard (and same shape for later action-based pools). */
  orchard?: { actions?: unknown[]; valueBalance?: number; valueBalanceZat?: number };
  /** Net value moving between the transparent and Sapling pools. */
  valueBalance?: number;
  valueBalanceZat?: number;
  [key: string]: unknown;
};

/** getblock at verbosity 1 (txids only) or 2 (full transaction objects). */
export type Block = {
  hash: string;
  height: number;
  confirmations?: number;
  size?: number;
  time?: number;
  /** Present at verbosity 1 as hex txids; at verbosity 2 as objects. */
  tx?: Array<string | RawTransaction>;
  /** Per-pool value change caused by this block — the turnstile signal. */
  valuePools?: ValuePool[];
  difficulty?: number;
  previousblockhash?: string;
  nextblockhash?: string;
  [key: string]: unknown;
};

export type BlockHeader = {
  hash: string;
  height: number;
  time?: number;
  difficulty?: number;
  previousblockhash?: string;
  [key: string]: unknown;
};

/** z_gettreestate: the commitment-tree fingerprint of shielded state at a height. */
export type TreeState = {
  hash?: string;
  height?: number;
  time?: number;
  sprout?: TreeStatePool;
  sapling?: TreeStatePool;
  orchard?: TreeStatePool;
  /** Future pools appear here under their own key. */
  [key: string]: unknown;
};

export type TreeStatePool = {
  skipHash?: string;
  commitments?: { finalRoot?: string; finalState?: string };
  [key: string]: unknown;
};

/** getblocksubsidy: how newly issued value is split at a given height. */
export type BlockSubsidy = {
  miner?: number;
  founders?: number;
  fundingstreams?: Array<{
    recipient?: string;
    specification?: string;
    value?: number;
    valueZat?: number;
    address?: string;
  }>;
  /** NU6 introduced deferred/lockbox streams; not every node reports them. */
  lockboxstreams?: Array<{
    recipient?: string;
    specification?: string;
    value?: number;
    valueZat?: number;
  }>;
  [key: string]: unknown;
};

export type PeerInfo = {
  id?: number;
  addr?: string;
  subver?: string;
  inbound?: boolean;
  /** Peer's reported chain height. zcashd calls it startingheight. */
  startingheight?: number;
  conntime?: number;
  pingtime?: number;
  [key: string]: unknown;
};

/** zcashd only. Zebra does not implement getnetworkinfo. */
export type NetworkInfo = {
  version?: number;
  subversion?: string;
  protocolversion?: number;
  connections?: number;
  [key: string]: unknown;
};

/** zcashd only. Zebra exposes getrawmempool instead. */
export type MempoolInfo = {
  size?: number;
  bytes?: number;
  usage?: number;
  [key: string]: unknown;
};

export type MiningInfo = {
  blocks?: number;
  difficulty?: number;
  networksolps?: number;
  networkhashps?: number;
  [key: string]: unknown;
};

/** getinfo — deprecated on zcashd, implemented by Zebra. Used only for version strings. */
export type NodeInfo = {
  version?: number;
  subversion?: string;
  build?: string;
  blocks?: number;
  connections?: number;
  difficulty?: number;
  errors?: string;
  [key: string]: unknown;
};

/** getrawmempool with verbose=true. Keys are txids. */
export type VerboseMempool = Record<
  string,
  { size?: number; fee?: number; time?: number; height?: number; [key: string]: unknown }
>;

/** Where a piece of data came from. Surfaced in every API response's `meta`. */
export type DataSource = "live" | "cache" | "demo";
