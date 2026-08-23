/**
 * GET /api/height — just the height.
 *
 * A separate route from /api/chain rather than a field on it, because the landing
 * page ticker polls this every 20 seconds and has no use for difficulty, value
 * pools or the upgrades map. One `getblockcount` is the smallest live signal the
 * network offers; making the ticker pay for a `getblockchaininfo` would be the
 * single easiest way to waste the request quota.
 */

import { getHeight } from "@/lib/data";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Promise<Response> {
  return handle(getHeight);
}
