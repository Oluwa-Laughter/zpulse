/**
 * The RPC console endpoint.
 *
 *   GET  /api/rpc — the allowlist and the chained recipes, so the UI can build
 *                   its form from the same table the server validates against.
 *   POST /api/rpc — execute one allowlisted method and return the exact JSON-RPC
 *                   envelope that was sent alongside the node's reply.
 *
 * Everything security-relevant about this route is in lib/rpc/console.ts, which
 * holds the allowlist and the per-param validators. This file's job is the order
 * of operations, and that order is deliberate:
 *
 *   1. rate limit  — before parsing, so a flood costs the cheapest possible work
 *   2. parse body  — malformed JSON is rejected without touching the allowlist
 *   3. validate    — an unknown method dies here, having contacted nothing
 *   4. execute     — only now does a request reach the node
 *
 * Returning the sent envelope is not decoration either. The console's purpose is
 * to show that ZPulse speaks JSON-RPC rather than proxying somebody's REST API,
 * and the way to show that is to print the `{jsonrpc, id, method, params}` object
 * that went over the wire next to what came back.
 */

import { getCapabilities } from "@/lib/data";
import { directMeta, errorJson, handle, okJson, rateLimitedJson, rejectedJson } from "@/lib/http";
import { checkRateLimit, clientKey } from "@/lib/ratelimit";
import { buildEnvelope, rpcCallTimed } from "@/lib/rpc/client";
import { CONSOLE_METHODS, ConsoleRejectedError, validateConsoleCall } from "@/lib/rpc/console";
import { describeRpcError } from "@/lib/rpc/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Chained sequences, each showing a real dependency between calls rather than
 * three unrelated methods in a row. The client runs them a step at a time,
 * substituting `$prev` with the previous step's result — which keeps the chaining
 * logic out of the server and means every step is an ordinary validated call.
 */
const RECIPES = [
  {
    id: "tip-to-block",
    title: "Walk from the tip to a whole block",
    why: "Height alone proves a connection. Turning it into a hash and then into a block with per-pool value deltas is what the turnstile panel does on every refresh.",
    steps: [
      { method: "getblockcount", params: [] as unknown[], use: "The tip height." },
      { method: "getblockhash", params: ["$prev"], use: "That height's block hash." },
      { method: "getblock", params: ["$prev", 1], use: "The block, including valuePools deltas." },
    ],
  },
  {
    id: "shielded-state",
    title: "Read the shielded state two independent ways",
    why: "Pool balances and commitment tree roots are separate views of the same shielded state. Seeing both is the closest a read-only client gets to verifying it.",
    steps: [
      { method: "getblockchaininfo", params: [] as unknown[], use: "Cumulative balance per value pool." },
      { method: "getblockcount", params: [], use: "The height to anchor the trees at." },
      { method: "z_gettreestate", params: ["$prev"], use: "Commitment tree root per pool at that height." },
    ],
  },
  {
    id: "issuance-check",
    title: "Check ZPulse's issuance model against the node",
    why: "lib/analysis/supply.ts computes the block subsidy from the ZIP-208 schedule. This asks the node for its own answer, which is the one number the model cannot grade itself on.",
    steps: [
      { method: "getblockcount", params: [] as unknown[], use: "The tip height." },
      { method: "getblocksubsidy", params: ["$prev"], use: "Miner, funding-stream and lockbox split at that height." },
    ],
  },
  {
    id: "dialect-tell",
    title: "Find out which node implementation this is",
    why: "getmempoolinfo and getnetworkinfo exist on zcashd and not on Zebra. Whichever of these fails with -32601 tells you what you are talking to — and is exactly the failure the dialect layer routes around.",
    steps: [
      { method: "getinfo", params: [] as unknown[], use: "Version. Both dialects answer this." },
      { method: "getmempoolinfo", params: [], use: "zcashd only. Expect -32601 on Zebra." },
      { method: "getrawmempool", params: [true], use: "The Zebra-compatible path to the same information." },
    ],
  },
] as const;

/** Per-client courtesy limit, and the global ceiling that protects the quota. */
const CLIENT_LIMIT = 30;
const GLOBAL_LIMIT = 180;
const WINDOW_MS = 60_000;

export function GET(): Promise<Response> {
  return handle(async () => {
    const capabilities = await getCapabilities();
    return {
      data: {
        methods: CONSOLE_METHODS,
        recipes: RECIPES,
        capabilities: capabilities.data,
        limits: { perClient: CLIENT_LIMIT, global: GLOBAL_LIMIT, windowMs: WINDOW_MS },
      },
      meta: capabilities.meta,
    };
  });
}

export async function POST(request: Request): Promise<Response> {
  // 1. Rate limit first — cheapest possible rejection.
  const perClient = checkRateLimit(`rpc:${clientKey(request)}`, CLIENT_LIMIT, WINDOW_MS);
  if (!perClient.allowed) {
    return rateLimitedJson(
      `Too many console calls from this client — ${CLIENT_LIMIT} per minute. This limit exists because the console drives real requests at a node with a finite quota.`,
      perClient.retryAfterMs,
    );
  }

  const global = checkRateLimit("rpc:global", GLOBAL_LIMIT, WINDOW_MS);
  if (!global.allowed) {
    return rateLimitedJson(
      `The console is at its global limit of ${GLOBAL_LIMIT} calls per minute. Every other panel keeps working — this ceiling only applies to hand-issued calls.`,
      global.retryAfterMs,
    );
  }

  // 2. Parse.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rejectedJson("Request body was not valid JSON.", "BadRequest");
  }
  if (typeof body !== "object" || body === null) {
    return rejectedJson('Expected a JSON object with a "method" field.', "BadRequest");
  }

  const { method: rawMethod, params: rawParams } = body as { method?: unknown; params?: unknown };

  // 3. Validate against the allowlist. An unknown method never reaches step 4.
  let call: ReturnType<typeof validateConsoleCall>;
  try {
    call = validateConsoleCall(rawMethod, rawParams);
  } catch (err) {
    if (err instanceof ConsoleRejectedError) return rejectedJson(err.message);
    return errorJson(err);
  }

  // 4. Execute. The envelope is built before the call so it can be returned even
  // when the call fails — seeing what was sent is most useful when it did not work.
  const envelope = buildEnvelope(call.method, call.params);

  try {
    const response = await rpcCallTimed(call.method, call.params);
    return okJson({
      data: {
        request: envelope,
        result: response.result,
        latencyMs: response.latencyMs,
        method: call.method,
        params: call.params,
        summary: call.spec.summary,
        usedFor: call.spec.usedFor,
        ok: true,
      },
      meta: directMeta({ via: [call.method], source: response.source }),
    });
  } catch (err) {
    // A node saying "no" is a legitimate console result, not a server failure —
    // the dialect-tell recipe above depends on being able to show a -32601. So
    // this returns 200 with `ok: false` rather than a 5xx, and the UI renders the
    // error where it would have rendered the result.
    return okJson({
      data: {
        request: envelope,
        result: null,
        latencyMs: null,
        method: call.method,
        params: call.params,
        summary: call.spec.summary,
        usedFor: call.spec.usedFor,
        ok: false,
        error: { kind: err instanceof Error ? err.name : "Error", message: describeRpcError(err) },
      },
      meta: directMeta({ via: [call.method], notes: [describeRpcError(err)] }),
    });
  }
}
