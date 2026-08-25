/**
 * JSON-RPC transport for a self-hosted Zcash/Zebra node.
 *
 * This module only ever runs server-side (route handlers and scripts). The
 * node's URL and credentials never reach the browser.
 */

import { readFileSync, statSync } from "node:fs";

import { demoProfile, demoSupportedMethods, getDemoResult } from "./demo";
import {
  RpcAuthError,
  RpcConfigError,
  RpcHttpError,
  RpcMethodError,
  RpcTimeoutError,
  RpcTransportError,
  RpcUnsupportedError,
  describeTransportFailure,
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
  /**
   * Path to Zebra's RPC cookie file. Zebra 2.x enables cookie auth by default
   * (`enable_cookie_auth = true`), so a default zebrad answers 401 to an
   * unauthenticated request. Ignored when user/password are set.
   */
  cookieFile: string;
  /**
   * Extra request headers, from `ZCASH_RPC_HEADERS`.
   * Applied last to allow custom header authentication when needed.
   */
  headers: Record<string, string>;
  timeoutMs: number;
  /**
   * zcashd ignores this field's value, while Zebra's JSON-RPC server
   * is strict about "2.0". "2.0" works for both.
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
 * Zebra's RPC cookie, cached against the file's mtime.
 *
 * The file holds a single `__cookie__:<secret>` line — the same convention
 * Bitcoin Core established — so its contents *are* the `user:password` pair and
 * get base64'd as-is. Zebra rewrites the secret on every restart, so caching by
 * mtime rather than forever means a node restart does not leave this process
 * sending a stale credential until it is restarted too.
 *
 * The secret never appears in a thrown message. A caller that mistypes the path
 * needs the path back; nobody needs the cookie echoed into a log.
 */
import { homedir } from "node:os";
import { join } from "node:path";

export function resolveCookiePath(rawPath: string): string {
  if (!rawPath) return "";
  if (rawPath.startsWith("~/")) {
    return join(homedir(), rawPath.slice(2));
  }
  return rawPath;
}

export function detectDefaultCookiePath(): string | null {
  const linuxPath = join(homedir(), ".cache/zebra/.cookie");
  try {
    if (statSync(linuxPath).isFile()) return linuxPath;
  } catch {}
  const macPath = join(homedir(), "Library/Caches/zebra/.cookie");
  try {
    if (statSync(macPath).isFile()) return macPath;
  } catch {}
  return null;
}

let cookieCache: { path: string; mtimeMs: number; encoded: string } | null = null;

function readCookieAuth(rawPath: string, method: string): string {
  const path = resolveCookiePath(rawPath);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    throw new RpcConfigError(
      `ZCASH_RPC_COOKIE_FILE points at ${path}, which cannot be read. Zebra writes this file into its cache directory when enable_cookie_auth is true; check the path, or set enable_cookie_auth = false in zebrad.toml.`,
      method,
    );
  }

  if (cookieCache && cookieCache.path === path && cookieCache.mtimeMs === mtimeMs) {
    return cookieCache.encoded;
  }

  let contents: string;
  try {
    contents = readFileSync(path, "utf8").trim();
  } catch {
    throw new RpcConfigError(`ZCASH_RPC_COOKIE_FILE at ${path} could not be read.`, method);
  }

  if (!contents.includes(":")) {
    throw new RpcConfigError(
      `The RPC cookie at ${path} is not in "user:secret" form, so it is probably not Zebra's cookie file.`,
      method,
    );
  }

  const encoded = Buffer.from(contents).toString("base64");
  cookieCache = { path, mtimeMs, encoded };
  return encoded;
}

/**
 * Parse `ZCASH_RPC_HEADERS`.
 *
 * Two forms, because both are things a person will reasonably type:
 *
 *   ZCASH_RPC_HEADERS={"x-api-key":"abc123"}
 *   ZCASH_RPC_HEADERS=x-api-key: abc123
 *
 * The second form splits on newlines and commas, then on the first colon only —
 * so a value containing a colon survives.
 *
 * A malformed value throws rather than being silently dropped. Quietly sending no
 * API key produces an HTTP 401 from the provider, and debugging that from the
 * far end is miserable when the actual fault is a typo in .env.local.
 */
function parseExtraHeaders(raw: string): Record<string, string> {
  if (!raw) return {};

  if (raw.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new RpcConfigError(
        'ZCASH_RPC_HEADERS starts with "{" but is not valid JSON. Expected {"header-name":"value"}.',
        "config",
      );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new RpcConfigError("ZCASH_RPC_HEADERS must be a JSON object of header names to values.", "config");
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "string") {
        throw new RpcConfigError(`ZCASH_RPC_HEADERS: the value for "${name}" must be a string.`, "config");
      }
      headers[name.trim()] = value;
    }
    return headers;
  }

  const headers: Record<string, string> = {};
  for (const pair of raw.split(/[\n,]/)) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    if (colon <= 0) {
      throw new RpcConfigError(
        `ZCASH_RPC_HEADERS: "${trimmed}" is not a "Header-Name: value" pair. Use that form, or a JSON object.`,
        "config",
      );
    }
    headers[trimmed.slice(0, colon).trim()] = trimmed.slice(colon + 1).trim();
  }
  return headers;
}

function getSessionOverride(): Partial<RpcConfig> | null {
  try {
    // Dynamically require next/headers if inside Next.js request context
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { cookies, headers } = require("next/headers");
    const cookieStore = cookies();
    const configCookie = cookieStore.get("zpulse_node_config");
    if (configCookie?.value) {
      const decoded = JSON.parse(decodeURIComponent(configCookie.value));
      return decoded;
    }
    const headersList = headers();
    const modeHeader = headersList.get("x-zpulse-mode");
    const urlHeader = headersList.get("x-zpulse-url");
    if (modeHeader || urlHeader) {
      return {
        mode: modeHeader === "demo" ? "demo" : modeHeader === "live" ? "live" : undefined,
        url: urlHeader || undefined,
        headers: headersList.get("x-zpulse-headers") ? JSON.parse(headersList.get("x-zpulse-headers")!) : undefined,
        user: headersList.get("x-zpulse-user") || undefined,
        password: headersList.get("x-zpulse-password") || undefined,
      };
    }
  } catch {
    // Outside Next.js request context (e.g. CLI verify test suite)
  }
  return null;
}

/**
 * Read configuration fresh on each call rather than caching at module load, so
 * editing .env.local or switching connection in the UI takes effect immediately.
 *
 * Mode resolution: an explicit session / ZCASH_RPC_MODE wins; otherwise having a URL
 * means live and having none means demo.
 */
export function readRpcConfig(override?: Partial<RpcConfig>): RpcConfig {
  const session = override ?? getSessionOverride();

  if (session?.mode === "demo") {
    return {
      mode: "demo",
      url: "",
      user: "",
      password: "",
      cookieFile: "",
      headers: {},
      timeoutMs: envInt("ZCASH_RPC_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
      jsonrpcVersion: "2.0",
    };
  }

  const url = session?.url !== undefined ? session.url : envStr("ZCASH_RPC_URL");
  const explicitMode = session?.mode || envStr("ZCASH_RPC_MODE").toLowerCase();

  let mode: RpcMode;
  if (explicitMode === "demo") mode = "demo";
  else if (explicitMode === "live") mode = "live";
  else if (process.env.VERCEL || process.env.NETLIFY || process.env.RENDER || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    // In cloud deployment without an external URL, default to demo mode rather than failing on localhost
    const isLocalhost = !url || url.includes("127.0.0.1") || url.includes("localhost");
    mode = isLocalhost ? "demo" : "live";
  } else {
    mode = url ? "live" : "demo";
  }

  const user = session?.user !== undefined ? session.user : envStr("ZCASH_RPC_USER");
  const password = session?.password !== undefined ? session.password : envStr("ZCASH_RPC_PASSWORD");
  const headers = session?.headers !== undefined ? session.headers : parseExtraHeaders(envStr("ZCASH_RPC_HEADERS"));

  return {
    mode,
    url,
    user,
    password,
    cookieFile: envStr("ZCASH_RPC_COOKIE_FILE"),
    headers,
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
  let host: string;
  try {
    host = new URL(config.url).host;
  } catch {
    return "malformed ZCASH_RPC_URL";
  }

  // Deliberately outside the try above: that catch is for one thing, an unparseable
  // URL. Anything else going wrong here is a bug and should say so rather than be
  // reported to the user as a malformed endpoint.
  //
  // Header *names* are safe to show and useful when debugging a 401 — knowing
  // `x-api-key` is being sent is the whole question. The values never appear here,
  // in any log, or in any thrown message.
  const styles: string[] = [];
  if (config.user || config.password) styles.push("basic auth");
  else if (config.cookieFile) styles.push("cookie auth");
  const headerNames = Object.keys(config.headers);
  if (headerNames.length > 0) styles.push(`header auth (${headerNames.join(", ")})`);
  if (styles.length === 0) {
    let hasPath = false;
    try {
      hasPath = new URL(config.url).pathname.length > 1;
    } catch {
      // ignore
    }
    styles.push(hasPath ? "token in URL" : "direct RPC");
  }
  return `${host} (${styles.join(" + ")})`;
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
  //
  // Order matters: explicit user/password wins, then Zebra's cookie file, then
  // nothing. A cookie file is the default shape for a local zebrad; explicit
  // credentials are what a zcashd or a basic-auth proxy wants.
  if (config.user || config.password) {
    const encoded = Buffer.from(`${config.user}:${config.password}`).toString("base64");
    headers.Authorization = `Basic ${encoded}`;
  } else {
    const cookiePath = config.cookieFile || (config.url && (config.url.includes("127.0.0.1") || config.url.includes("localhost")) ? (detectDefaultCookiePath() ?? "") : "");
    if (cookiePath) {
      try {
        headers.Authorization = `Basic ${readCookieAuth(cookiePath, method)}`;
      } catch (err) {
        if (config.cookieFile) throw err;
      }
    }
  }

  // Last, so a provider that wants its own header wins — including one that wants
  // `Authorization: Bearer <token>` instead of the Basic header built above.
  for (const [name, value] of Object.entries(config.headers)) {
    headers[name] = value;
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
    throw new RpcTransportError(describeTransportFailure(err), method);
  }

  if (response.status === 401 || response.status === 403) {
    // Two very different failures land here, so the hint has to distinguish them.
    // A local zebrad: cookie auth is on unless turned off, and an unauthenticated
    // request gets 401 — saying so beats "Unauthorized", which sends people looking
    // for an rpcuser they never had to set. A hosted provider: the API key is
    // usually a custom header, which is what ZCASH_RPC_HEADERS is for.
    const authenticated =
      config.user || config.password || config.cookieFile || Object.keys(config.headers).length > 0;
    const hint = authenticated
      ? " Credentials were sent, so they were rejected rather than missing — check the key itself, and that it is scoped to Zcash mainnet."
      : " No credentials are configured. For a local zebrad, cookie auth is on by default — set ZCASH_RPC_COOKIE_FILE to its cookie file, or set enable_cookie_auth = false in zebrad.toml. For a hosted provider, put its API key in ZCASH_RPC_HEADERS.";
    throw new RpcAuthError(`Unauthorized.${hint}`, method, response.status);
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

export { demoProfile, demoSupportedMethods };
