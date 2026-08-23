/**
 * GET /api/pools — value pool balances and the issuance reconciliation.
 *
 * The centrepiece endpoint. The response carries three kinds of number and
 * labels which is which: `reported` came off the node, `modelled` is ZPulse's own
 * ZIP-208 arithmetic, `derived` is one subtracted from the other. It also carries
 * `subsidyCheck`, which compares the model against the node's own
 * `getblocksubsidy` — a check the model cannot grade itself on.
 */

import { getPools } from "@/lib/data";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Promise<Response> {
  return handle(getPools);
}
