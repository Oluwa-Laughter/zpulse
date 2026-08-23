/**
 * Capability detection.
 *
 * The problem this solves: ZPulse targets whatever node it is pointed at, and no
 * two of them implement the same RPC surface. zcashd is deprecated, so zebrad is
 * the expected node — but "zebrad" is not one target. `getmempoolinfo` and
 * `getnetworkinfo` arrived in Zebra partway through its life, and per-pool
 * `valueDelta` on `getblock` did too, so an older zebrad and a current one differ
 * from each other about as much as zcashd and Zebra ever did.
 *
 * Two different questions therefore get answered separately here, because
 * conflating them is how you end up confidently wrong:
 *
 *  · **What does this endpoint implement?** Probed, never inferred. JSON-RPC
 *    distinguishes "method not found" (-32601) from "your parameters were wrong",
 *    so a method can be probed with deliberately useless arguments — *any* error
 *    other than -32601 proves the method exists. That is how `getrawtransaction`
 *    is probed without knowing a real txid.
 *
 *  · **What software is answering?** Read from the node's own user agent via
 *    `getinfo`/`getnetworkinfo`. Deliberately *not* inferred from which methods
 *    are missing: an earlier version of this file guessed "Zebra" from the
 *    absence of `getmempoolinfo`, which stopped being true when Zebra
 *    implemented it, and the report then confidently mislabelled every current
 *    zebrad as zcashd.
 *
 * A third probe kind sits alongside the first: a *shape* probe, which calls a
 * method that certainly exists and checks the response carries a field. That is
 * how the version-skew axis becomes visible rather than a mystery — see
 * FEATURE_BLOCK_VALUE_DELTA.
 *
 * Probes are lazy, per-key, coalesced, and cached for the process lifetime. A
 * node does not grow new RPC methods while it is running.
 */

import { rpcCall } from "./client";
import { RpcHttpError, RpcMethodError, RpcUnsupportedError } from "./errors";
import type { ValuePool } from "./types";

/**
 * Feature and shape probes get a pseudo-method key with a colon, so they cache
 * alongside plain method probes without colliding with a real method name.
 */
export const FEATURE_BLOCK_VERBOSITY_2 = "getblock:verbosity2";
export const FEATURE_MEMPOOL_VERBOSE = "getrawmempool:verbose";
export const FEATURE_BLOCK_VALUE_DELTA = "getblock:valuedelta";

/**
 * `check` turns a probe from "does this method exist" into "does its response
 * carry what we need". Present only on shape probes.
 */
type Probe = {
  key: string;
  method: string;
  params: unknown[];
  label: string;
  check?: (result: unknown) => boolean;
};

/** Does any pool in a `getblock` response carry a per-block delta? */
function hasValueDelta(result: unknown): boolean {
  const pools = (result as { valuePools?: ValuePool[] } | null)?.valuePools;
  if (!Array.isArray(pools)) return false;
  return pools.some(
    (pool) => typeof pool?.valueDelta === "number" || typeof pool?.valueDeltaZat === "number",
  );
}

/**
 * Every probe uses the cheapest arguments that still reach the method's body.
 * Block 1 is used rather than the tip so no probe depends on another call.
 */
const PROBES: Probe[] = [
  { key: "getblockchaininfo", method: "getblockchaininfo", params: [], label: "Chain tip, value pools, upgrades" },
  { key: "getblockcount", method: "getblockcount", params: [], label: "Cheapest tip poll" },
  { key: "getbestblockhash", method: "getbestblockhash", params: [], label: "Tip hash" },
  { key: "getblockhash", method: "getblockhash", params: [1], label: "Height to hash" },
  { key: "getblock", method: "getblock", params: ["1", 1], label: "Block metadata and pool balances" },
  {
    key: FEATURE_BLOCK_VALUE_DELTA,
    method: "getblock",
    params: ["1", 1],
    label: "Per-pool valueDelta on getblock (field probe, not -32601)",
    check: hasValueDelta,
  },
  { key: FEATURE_BLOCK_VERBOSITY_2, method: "getblock", params: ["1", 2], label: "Inline transactions (1 call per block)" },
  { key: "getblockheader", method: "getblockheader", params: ["1", true], label: "Block timestamps" },
  { key: "getrawtransaction", method: "getrawtransaction", params: ["00".repeat(32), 1], label: "Transaction anatomy fallback" },
  { key: "z_gettreestate", method: "z_gettreestate", params: ["1"], label: "Shielded commitment trees" },
  { key: "getblocksubsidy", method: "getblocksubsidy", params: [1], label: "Issuance and funding streams" },
  { key: "getrawmempool", method: "getrawmempool", params: [], label: "Mempool (every node has this)" },
  { key: FEATURE_MEMPOOL_VERBOSE, method: "getrawmempool", params: [true], label: "Mempool with sizes" },
  { key: "getmempoolinfo", method: "getmempoolinfo", params: [], label: "Mempool summary in one call" },
  { key: "getpeerinfo", method: "getpeerinfo", params: [], label: "Peers" },
  { key: "getnetworkinfo", method: "getnetworkinfo", params: [], label: "Connections and version" },
  { key: "getnetworksolps", method: "getnetworksolps", params: [], label: "Network hashrate" },
  { key: "getmininginfo", method: "getmininginfo", params: [], label: "Hashrate fallback" },
  { key: "getinfo", method: "getinfo", params: [], label: "Node version" },
];

const PROBE_BY_KEY = new Map(PROBES.map((probe) => [probe.key, probe]));

const supportCache = new Map<string, boolean>();
const inflight = new Map<string, Promise<boolean>>();

/**
 * Not every node reports a missing method as -32601. Some proxies answer 404,
 * and some nodes return a generic error whose message is the only signal.
 */
function looksUnsupported(err: unknown): boolean {
  if (err instanceof RpcUnsupportedError) return true;
  if (err instanceof RpcHttpError && err.status === 404) return true;
  if (err instanceof RpcMethodError) {
    if (err.code === -32601) return true;
    return /method not found|unknown method|not supported|no such method|unsupported/i.test(err.message);
  }
  return false;
}

async function runProbe(probe: Probe): Promise<boolean> {
  try {
    const result = await rpcCall(probe.method, probe.params);
    // A shape probe asks about the response, not the method, so the answer is
    // whatever the check says.
    return probe.check ? probe.check(result) : true;
  } catch (err) {
    if (looksUnsupported(err)) return false;
    // For a plain method probe, any other error — bad params, bad txid, node
    // still syncing — means the method was found and executed, which is what we
    // are testing for. For a shape probe it means the opposite: we never saw a
    // response, so we cannot claim the field is there.
    return probe.check ? false : true;
  }
}

/**
 * Does this node support `key`? Cached for the process lifetime and coalesced,
 * so concurrent panels asking the same question cost one request.
 *
 * Unknown keys are optimistically treated as supported: a caller asking about
 * something not in the probe table will find out by calling it.
 */
export async function supports(key: string): Promise<boolean> {
  const cached = supportCache.get(key);
  if (cached !== undefined) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const probe = PROBE_BY_KEY.get(key);
  if (!probe) return true;

  const promise = runProbe(probe)
    .then((result) => {
      supportCache.set(key, result);
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

export type CapabilityEntry = {
  key: string;
  method: string;
  label: string;
  supported: boolean;
  /**
   * `method` — does this method exist (-32601 says no).
   * `feature` — does this method accept these arguments.
   * `shape`   — does the response carry the field we need.
   *
   * Only a `method` row being unsupported means the node lacks the method, which
   * is why the console reads this rather than the key.
   */
  kind: "method" | "feature" | "shape";
};

/** Which node software is answering. Read from its user agent, never inferred. */
export type NodeImplementation = "zebra" | "zcashd" | "unknown";

export type CapabilityReport = {
  entries: CapabilityEntry[];
  supportedCount: number;
  totalCount: number;
  implementation: NodeImplementation;
  /** The user agent the identification came from, or null if none was readable. */
  userAgent: string | null;
};

function classifyUserAgent(agent: string): NodeImplementation {
  if (/zebra/i.test(agent)) return "zebra";
  // zcashd's user agent is "/MagicBean:x.y.z/"; the product name is the tell.
  if (/magicbean|zcashd/i.test(agent)) return "zcashd";
  return "unknown";
}

/**
 * The node's user agent, cached for the process lifetime alongside the probes.
 *
 * `getinfo` first: every zebrad has it, and it is one small call. `getnetworkinfo`
 * is the fallback for a node that dropped `getinfo` as deprecated. Both are
 * gated on `supports()` so this never spends a request on a method the probe
 * already found missing.
 */
let identityCache: { implementation: NodeImplementation; userAgent: string | null } | null = null;
let identityInflight: Promise<{ implementation: NodeImplementation; userAgent: string | null }> | null =
  null;

async function readIdentity(): Promise<{ implementation: NodeImplementation; userAgent: string | null }> {
  for (const method of ["getinfo", "getnetworkinfo"]) {
    if (!(await supports(method))) continue;
    try {
      const info = await rpcCall<{ subversion?: unknown; build?: unknown }>(method);
      for (const field of [info?.subversion, info?.build]) {
        if (typeof field === "string" && field) {
          return { implementation: classifyUserAgent(field), userAgent: field };
        }
      }
    } catch {
      // A method that exists but errors says nothing about identity. Try the next.
    }
  }
  return { implementation: "unknown", userAgent: null };
}

export async function nodeIdentity(): Promise<{
  implementation: NodeImplementation;
  userAgent: string | null;
}> {
  if (identityCache) return identityCache;
  if (identityInflight) return identityInflight;

  identityInflight = readIdentity()
    .then((result) => {
      identityCache = result;
      return result;
    })
    .finally(() => {
      identityInflight = null;
    });

  return identityInflight;
}

/**
 * Probe everything. Called by /api/capabilities and by the RPC console so the
 * UI can mark unsupported methods instead of letting a user click into a
 * guaranteed error.
 */
export async function probeAll(): Promise<CapabilityReport> {
  const [results, identity] = await Promise.all([
    Promise.all(
      PROBES.map(async (probe) => ({
        key: probe.key,
        method: probe.method,
        label: probe.label,
        kind: probe.check ? ("shape" as const) : probe.key.includes(":") ? ("feature" as const) : ("method" as const),
        supported: await supports(probe.key),
      })),
    ),
    nodeIdentity(),
  ]);

  return {
    entries: results,
    supportedCount: results.filter((entry) => entry.supported).length,
    totalCount: results.length,
    implementation: identity.implementation,
    userAgent: identity.userAgent,
  };
}

/** Every method ZPulse can call. The RPC console's allowlist is derived from this. */
export function knownMethods(): string[] {
  return Array.from(new Set(PROBES.map((probe) => probe.method))).sort();
}

/** Test seam: drop cached probe results. */
export function resetCapabilityCache(): void {
  supportCache.clear();
  inflight.clear();
  identityCache = null;
  identityInflight = null;
}
