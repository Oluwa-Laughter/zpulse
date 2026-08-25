/**
 * Typed RPC failures.
 *
 * The point of having distinct classes rather than bare Error strings: the
 * dialect layer needs to tell "this node does not implement that method"
 * (recoverable — try another method, or degrade this one panel) apart from
 * "the node is unreachable" (not recoverable — say so on screen). Those two
 * are indistinguishable if everything is a string match on `err.message`,
 * which is how the previous prototype handled it.
 */

/** Base class so callers can catch every RPC failure in one clause. */
export class RpcError extends Error {
  readonly method: string;

  constructor(message: string, method: string) {
    super(message);
    this.name = new.target.name;
    this.method = method;
  }
}

/** No endpoint configured, or configured incoherently. A setup problem, not a network one. */
export class RpcConfigError extends RpcError {}

/** The node answered, but does not implement this method (JSON-RPC code -32601). */
export class RpcUnsupportedError extends RpcError {
  constructor(method: string) {
    super(`Node does not implement "${method}"`, method);
  }
}

/** The node answered with a JSON-RPC error object. */
export class RpcMethodError extends RpcError {
  readonly code: number | undefined;

  constructor(message: string, method: string, code?: number) {
    super(message, method);
    this.code = code;
  }
}

/** Non-2xx HTTP response. */
export class RpcHttpError extends RpcError {
  readonly status: number;

  constructor(message: string, method: string, status: number) {
    super(message, method);
    this.status = status;
  }
}

/** 401/403 — credentials wrong, or sent in the wrong shape. */
export class RpcAuthError extends RpcHttpError {}

/** Request exceeded ZCASH_RPC_TIMEOUT_MS. */
export class RpcTimeoutError extends RpcError {}

/** DNS failure, connection refused, TLS problem, malformed body. */
export class RpcTransportError extends RpcError {}

/**
 * What each OS/undici error code actually means for someone configuring an
 * endpoint. Only codes with a distinct remedy are listed — a code that just means
 * "the network is broken" adds nothing to the raw message.
 */
const TRANSPORT_HINTS: Record<string, string> = {
  ENOTFOUND: "that hostname does not resolve. Check the URL for a typo, and that DNS works from this machine.",
  EAI_AGAIN: "the DNS lookup failed temporarily — the resolver is unreachable, or rate-limiting you.",
  ECONNREFUSED:
    "nothing accepted the connection. For a local node, check it is running and its RPC port is bound; on a restricted network, check outbound access is allowed.",
  ECONNRESET:
    "the connection was closed mid-request. For a local container, ensure Zebra's RPC is bound to 0.0.0.0:8232 (zebrad.toml); on a remote network, check for a proxy or firewall.",
  ETIMEDOUT: "the connection attempt timed out before the node answered.",
  EHOSTUNREACH: "there is no route to that host.",
  ENETUNREACH: "the network is unreachable from this machine.",
  EPERM: "the operating system or a sandbox denied the outbound connection.",
  UND_ERR_CONNECT_TIMEOUT: "the TCP connection timed out before TLS could begin.",
  UND_ERR_SOCKET:
    "the node closed the socket immediately. Zebra closes unauthenticated connections when enable_cookie_auth = true; verify ~/.cache/zebra/.cookie exists or supply cookie credentials.",
  CERT_HAS_EXPIRED: "the endpoint's TLS certificate has expired.",
  DEPTH_ZERO_SELF_SIGNED_CERT: "the endpoint presents a self-signed certificate.",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "the endpoint's TLS certificate chain could not be verified.",
};

/**
 * Turn a thrown `fetch` failure into something a person can act on.
 *
 * Node reports *every* network-layer failure as the single string `fetch failed`
 * and puts the real reason one level down in `cause`. That one string covers a
 * typo in the hostname, a node that is not running, a firewall, and an expired
 * certificate — four problems with four different fixes. Unwrapping the cause and
 * naming the code is the difference between a support thread and a one-line fix,
 * which is why this exists rather than passing `err.message` through.
 *
 * The chain is walked to a bounded depth: `cause` can nest (undici wraps an
 * AggregateError when a host has both A and AAAA records), and a cycle in a
 * hand-constructed error should not hang the process.
 */
export function describeTransportFailure(err: unknown): string {
  let deepest: Error | null = null;
  let current: unknown = err;

  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    deepest = current;
    const { cause } = current as { cause?: unknown };
    // AggregateError from a dual-stack host: every attempt failed, and they
    // usually failed the same way, so the first is representative.
    if (cause === undefined && current instanceof AggregateError && current.errors.length > 0) {
      current = current.errors[0];
      continue;
    }
    current = cause;
  }

  if (deepest === null) return typeof err === "string" ? err : "transport failure";

  const code = (deepest as { code?: unknown }).code;
  const hint = typeof code === "string" ? TRANSPORT_HINTS[code] : undefined;
  const detail = deepest.message || "no further detail";

  if (hint) return `${detail} — ${hint}`;
  if (typeof code === "string") return `${detail} (${code})`;
  return detail;
}

/**
 * True when retrying the same call could plausibly succeed. Deliberately
 * excludes RpcMethodError and RpcUnsupportedError: a node that says "no"
 * will keep saying "no", and retrying wastes request quota.
 */
export function isRetryable(err: unknown): boolean {
  if (err instanceof RpcTimeoutError || err instanceof RpcTransportError) return true;
  if (err instanceof RpcHttpError) {
    if (err instanceof RpcAuthError) return false;
    return err.status === 429 || err.status >= 500;
  }
  return false;
}

/** A short, user-facing description. Rendered in panels; must not leak the URL or token. */
export function describeRpcError(err: unknown): string {
  if (err instanceof RpcConfigError) return err.message;
  if (err instanceof RpcUnsupportedError) return `This node does not support ${err.method}.`;
  if (err instanceof RpcAuthError) {
    // The message is built at the point of failure, where it is known whether any
    // credential was sent at all — advice for a missing key and advice for a
    // rejected one are opposites. An earlier version substituted a fixed string
    // about ZCASH_RPC_USER/PASSWORD here, which threw that away and sent anyone
    // using a hosted provider's API key looking for a password they never had.
    return `Node rejected the credentials (HTTP ${err.status}). ${err.message.replace(/^Unauthorized\.\s*/, "")}`.trim();
  }
  if (err instanceof RpcHttpError) return `Node returned HTTP ${err.status} for ${err.method}.`;
  if (err instanceof RpcTimeoutError) return `${err.method} timed out.`;
  if (err instanceof RpcTransportError) return `Could not reach the node: ${err.message}`;
  if (err instanceof RpcMethodError) return `${err.method} failed: ${err.message}`;
  if (err instanceof Error) return err.message;
  return "Unknown error";
}
