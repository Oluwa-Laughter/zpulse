/**
 * GET /api/privacy?blocks=N — how shielded the recent chain actually is.
 *
 * The most expensive panel, hence the smaller default window and the tighter
 * clamp: one `getblock` at verbosity 2 per block where the node supports it, and
 * 1+N calls per block where it does not. Blocks are immutable, so a window that
 * has been fetched once is nearly free to re-render.
 */

import { getPrivacy } from "@/lib/data";
import { handle, intParam } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  const blocks = intParam(request, "blocks");
  return handle(() => getPrivacy(blocks ?? undefined));
}
