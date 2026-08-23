/**
 * GET /api/node — sync state, peers, mempool, hashrate, and ZPulse's own metrics.
 *
 * This is the route where the dialect layer earns its keep. On a current zebrad
 * the mempool comes from `getmempoolinfo` and the version from `getnetworkinfo`,
 * one call each. On a zebrad old enough to predate either, both are -32601 and
 * the same fields arrive from `getrawmempool` and `getinfo` instead. The
 * response's `meta.via` names whichever methods actually ran, so the answer to
 * "which RPC methods is this using?" is visible in the payload rather than only
 * in the source.
 */

import { getNode } from "@/lib/data";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Promise<Response> {
  return handle(getNode);
}
