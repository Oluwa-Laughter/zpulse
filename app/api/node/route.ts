/**
 * GET /api/node — sync state, peers, mempool, hashrate, and ZPulse's own metrics.
 *
 * This is the route where the dialect layer earns its keep. Against zcashd the
 * mempool comes from `getmempoolinfo` and the version from `getnetworkinfo`;
 * against Zebra neither method exists, and the same fields arrive via
 * `getrawmempool` and `getinfo`. The response's `meta.via` names whichever
 * methods actually ran, so the answer to "which RPC methods is this using?" is
 * visible in the payload rather than only in the source.
 */

import { getNode } from "@/lib/data";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Promise<Response> {
  return handle(getNode);
}
