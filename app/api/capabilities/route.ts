/**
 * GET /api/capabilities — what this node actually implements.
 *
 * Worth having as a public endpoint rather than internal state: it is the direct
 * answer to "did you really integrate with RPC, or hardcode plausible numbers?".
 * Every entry is the recorded result of an actual probe against the configured
 * node, and the `dialect` field is ZPulse's guess at which implementation
 * answered — derived from which methods exist, not from a version string.
 *
 * The deployment config is folded in because the RPC console needs both, and
 * `describeConfig()` is careful to return the endpoint host only, never the URL
 * (hosted providers put the access token in the path).
 */

import { describeConfig, getCapabilities } from "@/lib/data";
import { handle } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(): Promise<Response> {
  return handle(async () => {
    const envelope = await getCapabilities();
    return {
      data: { ...envelope.data, config: describeConfig() },
      meta: envelope.meta,
    };
  });
}
