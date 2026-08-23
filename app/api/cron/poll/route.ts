/**
 * The poller tick.  POST (or GET) /api/cron/poll
 *
 * Takes one snapshot, evaluates the alert rules against it, notifies on
 * transitions, and appends the row. Designed to be driven by anything that can
 * make an HTTP request on a schedule: `npm run poll` in development, a platform
 * cron in production, or curl from a shell loop.
 *
 * **Why this is guarded and the read routes are not.** Everything /api/chain
 * returns is public chain data, so an extra reader costs a cached response. This
 * route is different in two ways: each call spends real RPC requests against a
 * finite quota, and each call can fire a webhook. An open endpoint that does both
 * is an amplifier pointed at someone else's node and someone else's Discord.
 *
 * So: if `ZPULSE_CRON_SECRET` is set, it must be presented. If it is *not* set,
 * the route only answers from localhost — because the alternative designs are
 * both bad. Failing closed would break `npm run poll` for anyone who has not read
 * the env docs, and failing open would leave a public amplifier in the default
 * configuration. Localhost-only is the version that is safe by default and still
 * works out of the box.
 *
 * GET is accepted as well as POST because several platform schedulers can only
 * issue GET. It is not idempotent, which normally argues against GET — but a
 * duplicate tick appends one extra row and costs a few cached RPC reads, so the
 * cost of being wrong here is a rounding error against the cost of the endpoint
 * being unreachable from the scheduler someone actually has.
 */

import { timingSafeEqual } from "node:crypto";
import { notify, type NotifyResult } from "@/lib/alerts/notify";
import { diffAlerts, evaluateAlerts, type Alert } from "@/lib/alerts/rules";
import { takeSnapshot } from "@/lib/data";
import { directMeta, okJson, rejectedJson } from "@/lib/http";
import { historyStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** How much history the rules need. The stall check looks back ~20 minutes. */
const RULE_HISTORY_ROWS = 60;

function isLoopback(request: Request): boolean {
  // Behind a proxy, x-forwarded-for is present and its first hop is the real
  // client; a request that genuinely originated on this host has no such header.
  // Treating "no forwarding header" as local is the reliable direction to guess:
  // it can only be wrong for a proxy that strips the header, which would fail
  // closed (403) rather than open.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim() ?? "";
    return first === "127.0.0.1" || first === "::1" || first === "localhost";
  }

  const host = request.headers.get("host") ?? "";
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function authorise(request: Request): string | null {
  const secret = process.env.ZPULSE_CRON_SECRET?.trim();

  if (secret) {
    const header = request.headers.get("authorization")?.trim() ?? "";
    const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
    const supplied = bearer || (request.headers.get("x-zpulse-cron-secret")?.trim() ?? "");
    if (!secretsMatch(supplied, secret)) {
      return "This tick was not authorised. Send the ZPULSE_CRON_SECRET as an Authorization: Bearer header.";
    }
    return null;
  }

  if (!isLoopback(request)) {
    return "No ZPULSE_CRON_SECRET is configured, so this endpoint only answers on localhost. Set the variable to allow a remote scheduler to drive it.";
  }
  return null;
}

/**
 * Constant-time comparison.
 *
 * A timing attack against an HTTP endpoint over a network is not a realistic
 * threat to this app, but `timingSafeEqual` costs one import and removes the
 * question. Lengths are compared first because the function throws on a mismatch,
 * and length is not the secret.
 */
function secretsMatch(supplied: string, secret: string): boolean {
  const a = Buffer.from(supplied);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function tick(request: Request): Promise<Response> {
  const denial = authorise(request);
  if (denial) return rejectedJson(denial, "Unauthorized");

  const store = historyStore();

  // History is read before the snapshot so the rules see the state *preceding*
  // this tick. Reading it after would put the new row in its own lookback window.
  const history = await store.recent(RULE_HISTORY_ROWS).catch(() => []);
  const previousIds = history.length > 0 ? (history[history.length - 1]?.alerts ?? []) : [];

  const snapshot = await takeSnapshot();
  const active = evaluateAlerts(snapshot, history);
  const transitions = diffAlerts(previousIds, active);

  // The row records which alerts were active, so the next tick can tell an
  // ongoing alert from a new one even across a restart.
  snapshot.alerts = Object.keys(active).sort();
  await store.append(snapshot);

  const deliveries: Array<{
    alert: Alert;
    resolved: boolean;
    result: NotifyResult;
  }> = [];
  for (const alert of transitions.started) {
    deliveries.push({ alert, resolved: false, result: await notify(alert, false) });
  }
  for (const alert of transitions.cleared) {
    deliveries.push({ alert, resolved: true, result: await notify(alert, true) });
  }

  const notes: string[] = [];
  if (snapshot.error) notes.push(snapshot.error);
  for (const delivery of deliveries) {
    for (const failure of delivery.result.failed) {
      notes.push(`Alert delivery to ${failure.sink} failed: ${failure.reason}`);
    }
  }

  return okJson({
    data: {
      snapshot,
      active: Object.values(active),
      started: transitions.started,
      cleared: transitions.cleared,
      deliveries: deliveries.map((delivery) => ({
        id: delivery.alert.id,
        resolved: delivery.resolved,
        delivered: delivery.result.delivered,
        failed: delivery.result.failed,
        logOnly: delivery.result.logOnly,
      })),
    },
    meta: directMeta({ via: [], notes, cachedAt: snapshot.at }),
  });
}

export function POST(request: Request): Promise<Response> {
  return tick(request);
}

export function GET(request: Request): Promise<Response> {
  return tick(request);
}
