/**
 * Dynamic Node Connection API:
 * GET  /api/connection - Get current active connection mode & presets
 * POST /api/connection - Test connection, save session node override, or reset
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { rpcCallTimed, describeEndpoint, readRpcConfig, type RpcConfig } from "@/lib/rpc/client";
import { clearCache } from "@/lib/cache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const config = readRpcConfig();
  const cookieStore = cookies();
  const rawCookie = cookieStore.get("zpulse_node_config")?.value;

  let sessionConfig: { mode?: string; url?: string; apiKey?: string; headerName?: string; headers?: Record<string, string> } | null = null;
  if (rawCookie) {
    try {
      sessionConfig = JSON.parse(decodeURIComponent(rawCookie));
    } catch {
      // ignore
    }
  }

  // Sanitize URL to show host only (strip sensitive auth tokens from paths or query strings)
  let sanitizedUrl = "";
  if (sessionConfig?.url) {
    try {
      const parsed = new URL(sessionConfig.url);
      sanitizedUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname !== "/" ? parsed.pathname.replace(/\/([a-zA-Z0-9_-]{12,})/g, "/***") : ""}`;
    } catch {
      sanitizedUrl = sessionConfig.url.replace(/:[^@]+@/, ":***@");
    }
  }

  return NextResponse.json({
    data: {
      mode: config.mode,
      endpoint: describeEndpoint(config),
      isDemo: config.mode === "demo",
      isCustomSession: Boolean(sessionConfig),
      session: sessionConfig
        ? {
            mode: sessionConfig.mode,
            url: sanitizedUrl,
            hasApiKey: Boolean(sessionConfig.apiKey || (sessionConfig.headers && Object.keys(sessionConfig.headers).length > 0)),
            headerName: sessionConfig.headerName || "api-key",
          }
        : null,
      presets: [
        {
          id: "demo",
          name: "Interactive Demo Sandbox",
          description: "Zero credentials or local setup needed. Runs built-in simulated Zebra mainnet dialect.",
        },
        {
          id: "local",
          name: "Local Self-Hosted Node",
          description: "Connect to your local zebrad / zcashd node (e.g. http://127.0.0.1:8232).",
          defaultUrl: "http://127.0.0.1:8232",
        },
        {
          id: "remote",
          name: "3rd-Party Remote RPC Node",
          description: "Connect to any remote Zcash JSON-RPC endpoint with private API key / token header.",
          defaultHeader: "api-key",
        },
      ],
    },
  });
}

export async function POST(req: Request) {
  let body: {
    action?: "test" | "save" | "reset";
    mode?: "demo" | "live";
    url?: string;
    user?: string;
    password?: string;
    headerName?: string;
    apiKey?: string;
    headers?: Record<string, string>;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { message: "Invalid JSON body." } }, { status: 400 });
  }

  const action = body.action || "test";

  // Build target headers privately
  const targetHeaders: Record<string, string> = { ...(body.headers || {}) };
  if (body.apiKey) {
    const headerKey = (body.headerName || "api-key").trim();
    targetHeaders[headerKey] = body.apiKey.trim();
  }

  const targetConfig: RpcConfig = {
    mode: body.mode || (body.url ? "live" : "demo"),
    url: body.url ? body.url.trim() : "",
    user: body.user ? body.user.trim() : "",
    password: body.password ? body.password.trim() : "",
    cookieFile: "",
    headers: targetHeaders,
    timeoutMs: 8000,
    jsonrpcVersion: "2.0",
  };

  // 1. Action: Test Connection
  if (action === "test") {
    if (targetConfig.mode === "demo") {
      return NextResponse.json({
        data: {
          ok: true,
          mode: "demo",
          node: "Zebra (Synthetic Mainnet Dialect)",
          chain: "main",
          height: 3478500,
          latencyMs: 12,
          message: "Demo Sandbox is active and healthy.",
        },
      });
    }

    if (!targetConfig.url) {
      return NextResponse.json({
        error: { kind: "ConfigError", message: "RPC URL is required to connect to a live node." },
      }, { status: 400 });
    }

    const isCloudEnv = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY || process.env.RENDER);
    const isLocalhostTarget = targetConfig.url && (targetConfig.url.includes("127.0.0.1") || targetConfig.url.includes("localhost"));

    if (isCloudEnv && isLocalhostTarget) {
      return NextResponse.json({
        error: {
          kind: "CloudToLocalhostNotice",
          message: "To connect directly to a live local Zebra node on 127.0.0.1:8232, please clone the repository and run ZPulse locally following the GitHub setup guide: https://github.com/Oluwa-Laughter/zpulse#quick-start-running-locally-with-live-zebra-node (On this live cloud link, use the Interactive Demo or 3rd-Party Remote RPC mode).",
          endpoint: describeEndpoint(targetConfig),
        },
      }, { status: 400 });
    }

    try {
      const start = Date.now();
      const response = await rpcCallTimed<Record<string, unknown>>("getblockchaininfo", [], targetConfig);
      const latencyMs = response.latencyMs || (Date.now() - start);
      const result = response.result as { blocks?: number; chain?: string; bestblockhash?: string };

      return NextResponse.json({
        data: {
          ok: true,
          mode: "live",
          endpoint: describeEndpoint(targetConfig),
          chain: result.chain || "main",
          height: result.blocks ?? null,
          bestblockhash: result.bestblockhash ?? null,
          latencyMs,
          message: `Connected successfully! Block #${result.blocks ?? "unknown"} (${latencyMs}ms)`,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to connect to the node.";
      return NextResponse.json({
        error: {
          kind: "ConnectionFailed",
          message,
          endpoint: describeEndpoint(targetConfig),
        },
      }, { status: 502 });
    }
  }

  // 2. Action: Save Connection Configuration to Secure HttpOnly Session Cookie
  if (action === "save") {
    clearCache();
    const cookieStore = cookies();

    if (body.mode === "demo") {
      cookieStore.set("zpulse_node_config", encodeURIComponent(JSON.stringify({ mode: "demo" })), {
        path: "/",
        maxAge: 30 * 24 * 60 * 60, // 30 days
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });

      return NextResponse.json({
        data: {
          ok: true,
          mode: "demo",
          endpoint: "demo (synthetic node)",
          message: "Switched to Interactive Demo Mode.",
        },
      });
    }

    const savedPayload = {
      mode: "live",
      url: targetConfig.url,
      user: targetConfig.user,
      password: targetConfig.password,
      headerName: body.headerName || "api-key",
      apiKey: body.apiKey || undefined,
      headers: targetHeaders,
    };

    // Store in HttpOnly cookie: completely inaccessible to client-side JS / XSS
    cookieStore.set("zpulse_node_config", encodeURIComponent(JSON.stringify(savedPayload)), {
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });

    return NextResponse.json({
      data: {
        ok: true,
        mode: "live",
        endpoint: describeEndpoint(targetConfig),
        message: `Switched node connection to ${describeEndpoint(targetConfig)}.`,
      },
    });
  }

  // 3. Action: Reset to Server Environment Defaults
  if (action === "reset") {
    clearCache();
    const cookieStore = cookies();
    cookieStore.delete("zpulse_node_config");

    const defaultConfig = readRpcConfig();
    return NextResponse.json({
      data: {
        ok: true,
        mode: defaultConfig.mode,
        endpoint: describeEndpoint(defaultConfig),
        message: "Reset connection to server defaults.",
      },
    });
  }

  return NextResponse.json({ error: { message: `Unknown action "${action}"` } }, { status: 400 });
}
