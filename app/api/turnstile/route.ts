/**
 * GET /api/turnstile?blocks=N — per-block value movement between shielded pools.
 *
 * `blocks` is clamped in lib/data.ts, not here, so the limit holds for every
 * caller of `getTurnstile` rather than only for ones that arrive over HTTP. The
 * clamp is not politeness: this walks one `getblock` per block, so an unclamped
 * `?blocks=100000` would be a request-quota grenade with a query string on it.
 */

import { getTurnstile } from "@/lib/data";
import { handle, intParam } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  const blocks = intParam(request, "blocks");
  return handle(() => getTurnstile(blocks ?? undefined));
}
