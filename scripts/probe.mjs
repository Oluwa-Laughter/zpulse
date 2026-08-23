/**
 * Endpoint probe.  node scripts/probe.mjs
 *
 * Runs before Next is involved at all, with no dependencies and no TypeScript, so
 * it separates two questions that are painful to debug together: *is my endpoint
 * good?* and *is my app good?* If this script prints latencies, the credentials
 * and the URL are right, and anything still broken afterwards is ZPulse's fault.
 *
 * It calls every method ZPulse uses, once, and prints one line each:
 *
 *   ok           the node answered
 *   unsupported  the node returned -32601 — this method does not exist here
 *   error        something else went wrong, and the reason is printed
 *
 * **Expect some `unsupported` lines.** zcashd and Zebra implement different
 * method sets, and routing around the gaps is the dialect layer's whole job. A
 * Zebra node should report getmempoolinfo and getnetworkinfo as unsupported; a
 * zcashd node answers both. Either result is a pass.
 *
 * Responses are written to lib/rpc/fixtures/recorded/ (gitignored) so real shapes
 * are available for reference without committing anything about your endpoint.
 *
 * Usage:
 *   node scripts/probe.mjs               read .env.local
 *   node scripts/probe.mjs --no-write    skip recording
 *   ZCASH_RPC_URL=... node scripts/probe.mjs
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = resolve(ROOT, "lib/rpc/fixtures/recorded");
const WRITE = !process.argv.includes("--no-write");

/* ── .env.local, parsed by hand ──────────────────────────────────────────── */

/**
 * Next loads .env.local itself; a bare `node` process does not. Rather than add
 * dotenv for one file, parse the handful of lines we need. Real environment
 * variables win, so `ZCASH_RPC_URL=... node scripts/probe.mjs` overrides the file.
 */
async function loadEnvLocal() {
  let text;
  try {
    text = await readFile(resolve(ROOT, ".env.local"), "utf8");
  } catch {
    return;
  }

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/* ── the method list ─────────────────────────────────────────────────────── */

/**
 * Ordered so the cheap sanity checks come first: if getblockcount fails there is
 * no point running fifteen more calls, and a caller reading the output top-down
 * sees the fatal problem on line one.
 *
 * `needs` marks calls that depend on an earlier result — the probe substitutes it
 * rather than hardcoding a height or hash that would be wrong on any other chain.
 */
const PROBES = [
  { method: "getblockcount", params: [], note: "cheapest tip poll — the ticker uses this" },
  { method: "getbestblockhash", params: [], note: "tip hash" },
  { method: "getblockchaininfo", params: [], note: "valuePools, upgrades, sync — the workhorse" },
  { method: "getinfo", params: [], note: "version; both dialects answer" },
  { method: "getblockhash", params: ["$height"], needs: "height", note: "height → hash" },
  { method: "getblockheader", params: ["$hash", true], needs: "hash", note: "timestamps for block time" },
  { method: "getblock", params: ["$hash", 1], needs: "hash", note: "per-pool valueDelta — the turnstile" },
  { method: "getblock", params: ["$hash", 2], needs: "hash", note: "inline txs — the privacy mix", label: "getblock (verbosity 2)" },
  { method: "z_gettreestate", params: ["$heightStr"], needs: "height", note: "commitment tree roots" },
  { method: "getblocksubsidy", params: ["$height"], needs: "height", note: "issuance split incl. lockbox" },
  { method: "getrawmempool", params: [true], note: "Zebra-compatible mempool" },
  { method: "getmempoolinfo", params: [], note: "zcashd fast path — Zebra returns -32601" },
  { method: "getpeerinfo", params: [], note: "peer count and detail" },
  { method: "getnetworkinfo", params: [], note: "zcashd only — Zebra returns -32601" },
  { method: "getnetworksolps", params: [], note: "network hashrate" },
  { method: "getmininginfo", params: [], note: "hashrate fallback" },
  { method: "getrawtransaction", params: ["$txid", 1], needs: "txid", note: "tx anatomy fallback" },
];

/* ── transport ───────────────────────────────────────────────────────────── */

let requestId = 0;

async function call(config, method, params) {
  requestId += 1;
  const headers = { "content-type": "application/json" };
  if (config.user || config.password) {
    headers.authorization = `Basic ${Buffer.from(`${config.user}:${config.password}`).toString("base64")}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const started = performance.now();

  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: config.jsonrpcVersion, id: `probe-${requestId}`, method, params }),
      signal: controller.signal,
    });

    const text = await response.text();
    const latencyMs = Math.round(performance.now() - started);

    if (!response.ok && !text.trim().startsWith("{")) {
      // An HTML error page from a proxy, or a 401 with no JSON body. Reporting the
      // status is far more useful here than a JSON parse error would be.
      return { status: "error", latencyMs, reason: `HTTP ${response.status} ${response.statusText}` };
    }

    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { status: "error", latencyMs, reason: `response was not JSON (${text.slice(0, 60)}…)` };
    }

    if (body.error) {
      const code = body.error.code;
      const reason = `${code ?? "?"}: ${body.error.message ?? "unknown error"}`;
      // -32601 is JSON-RPC's "method not found". Some nodes phrase it in the
      // message instead of the code, which is why the text is checked too.
      const missing = code === -32601 || /method not found|unknown method|not supported/i.test(body.error.message ?? "");
      return { status: missing ? "unsupported" : "error", latencyMs, reason };
    }

    return { status: "ok", latencyMs, result: body.result };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    if (err?.name === "AbortError") {
      return { status: "error", latencyMs, reason: `timed out after ${config.timeoutMs}ms` };
    }
    return { status: "error", latencyMs, reason: err?.message ?? String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/* ── output ──────────────────────────────────────────────────────────────── */

const COLORS = process.stdout.isTTY
  ? { ok: "[32m", warn: "[33m", bad: "[31m", dim: "[2m", off: "[0m" }
  : { ok: "", warn: "", bad: "", dim: "", off: "" };

function line(label, outcome, note) {
  const badge =
    outcome.status === "ok"
      ? `${COLORS.ok}ok         ${COLORS.off}`
      : outcome.status === "unsupported"
        ? `${COLORS.warn}unsupported${COLORS.off}`
        : `${COLORS.bad}error      ${COLORS.off}`;

  const timing = `${String(outcome.latencyMs).padStart(5)}ms`;
  const tail = outcome.status === "ok" ? `${COLORS.dim}${note}${COLORS.off}` : outcome.reason;
  process.stdout.write(`  ${badge} ${timing}  ${label.padEnd(26)} ${tail}\n`);
}

/* ── main ────────────────────────────────────────────────────────────────── */

await loadEnvLocal();

const config = {
  url: (process.env.ZCASH_RPC_URL ?? "").trim(),
  user: (process.env.ZCASH_RPC_USER ?? "").trim(),
  password: (process.env.ZCASH_RPC_PASSWORD ?? "").trim(),
  timeoutMs: Number(process.env.ZCASH_RPC_TIMEOUT_MS ?? 8000) || 8000,
  jsonrpcVersion: (process.env.ZCASH_RPC_JSONRPC_VERSION ?? "2.0").trim() || "2.0",
};

if (!config.url) {
  process.stderr.write(
    "\nNo ZCASH_RPC_URL found.\n\n" +
      "  cp .env.local.example .env.local   then fill in your endpoint\n\n" +
      "The probe talks to a real node, so it has nothing to do in demo mode.\n" +
      'To see the app without an endpoint, run "npm run dev" — it starts in demo mode.\n\n',
  );
  process.exit(1);
}

// Host only. The path is where hosted providers keep the access token, and this
// output is the sort of thing that ends up pasted into a chat window.
let host = "unparseable URL";
try {
  host = new URL(config.url).host;
} catch {
  /* reported below by the first call failing */
}

process.stdout.write(`\nZPulse endpoint probe\n`);
process.stdout.write(
  `${COLORS.dim}  ${host} · ${config.user || config.password ? "basic auth" : "token in URL or none"} · timeout ${config.timeoutMs}ms${COLORS.off}\n\n`,
);

const context = {};
const summary = { ok: 0, unsupported: 0, error: 0 };
const recorded = {};

for (const probe of PROBES) {
  const label = probe.label ?? probe.method;

  if (probe.needs && context[probe.needs] === undefined) {
    process.stdout.write(
      `  ${COLORS.dim}skipped     ${"".padStart(5)}    ${label.padEnd(26)} no ${probe.needs} available from earlier calls${COLORS.off}\n`,
    );
    continue;
  }

  const params = probe.params.map((param) => {
    if (param === "$height") return context.height;
    if (param === "$heightStr") return String(context.height);
    if (param === "$hash") return context.hash;
    if (param === "$txid") return context.txid;
    return param;
  });

  const outcome = await call(config, probe.method, params);
  summary[outcome.status] += 1;
  line(label, outcome, probe.note);

  if (outcome.status !== "ok") continue;

  recorded[label] = { method: probe.method, params, result: outcome.result };

  // Feed later probes from earlier results, so nothing is hardcoded to a chain.
  if (probe.method === "getblockcount") context.height = outcome.result;
  if (probe.method === "getbestblockhash") context.hash = outcome.result;
  if (probe.method === "getblock" && outcome.result?.tx?.length) {
    const first = outcome.result.tx[0];
    // Verbosity 1 gives txids; verbosity 2 gives objects. Either can seed getrawtransaction.
    const txid = typeof first === "string" ? first : first?.txid;
    if (txid) context.txid = txid;
  }
}

process.stdout.write(
  `\n  ${COLORS.ok}${summary.ok} ok${COLORS.off} · ${COLORS.warn}${summary.unsupported} unsupported${COLORS.off} · ${COLORS.bad}${summary.error} error${COLORS.off}\n`,
);

if (summary.unsupported > 0) {
  process.stdout.write(
    `${COLORS.dim}  Unsupported methods are expected — zcashd and Zebra implement different sets,\n` +
      `  and ZPulse routes around the gaps. See the dialect table on the /node page.${COLORS.off}\n`,
  );
}

if (WRITE && Object.keys(recorded).length > 0) {
  await mkdir(FIXTURE_DIR, { recursive: true });
  const path = resolve(FIXTURE_DIR, "probe.json");
  await writeFile(path, `${JSON.stringify(recorded, null, 2)}\n`, "utf8");
  process.stdout.write(`${COLORS.dim}  Recorded ${Object.keys(recorded).length} responses to ${path.replace(ROOT + "/", "")}${COLORS.off}\n`);
}

process.stdout.write("\n");

// A node that answered nothing at all is a failure; one with dialect gaps is not.
process.exit(summary.ok === 0 ? 1 : 0);
