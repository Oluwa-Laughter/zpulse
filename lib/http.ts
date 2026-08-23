/**
 * Route-handler plumbing.
 *
 * The route files under app/api/ should be short enough to read at a glance —
 * parse a query param, call one function from lib/data.ts, return it. Everything
 * that is the same for all of them lives here.
 *
 * Three decisions worth stating:
 *
 * 1. **`Cache-Control: no-store` on every response.** That looks wrong for a
 *    read-only API, and it is deliberate. The request-saving happens in
 *    lib/cache.ts, server-side, where it is shared across every visitor. An HTTP
 *    cache in front of that would serve a stale body whose own `meta.ageMs`
 *    claims it is fresh — the response would be lying about itself. So the
 *    browser always asks, and the server cache almost always answers for free.
 *
 * 2. **Errors keep the envelope shape.** A failure returns `meta` too, with
 *    `degraded: true` and the reason in `notes`. The client renders one thing
 *    whether the call worked or not, and never has to branch on HTTP status to
 *    know what to show.
 *
 * 3. **Error bodies are built from `describeRpcError`, never from the raw error.**
 *    A hosted provider puts its access token in the URL path, and a transport
 *    error's message can contain that URL. `describeRpcError` is the only thing
 *    allowed to produce a user-facing string, and it is written to keep the URL
 *    out.
 */

import { describeConfig } from "./data";
import type { Envelope, Meta } from "./data";
import {
  RpcAuthError,
  RpcConfigError,
  RpcHttpError,
  RpcTimeoutError,
  RpcTransportError,
  RpcUnsupportedError,
  describeRpcError,
} from "./rpc/errors";

const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  // See note 1 above.
  "cache-control": "no-store, max-age=0, must-revalidate",
};

export type ErrorBody = {
  data: null;
  error: { kind: string; message: string };
  meta: Meta;
};

/** Serialise a successful envelope. */
export function okJson<T>(envelope: Envelope<T>, status = 200): Response {
  return new Response(JSON.stringify(envelope), { status, headers: JSON_HEADERS });
}

/**
 * Map a failure to an HTTP status.
 *
 * These are all 5xx on purpose. The browser did nothing wrong: the node we
 * depend on did, or we are misconfigured. A 4xx here would tell a caller to fix
 * their request, which is never the right advice for these.
 */
function statusFor(err: unknown): number {
  if (err instanceof RpcConfigError) return 503; // nothing to talk to
  if (err instanceof RpcUnsupportedError) return 501; // node lacks the method
  if (err instanceof RpcTimeoutError) return 504;
  if (err instanceof RpcAuthError) return 502; // our credentials, not the caller's
  if (err instanceof RpcHttpError) return 502;
  if (err instanceof RpcTransportError) return 502;
  return 500;
}

function kindFor(err: unknown): string {
  if (err instanceof Error && err.name) return err.name;
  return "Error";
}

/** Serialise a failure, keeping the envelope shape so clients need no second branch. */
export function errorJson(err: unknown): Response {
  const message = describeRpcError(err);
  let config: { mode: "live" | "demo"; endpoint: string };
  try {
    const described = describeConfig();
    config = { mode: described.mode, endpoint: described.endpoint };
  } catch {
    // describeConfig itself throws when the endpoint is unparseable, which is
    // one of the failures this function has to be able to report.
    config = { mode: "live", endpoint: "unconfigured" };
  }

  const body: ErrorBody = {
    data: null,
    error: { kind: kindFor(err), message },
    meta: {
      source: config.mode === "demo" ? "demo" : "live",
      endpoint: config.endpoint,
      mode: config.mode,
      cachedAt: Date.now(),
      ageMs: 0,
      degraded: true,
      notes: [message],
      via: [],
    },
  };

  return new Response(JSON.stringify(body), { status: statusFor(err), headers: JSON_HEADERS });
}

/**
 * Wrap a handler so no route can throw an unshaped 500 at the browser.
 *
 * Route handlers that skip this and let an exception escape get Next's default
 * error page — an HTML body from a JSON endpoint, which the client's `.json()`
 * then fails to parse, turning a legible node error into an unrelated syntax
 * error. Hence: every route goes through here.
 */
export async function handle<T>(fn: () => Promise<Envelope<T>>): Promise<Response> {
  try {
    return okJson(await fn());
  } catch (err) {
    return errorJson(err);
  }
}

/**
 * Build a `Meta` for a response that did not come through lib/data.ts.
 *
 * Only the RPC console needs this: it executes one arbitrary allowlisted method
 * rather than composing a panel, so there is no `Resolved` chain to merge. The
 * envelope shape stays identical so the client renders it the same way.
 */
export function directMeta(options: {
  via: string[];
  notes?: string[];
  source?: "live" | "cache" | "demo";
  cachedAt?: number;
}): Meta {
  const config = describeConfig();
  const notes = options.notes ?? [];
  const cachedAt = options.cachedAt ?? Date.now();
  return {
    source: options.source ?? (config.mode === "demo" ? "demo" : "live"),
    endpoint: config.endpoint,
    mode: config.mode,
    cachedAt,
    ageMs: Math.max(0, Date.now() - cachedAt),
    degraded: notes.length > 0,
    notes,
    via: options.via,
  };
}

/**
 * 400 for a request we refused to make.
 *
 * Distinct from `errorJson`'s 5xx family on purpose: a rejected console call is
 * the caller's request being wrong — an unknown method, a malformed hash — and
 * fixing it is something they can actually do. The node was never contacted.
 */
export function rejectedJson(message: string, kind = "ConsoleRejectedError"): Response {
  const body: ErrorBody = {
    data: null,
    error: { kind, message },
    meta: directMeta({ via: [], notes: [message] }),
  };
  return new Response(JSON.stringify(body), { status: 400, headers: JSON_HEADERS });
}

/** 429, with the `Retry-After` header a well-behaved client will honour. */
export function rateLimitedJson(message: string, retryAfterMs: number): Response {
  const body: ErrorBody = {
    data: null,
    error: { kind: "RateLimited", message },
    meta: directMeta({ via: [], notes: [message] }),
  };
  return new Response(JSON.stringify(body), {
    status: 429,
    headers: { ...JSON_HEADERS, "retry-after": String(Math.ceil(retryAfterMs / 1000)) },
  });
}

/** Read a positive integer query param. Returns null when absent or unusable. */
export function intParam(request: Request, name: string): number | null {
  const raw = new URL(request.url).searchParams.get(name);
  if (raw === null || raw.trim() === "") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
}

/** Read a boolean query param, accepting the usual spellings. */
export function boolParam(request: Request, name: string): boolean {
  const raw = new URL(request.url).searchParams.get(name);
  if (raw === null) return false;
  return raw === "" || /^(1|true|yes|on)$/i.test(raw);
}
