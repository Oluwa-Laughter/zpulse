/**
 * GET /api/upgrades — the network upgrade timeline.
 *
 * Built entirely from the `upgrades` map that already rides along on the cached
 * `getblockchaininfo`, so this endpoint usually costs zero extra RPC calls. Each
 * pending entry carries a `confidence` field saying whether its ETA came from a
 * measured average block time or from the 75-second consensus target.
 */

import { getUpgrades } from "@/lib/data";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Promise<Response> {
  return handle(getUpgrades);
}
