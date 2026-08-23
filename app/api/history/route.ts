/**
 * GET /api/history?limit=N — the poller's time series.
 *
 * Read-only and unauthenticated: these are the same public chain figures every
 * other endpoint returns, just with timestamps. The write side lives at
 * /api/cron/poll and is secret-guarded.
 *
 * The response includes the store's own description — which implementation is in
 * use and whether it is durable. That matters because on a read-only filesystem
 * the store silently falls back to memory, and a node page that showed an empty
 * sparkline without saying why would look like a bug in the poller.
 */

import { describeSinks } from "@/lib/alerts/notify";
import { alertThresholds, evaluateAlerts } from "@/lib/alerts/rules";
import { directMeta, handle, intParam } from "@/lib/http";
import { HISTORY_READ_DEFAULT, historyStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request): Promise<Response> {
  const limit = intParam(request, "limit") ?? HISTORY_READ_DEFAULT;

  return handle(async () => {
    const store = historyStore();
    const [snapshots, description] = await Promise.all([store.recent(limit), store.describe()]);

    // Re-evaluate against the newest row so the page shows what is wrong *now*,
    // not what was wrong when the poller last wrote. These are the same pure rule
    // functions the poller uses; nothing is duplicated.
    const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
    const active = latest ? evaluateAlerts(latest, snapshots.slice(0, -1)) : {};

    const notes: string[] = [];
    if (snapshots.length === 0) {
      notes.push(
        'No history yet. Run "npm run poll" alongside the dev server, or point a scheduler at /api/cron/poll.',
      );
    }
    if (!description.durable && description.note) notes.push(description.note);

    return {
      data: {
        snapshots,
        alerts: Object.values(active),
        thresholds: alertThresholds(),
        sinks: describeSinks(),
        store: description,
      },
      meta: directMeta({ via: [], notes, source: "cache", cachedAt: latest?.at ?? Date.now() }),
    };
  });
}
