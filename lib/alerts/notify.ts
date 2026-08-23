/**
 * Alert delivery.
 *
 * Two sinks, both optional: a Discord webhook (the Zcash community lives on
 * Discord, so this is the one people will actually configure) and a generic JSON
 * POST for anything else. With neither configured, alerts are logged and the app
 * says so on the node page rather than pretending to deliver them.
 *
 * Ported from the prototype's `lib/notify.js`. Three things added, each because
 * the original would have failed in a way that is hard to notice:
 *
 *  - **A timeout.** `fetch` to a webhook has no default timeout, so an
 *    unresponsive endpoint would hang the poller tick indefinitely, and the next
 *    tick behind it.
 *  - **Failures are returned, not just logged.** The poll route puts them in its
 *    response, so a misconfigured webhook is visible without reading server logs.
 *  - **Webhook URLs are never echoed.** A Discord webhook URL is a credential;
 *    its token is in the path. Failures name the sink ("discord"), not the URL.
 */

import type { Alert } from "./rules";

const WEBHOOK_TIMEOUT_MS = 5_000;

export type NotifyResult = {
  /** Sinks that accepted the message. */
  delivered: string[];
  /** Sinks that failed, with a reason safe to display. */
  failed: Array<{ sink: string; reason: string }>;
  /** True when nothing is configured, so the alert exists only in the log. */
  logOnly: boolean;
};

function line(alert: Alert, resolved: boolean): string {
  if (resolved) return `✅ Resolved — ${alert.message}`;
  const mark = alert.severity === "critical" ? "🚨" : "⚠️";
  return `${mark} ZPulse — ${alert.message}`;
}

async function post(url: string, body: unknown): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      // Status only. The body of a rejected Discord request can echo the request,
      // and the response text of an arbitrary webhook is not ours to log.
      throw new Error(`HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deliver one transition.
 *
 * Never throws. A poller tick that fails to send an alert must still record its
 * snapshot — losing the history because a webhook was down would be a worse
 * outcome than losing the notification.
 */
export async function notify(alert: Alert, resolved: boolean): Promise<NotifyResult> {
  const text = line(alert, resolved);
  const discordUrl = process.env.ZPULSE_ALERT_DISCORD_WEBHOOK?.trim();
  const genericUrl = process.env.ZPULSE_ALERT_WEBHOOK?.trim();

  // Always logged, so a deployment with no webhooks still leaves a trail.
  console.log(`[zpulse:alert] ${text}`);

  const delivered: string[] = [];
  const failed: Array<{ sink: string; reason: string }> = [];

  if (discordUrl) {
    try {
      await post(discordUrl, { content: text });
      delivered.push("discord");
    } catch (err) {
      failed.push({ sink: "discord", reason: reasonFor(err) });
    }
  }

  if (genericUrl) {
    try {
      await post(genericUrl, {
        id: alert.id,
        severity: alert.severity,
        message: alert.message,
        resolved,
        at: new Date().toISOString(),
        source: "zpulse",
      });
      delivered.push("webhook");
    } catch (err) {
      failed.push({ sink: "webhook", reason: reasonFor(err) });
    }
  }

  return { delivered, failed, logOnly: !discordUrl && !genericUrl };
}

function reasonFor(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === "AbortError") return `no response within ${WEBHOOK_TIMEOUT_MS / 1000}s`;
    return err.message;
  }
  return "unknown error";
}

/** Which sinks are configured. Rendered on the node page; no URLs, they are credentials. */
export function describeSinks(): { discord: boolean; webhook: boolean } {
  return {
    discord: Boolean(process.env.ZPULSE_ALERT_DISCORD_WEBHOOK?.trim()),
    webhook: Boolean(process.env.ZPULSE_ALERT_WEBHOOK?.trim()),
  };
}
