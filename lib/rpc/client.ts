/**
 * JSON-RPC transport for a Zcash node.
 *
 * This module only ever runs server-side (route handlers and scripts). The
 * node's URL and credentials never reach the browser — and note
 * `describeEndpoint()`, which exists because hosted providers such as GetBlock
 * put the access token in the URL *path*. Rendering the endpoint URL in the UI
 * or in an error message would leak that token, so only the host is ever
 * surfaced.
 *
 * Ported and extended from the earlier prototype's lib/zcashRpc.js. What is new:
 * a no-auth mode (token-in-URL providers reject a stray Authorization header on
 * some setups, and sending credentials that are not needed is pointless), one
 * retry on genuinely transient failures, typed errors, latency measurement, and
 * the demo-mode branch.
 */

import { DEMO_SUPPORTED_METHODS, getDemoResult } from "./demo";
import {
  RpcAuthError,
  RpcConfigError,
  RpcHttpError,
  RpcMethodError,
  RpcTimeoutError,
  RpcTransportError,
  RpcUnsupportedError,
  isRetryable,
} from "./errors";
import type { DataSource } from "./types";
import { recordCall } from "./telemetry";

export type RpcMode = "live" | "demo";

export type RpcConfig = {
  mode: RpcMode;
  url: string;
  user: string;
  password: string;
  timeoutMs: number;
  /**
   * zcashd (and Bitcoin-Core-derived nodes) ignore this field's value, while
   * Zebra's JSON-RPC server is strict about "2.0". "2.0" therefore works for
   * both, but the escape hatch is here in case a provider's proxy disagrees.
   */
  jsonrpcVersion: string;
};

const DEFAULT_TIMEOUT_MS = 8_000;

function envStr(key: string, fallback = ""): string {
  const value = process.env[key];
  return typeof value === "string" ? value.trim() : fallback;
}

function envInt(key: string, fallback: number): number {
  const raw = envStr(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Read configuration fresh on each call rather than caching at module load, so
 * editing .env.local during `next dev` takes effect without a restart.
 *
 * Mode resolution: an explicit ZCASH_RPC_MODE wins; otherwise having a URL
 * means live and having none means demo. That way a fresh clone with no
 * configuration renders something instead of erroring, but a configured
 * endpoint is never silently ignored.
 */
export function readRpcConfig(): RpcConfig {
  const url = envStr("ZCASH_RPC_URL");
  const explicitMode = envStr("ZCASH_RPC_MODE").toLowerCase();

  let mode: RpcMode;
  if (explicitMode === "demo") mode = "demo";
  else if (explicitMode === "live") mode = "live";
  else mode = url ? "live" : "demo";

  return {
    mode,
    url,
    user: envStr("ZCASH_RPC_USER"),
    password: envStr("ZCASH_RPC_PASSWORD"),
    timeoutMs: envInt("ZCASH_RPC_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    jsonrpcVersion: envStr("ZCASH_RPC_JSONRPC_VERSION", "2.0") || "2.0",
  };
}

/**
 * A safe description of where we are pointed. Host only — never the path,
 * because that is where hosted providers keep the access token.
 */
export function describeEndpoint(config: RpcConfig = readRpcConfig()): string {
  if (config.mode === "demo") return "demo (synthetic node)";
  if (!config.url) return "not configured";
  try {
    const parsed = new URL(config.url);
    const auth = config.user || config.password ? "basic auth" : "token in URL";
    return `${parsed.host} (${auth})`;
  } catch {
    return "malformed ZCASH_RPC_URL";
  }
}

export type RpcResponse<T> = {
  method: string;
  params: unknown[];
  result: T;
  latencyMs: number;
  source: DataSource;
};

let requestCounter = 0;

/** Build the JSON-RPC envelope. Exported so the RPC console can display exactly what was sent. */
export function buildEnvelope(
  method: string,
  params: unknown[],
  config: RpcConfig = readRpcConfig(),
): Record<string, unknown> {
  requestCounter += 1;
  return {
    jsonrpc: config.jsonrpcVersion,
    id: `zpulse-${requestCounter}`,
    method,
    params,
  };
}

async function postOnce<T>(
  method: string,
  params: unknown[],
  config: RpcConfig,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  // Basic auth only when credentials are actually configured. Providers that
  // authenticate via the URL path get no Authorization header at all.
  if (config.user || config.password) {
    const encoded = Buffer.from(`${config.user}:${config.password}`).toString("base64");
    headers.Authorization = `Basic ${encoded}`;
  }

  let response: Response;
  try {
    response = await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(buildEnvelope(method, params, config)),
      signal: AbortSignal.timeout(config.timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new RpcTimeoutError(`Timed out after ${config.timeoutMs}ms`, method);
    }
    throw new RpcTransportError(err instanceof Error ? err.message : "transport failure", method);
  }

  if (response.status === 401 || response.status === 403) {
    throw new RpcAuthError("Unauthorized", method, response.status);
  }

  // A node can return 500 with a perfectly good JSON-RPC error body (this is
  // how zcashd reports method errors), so read the body before judging status.
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    if (!response.ok) {
      throw new RpcHttpError(`HTTP ${response.status}`, method, response.status);
    }
    throw new RpcTransportError("Node returned a non-JSON body", method);
  }

  if (payload === null || typeof payload !== "object") {
    throw new RpcTransportError("Node returned an unexpected body", method);
  }

  const body = payload as { result?: unknown; error?: unknown };

  if (body.error !== undefined && body.error !== null) {
    const error = body.error as { code?: unknown; message?: unknown };
    const code = typeof error.code === "number" ? error.code : undefined;
    const message =
      typeof error.message === "string"
        ? error.message
        : typeof body.error === "string"
          ? body.error
          : "unknown RPC error";

    // -32601 is JSON-RPC "method not found" — the signal the dialect layer
    // uses to route around a method this node does not implement.
    if (code === -32601) throw new RpcUnsupportedError(method);
    throw new RpcMethodError(message, method, code);
  }

  if (!response.ok) {
    throw new RpcHttpError(`HTTP ${response.status}`, method, response.status);
  }

  return body.result as T;
}

/**
 * Call a method and report how long it took and where the answer came from.
 * Retries once on transient failures only — never on a method error, because a
 * node that says "no" will keep saying "no" and retrying burns request quota.
 *
 * Every outcome, including failures, is recorded in ./telemetry so /node can
 * show real per-method latency rather than a guess.
 */
export async function rpcCallTimed<T>(
  method: string,
  params: unknown[] = [],
  configOverride?: RpcConfig,
): Promise<RpcResponse<T>> {
  const config = configOverride ?? readRpcConfig();
  const startedAt = Date.now();

  if (config.mode === "demo") {
    try {
      const result = getDemoResult(method, params) as T;
      const latencyMs = Date.now() - startedAt;
      recordCall(method, latencyMs, true);
      return { method, params, result, latencyMs, source: "demo" };
    } catch (err) {
      recordCall(method, Date.now() - startedAt, false);
      throw err;
    }
  }

  if (!config.url) {
    throw new RpcConfigError(
      "ZCASH_RPC_URL is not set. Copy .env.local.example to .env.local and point it at a node, or set ZCASH_RPC_MODE=demo.",
      method,
    );
  }

  try {
    const result = await postOnce<T>(method, params, config);
    const latencyMs = Date.now() - startedAt;
    recordCall(method, latencyMs, true);
    return { method, params, result, latencyMs, source: "live" };
  } catch (err) {
    if (!isRetryable(err)) {
      recordCall(method, Date.now() - startedAt, false);
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      const result = await postOnce<T>(method, params, config);
      const latencyMs = Date.now() - startedAt;
      recordCall(method, latencyMs, true);
      return { method, params, result, latencyMs, source: "live" };
    } catch (retryErr) {
      recordCall(method, Date.now() - startedAt, false);
      throw retryErr;
    }
  }
}

/** Convenience wrapper for callers that only want the result. */
export async function rpcCall<T>(method: string, params: unknown[] = []): Promise<T> {
  const response = await rpcCallTimed<T>(method, params);
  return response.result;
}

/** Whether the configured node is the synthetic one. */
export function isDemoMode(): boolean {
  return readRpcConfig().mode === "demo";
}

export { DEMO_SUPPORTED_METHODS };
