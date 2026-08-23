/**
 * The RPC console's allowlist.
 *
 * This is the security boundary of the app, so it is worth being explicit about
 * how it works. `/api/rpc` accepts a method name from the browser. If that name
 * is not a key in the table below, the request is rejected before any transport
 * code runs. There is no denylist anywhere — `stop`, `submitblock`,
 * `sendrawtransaction`, `z_sendmany` and every other wallet or mutating method
 * are unreachable because they were never added, not because they were filtered
 * out. Adding a dangerous method requires editing this file, which is the point.
 *
 * Params are validated by position, type and range before they are forwarded,
 * so a caller cannot smuggle an object into a slot the node expects a string in,
 * and cannot ask for a 10,000-transaction verbosity-2 block to exhaust the quota.
 *
 * Optional params are only ever trailing, and every optional one has a default.
 * JSON-RPC params are positional, so an optional param in the middle would be
 * unrepresentable — you cannot omit argument 1 and supply argument 2. Giving all
 * of them defaults removes the ambiguity instead of half-handling it.
 *
 * `consoleAllowlistDrift()` at the bottom checks this table against the probe
 * table in capabilities.ts. The two describing different method sets would mean
 * the console offers a method the app never probes, or the app probes something
 * the console silently cannot run.
 */

import { knownMethods } from "./capabilities";

/** Rejected before transport. Carries a message safe to show the user. */
export class ConsoleRejectedError extends Error {
  readonly method: string;

  constructor(message: string, method: string) {
    super(message);
    this.name = "ConsoleRejectedError";
    this.method = method;
  }
}

type ParamKind = "int" | "bool" | "block-id" | "txid";

export type ParamSpec = {
  name: string;
  kind: ParamKind;
  /** Optional params supply this when absent. Required params have no default. */
  default?: number | boolean | string;
  min?: number;
  max?: number;
  hint: string;
};

export type ConsoleMethod = {
  method: string;
  /** The capability key that gates it, so the UI can grey out what this node lacks. */
  capabilityKey: string;
  summary: string;
  /** What ZPulse itself uses this method for — the honest answer to "why is this here?". */
  usedFor: string;
  params: ParamSpec[];
};

/**
 * Verbosity 2 inlines every transaction. Capping it at 2 is not the interesting
 * limit; the interesting limit is that a caller cannot pass 3 and find out what
 * an unrecognised verbosity does to a hosted provider's rate limiter.
 */
const BLOCK_ID: ParamSpec = {
  name: "hashOrHeight",
  kind: "block-id",
  hint: "A block height, or a 64-character block hash",
};

export const CONSOLE_METHODS: ConsoleMethod[] = [
  {
    method: "getblockchaininfo",
    capabilityKey: "getblockchaininfo",
    summary: "Chain tip, difficulty, sync progress, value pools, upgrade map.",
    usedFor: "Almost everything. The value pools drive the supply panel; the upgrades map drives the timeline.",
    params: [],
  },
  {
    method: "getblockcount",
    capabilityKey: "getblockcount",
    summary: "Current block height, as a bare integer.",
    usedFor: "The landing page ticker — the cheapest possible live signal.",
    params: [],
  },
  {
    method: "getbestblockhash",
    capabilityKey: "getbestblockhash",
    summary: "Hash of the tip block.",
    usedFor: "Tip identity when a node does not return bestblockhash on getblockchaininfo.",
    params: [],
  },
  {
    method: "getblockhash",
    capabilityKey: "getblockhash",
    summary: "Height to block hash.",
    usedFor: "Walking a window of blocks on nodes that will not accept a height on getblock.",
    params: [{ name: "index", kind: "int", min: 0, hint: "Block height" }],
  },
  {
    method: "getblock",
    capabilityKey: "getblock",
    summary: "One block. Verbosity 1 includes per-pool value deltas; verbosity 2 inlines transactions.",
    usedFor: "The turnstile chart (valueDelta per pool) and the privacy mix (inline transactions).",
    params: [
      BLOCK_ID,
      { name: "verbosity", kind: "int", default: 1, min: 0, max: 2, hint: "0 raw hex, 1 summary, 2 with transactions" },
    ],
  },
  {
    method: "getblockheader",
    capabilityKey: "getblockheader",
    summary: "Block header only — cheaper than the block when all you want is the timestamp.",
    usedFor: "Measuring average block time for the upgrade ETA.",
    params: [BLOCK_ID, { name: "verbose", kind: "bool", default: true, hint: "false returns raw hex" }],
  },
  {
    method: "getrawtransaction",
    capabilityKey: "getrawtransaction",
    summary: "One transaction, by txid.",
    usedFor: "Privacy-mix fallback on nodes where getblock verbosity 2 is unavailable.",
    params: [
      { name: "txid", kind: "txid", hint: "64-character transaction id" },
      { name: "verbose", kind: "int", default: 1, min: 0, max: 1, hint: "0 raw hex, 1 decoded object" },
    ],
  },
  {
    method: "z_gettreestate",
    capabilityKey: "z_gettreestate",
    summary: "Shielded commitment tree roots at a block — the shielded state fingerprint.",
    usedFor: "Shown alongside pool balances as independent evidence of shielded state.",
    params: [BLOCK_ID],
  },
  {
    method: "getblocksubsidy",
    capabilityKey: "getblocksubsidy",
    summary: "Block subsidy split into miner, funding streams and lockbox streams.",
    usedFor: "Cross-checking ZPulse's own ZIP-208 issuance model against the node. See lib/analysis/supply.ts.",
    params: [{ name: "height", kind: "int", default: -1, min: -1, hint: "Block height, or -1 for the tip" }],
  },
  {
    method: "getrawmempool",
    capabilityKey: "getrawmempool",
    summary: "Mempool contents. Verbose adds per-transaction size and fee.",
    usedFor: "The mempool fallback: on an older zebrad without getmempoolinfo, size and bytes are summed from this instead.",
    params: [{ name: "verbose", kind: "bool", default: false, hint: "true returns an object with sizes" }],
  },
  {
    method: "getmempoolinfo",
    capabilityKey: "getmempoolinfo",
    summary: "Mempool size and bytes in one call.",
    usedFor: "The one-call mempool path. Current zebrad implements it; an older one answers -32601 and ZPulse sums getrawmempool instead.",
    params: [],
  },
  {
    method: "getpeerinfo",
    capabilityKey: "getpeerinfo",
    summary: "Connected peers, with subversion and ping times.",
    usedFor: "Peer count and the peer table on the node page.",
    params: [],
  },
  {
    method: "getnetworkinfo",
    capabilityKey: "getnetworkinfo",
    summary: "Connection count and node subversion.",
    usedFor: "The preferred version read. Current zebrad implements it; an older one answers -32601 and ZPulse falls back to getinfo.",
    params: [],
  },
  {
    method: "getnetworksolps",
    capabilityKey: "getnetworksolps",
    summary: "Network solution rate — Equihash solutions per second, not hashes.",
    usedFor: "The hashrate figure on the node page.",
    params: [
      { name: "blocks", kind: "int", default: 120, min: -1, max: 10_000, hint: "Blocks to average over, -1 for since last change" },
      { name: "height", kind: "int", default: -1, min: -1, hint: "Height to estimate at, -1 for the tip" },
    ],
  },
  {
    method: "getmininginfo",
    capabilityKey: "getmininginfo",
    summary: "Mining view of the chain: height, difficulty, solution rate.",
    usedFor: "Hashrate fallback when getnetworksolps is unavailable.",
    params: [],
  },
  {
    method: "getinfo",
    capabilityKey: "getinfo",
    summary: "Node version and build.",
    usedFor: "Identifying the node. Its subversion string is what the /node page classifies the implementation by — read from the node, never guessed from which methods are missing.",
    params: [],
  },
];

const BY_METHOD = new Map(CONSOLE_METHODS.map((entry) => [entry.method, entry]));

export function consoleMethod(method: string): ConsoleMethod | null {
  return BY_METHOD.get(method) ?? null;
}

/* ── validation ──────────────────────────────────────────────────────────── */

const HEX64 = /^[0-9a-fA-F]{64}$/;

function validateOne(spec: ParamSpec, raw: unknown, method: string): unknown {
  switch (spec.kind) {
    case "int": {
      const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new ConsoleRejectedError(`"${spec.name}" must be a number.`, method);
      }
      const int = Math.floor(value);
      if (spec.min !== undefined && int < spec.min) {
        throw new ConsoleRejectedError(`"${spec.name}" must be at least ${spec.min}.`, method);
      }
      if (spec.max !== undefined && int > spec.max) {
        throw new ConsoleRejectedError(`"${spec.name}" must be at most ${spec.max}.`, method);
      }
      return int;
    }

    case "bool": {
      if (typeof raw === "boolean") return raw;
      if (raw === "true") return true;
      if (raw === "false") return false;
      throw new ConsoleRejectedError(`"${spec.name}" must be true or false.`, method);
    }

    case "block-id": {
      // Nodes accept a height as a string here, and a hash as a string. Numbers
      // are stringified rather than rejected, because a height is what a user
      // will type, and a node wants it quoted.
      const value = typeof raw === "number" ? String(Math.floor(raw)) : raw;
      if (typeof value !== "string" || value.trim() === "") {
        throw new ConsoleRejectedError(`"${spec.name}" must be a height or a block hash.`, method);
      }
      const trimmed = value.trim();
      if (/^\d+$/.test(trimmed)) return trimmed;
      if (HEX64.test(trimmed)) return trimmed.toLowerCase();
      throw new ConsoleRejectedError(
        `"${spec.name}" must be a decimal height or a 64-character hex hash.`,
        method,
      );
    }

    case "txid": {
      if (typeof raw !== "string" || !HEX64.test(raw.trim())) {
        throw new ConsoleRejectedError(`"${spec.name}" must be a 64-character hex transaction id.`, method);
      }
      return raw.trim().toLowerCase();
    }
  }
}

/**
 * Validate a console request and return the exact positional params to forward.
 *
 * Throws `ConsoleRejectedError` for anything unrecognised — including an unknown
 * method name, which is the check that makes the allowlist an allowlist.
 */
export function validateConsoleCall(
  method: unknown,
  params: unknown,
): { method: string; params: unknown[]; spec: ConsoleMethod } {
  if (typeof method !== "string" || method.trim() === "") {
    throw new ConsoleRejectedError("No method given.", "");
  }

  const name = method.trim();
  const spec = BY_METHOD.get(name);
  if (!spec) {
    throw new ConsoleRejectedError(
      `"${name}" is not on the read-only allowlist. ZPulse can only call the ${CONSOLE_METHODS.length} methods it uses itself; nothing that spends, signs or stops the node is reachable from here.`,
      name,
    );
  }

  if (params !== undefined && params !== null && !Array.isArray(params)) {
    throw new ConsoleRejectedError("Params must be an array of positional arguments.", name);
  }

  const supplied: unknown[] = Array.isArray(params) ? params : [];
  if (supplied.length > spec.params.length) {
    throw new ConsoleRejectedError(
      `${name} takes at most ${spec.params.length} param(s); ${supplied.length} given.`,
      name,
    );
  }

  const out: unknown[] = [];
  for (let index = 0; index < spec.params.length; index += 1) {
    const paramSpec = spec.params[index] as ParamSpec;
    const raw = supplied[index];
    const absent = index >= supplied.length || raw === undefined || raw === null || raw === "";

    if (absent) {
      if (paramSpec.default === undefined) {
        throw new ConsoleRejectedError(`${name} requires "${paramSpec.name}".`, name);
      }
      out.push(paramSpec.default);
      continue;
    }

    out.push(validateOne(paramSpec, raw, name));
  }

  // Drop trailing params the caller did not ask for and that match the default,
  // so the envelope shown in the console is the minimal one a node would accept.
  while (out.length > 0 && out.length > supplied.length) out.pop();

  return { method: name, params: out, spec };
}

/* ── anti-drift check ────────────────────────────────────────────────────── */

/**
 * Methods this table and the capability probe table disagree about.
 *
 * Called by scripts/verify.mjs. A non-empty result means someone added a method
 * to one table and not the other: either the console offers something the app
 * never probes (so the UI cannot grey it out), or the app probes something the
 * console cannot run (so the console misrepresents what ZPulse uses).
 */
export function consoleAllowlistDrift(): { consoleOnly: string[]; probeOnly: string[] } {
  const probed = new Set(knownMethods());
  const listed = new Set(CONSOLE_METHODS.map((entry) => entry.method));
  return {
    consoleOnly: [...listed].filter((method) => !probed.has(method)).sort(),
    probeOnly: [...probed].filter((method) => !listed.has(method)).sort(),
  };
}
