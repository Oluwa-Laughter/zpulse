/**
 * GET /api/chain — the tip.
 *
 * `force-dynamic` on every route in this app, and it matters: without it Next
 * would try to prerender these at build time, baking one moment's blockchain
 * state into the bundle. A "live blockchain data" app that ships a snapshot from
 * build time is the worst possible failure here, because it looks like it works.
 */

import { getChain } from "@/lib/data";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Promise<Response> {
  return handle(getChain);
}
