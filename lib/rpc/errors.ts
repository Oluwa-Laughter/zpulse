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
    return "Node rejected the credentials (HTTP " + err.status + "). If your provider puts the token in the URL, leave ZCASH_RPC_USER and ZCASH_RPC_PASSWORD blank; if it uses basic auth, set both.";
  }
  if (err instanceof RpcHttpError) return `Node returned HTTP ${err.status} for ${err.method}.`;
  if (err instanceof RpcTimeoutError) return `${err.method} timed out.`;
  if (err instanceof RpcTransportError) return `Could not reach the node: ${err.message}`;
  if (err instanceof RpcMethodError) return `${err.method} failed: ${err.message}`;
  if (err instanceof Error) return err.message;
  return "Unknown error";
}
