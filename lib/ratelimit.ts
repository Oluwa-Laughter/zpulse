/**
 * In-process rate limiting for the RPC console.
 *
 * Be clear about what this is and is not. It is a fixed-window counter in a Map,
 * living in one Node process. It does not survive a restart, it is not shared
 * across serverless instances, and a determined caller can defeat the per-client
 * bucket by rotating `x-forwarded-for`.
 *
 * It is here for one specific job, and it does that job: the console lets a
 * visitor drive real requests at a hosted node whose free tier is finite. An
 * open text field wired to someone else's request quota needs a ceiling, and the
 * ceiling that matters is the *global* one — that bucket cannot be rotated around
 * because it is not keyed on anything the caller controls. The per-client bucket
 * is the softer courtesy limit on top, so one tab cannot starve another.
 *
 * If ZPulse were deployed for real, this would move to the provider's own quota
 * controls or a shared store. For a single-instance deployment it is the honest
 * amount of machinery.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

/** Drop expired windows so the Map cannot grow without bound. */
function sweep(now: number): void {
  if (windows.size < 256) return;
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  /** Requests left in the current window. */
  remaining: number;
  /** Milliseconds until the window resets. */
  retryAfterMs: number;
  limit: number;
};

export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const existing = windows.get(key);
  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterMs: windowMs, limit };
  }

  existing.count += 1;
  const retryAfterMs = Math.max(0, existing.resetAt - now);

  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfterMs, limit };
  }

  return { allowed: true, remaining: limit - existing.count, retryAfterMs, limit };
}

/**
 * A best-effort client identity.
 *
 * `x-forwarded-for` is spoofable, which is why the global bucket exists and why
 * this is only used for the per-client courtesy limit. The first hop is taken
 * because that is the original client when a trusted proxy appends; behind an
 * untrusted proxy it is whatever the caller sent, and we accept that.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Test seam. */
export function resetRateLimits(): void {
  windows.clear();
}
