/**
 * Capability detection.
 *
 * The problem this solves: ZPulse targets zcashd, zebrad and zecd, and they do
 * not implement the same RPC surface. zcashd has `getnetworkinfo` and
 * `getmempoolinfo`; Zebra has neither, and answers with `getpeerinfo`,
 * `getrawmempool` and `getinfo` instead. The earlier prototype called the
 * zcashd-only methods unconditionally, so it would have returned a 500 against
 * a Zebra node — and the workshop deck marks zcashd deprecated, so that is the
 * node this app should expect to meet.
 *
 * The trick that makes detection cheap and reliable: JSON-RPC distinguishes
 * "method not found" (-32601) from "your parameters were wrong". So a method
 * can be probed with deliberately useless arguments — *any* error other than
 * -32601 proves the method exists. That means `getrawtransaction` can be
 * probed without knowing a real txid.
 *
 * Probes are lazy, per-method, coalesced, and cached for the process lifetime.
 * A node does not grow new RPC methods while it is running.
 */

import { rpcCall } from "./client";
import { RpcHttpError, RpcMethodError, RpcUnsupportedError } from "./errors";

/**
 * Feature probes get a pseudo-method key with a colon, so they cache alongside
 * plain method probes without colliding with a real method name.
 */
export const FEATURE_BLOCK_VERBOSITY_2 = "getblock:verbosity2";
export const FEATURE_MEMPOOL_VERBOSE = "getrawmempool:verbose";

type Probe = { key: string; method: string; params: unknown[]; label: string };

/**
 * Every probe uses the cheapest arguments that still reach the method's body.
 * Block 1 is used rather than the tip so no probe depends on another call.
 */
const PROBES: Probe[] = [
  { key: "getblockchaininfo", method: "getblockchaininfo", params: [], label: "Chain tip, value pools, upgrades" },
  { key: "getblockcount", method: "getblockcount", params: [], label: "Cheapest tip poll" },
  { key: "getbestblockhash", method: "getbestblockhash", params: [], label: "Tip hash" },
  { key: "getblockhash", method: "getblockhash", params: [1], label: "Height to hash" },
  { key: "getblock", method: "getblock", params: ["1", 1], label: "Block with per-pool value deltas" },
  { key: FEATURE_BLOCK_VERBOSITY_2, method: "getblock", params: ["1", 2], label: "Inline transactions (1 call per block)" },
  { key: "getblockheader", method: "getblockheader", params: ["1", true], label: "Block timestamps" },
  { key: "getrawtransaction", method: "getrawtransaction", params: ["00".repeat(32), 1], label: "Transaction anatomy fallback" },
  { key: "z_gettreestate", method: "z_gettreestate", params: ["1"], label: "Shielded commitment trees" },
  { key: "getblocksubsidy", method: "getblocksubsidy", params: [1], label: "Issuance and funding streams" },
  { key: "getrawmempool", method: "getrawmempool", params: [], label: "Mempool (Zebra-compatible)" },
  { key: FEATURE_MEMPOOL_VERBOSE, method: "getrawmempool", params: [true], label: "Mempool with sizes" },
  { key: "getmempoolinfo", method: "getmempoolinfo", params: [], label: "Mempool summary (zcashd)" },
  { key: "getpeerinfo", method: "getpeerinfo", params: [], label: "Peers" },
  { key: "getnetworkinfo", method: "getnetworkinfo", params: [], label: "Connections and version (zcashd)" },
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
    await rpcCall(probe.method, probe.params);
    return true;
  } catch (err) {
    if (looksUnsupported(err)) return false;
    // Any other error — bad params, bad txid, node still syncing — means the
    // method was found and executed. That is what we are testing for.
    return true;
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
  /** True for the two feature probes rather than plain method-existence probes. */
  feature: boolean;
};

export type CapabilityReport = {
  entries: CapabilityEntry[];
  supportedCount: number;
  totalCount: number;
  /** Best guess at which node implementation we are talking to. */
  dialect: "zcashd-like" | "zebra-like" | "mixed" | "unknown";
};

/**
 * Probe everything. Called by /api/capabilities and by the RPC console so the
 * UI can grey out unsupported methods instead of letting a user click into a
 * guaranteed error.
 */
export async function probeAll(): Promise<CapabilityReport> {
  const results = await Promise.all(
    PROBES.map(async (probe) => ({
      key: probe.key,
      method: probe.method,
      label: probe.label,
      feature: probe.key.includes(":"),
      supported: await supports(probe.key),
    })),
  );

  const has = (key: string) => results.find((entry) => entry.key === key)?.supported === true;

  // getnetworkinfo/getmempoolinfo are the zcashd tell; their absence alongside
  // a working getrawmempool is the Zebra tell.
  const zcashdOnly = has("getnetworkinfo") || has("getmempoolinfo");
  const zebraShaped = !has("getnetworkinfo") && !has("getmempoolinfo") && has("getrawmempool");

  let dialect: CapabilityReport["dialect"] = "unknown";
  if (zcashdOnly && zebraShaped) dialect = "mixed";
  else if (zcashdOnly) dialect = "zcashd-like";
  else if (zebraShaped) dialect = "zebra-like";

  return {
    entries: results,
    supportedCount: results.filter((entry) => entry.supported).length,
    totalCount: results.length,
    dialect,
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
}
