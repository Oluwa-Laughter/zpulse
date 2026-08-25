#!/usr/bin/env node
/**
 * ZPulse toCurl Gateway — CLI Scripting Around Zebra JSON-RPC
 *
 * Implements the workshop toCurl.sh pattern from Zcash Foundation Workshop 3:
 *   node scripts/toCurl.mjs <method> [params...]
 *   npm run tocurl getblockchaininfo
 *   npm run tocurl getblock 1 1
 *   npm run tocurl z_gettreestate 1
 *
 * Automatically handles cookie auth (~/.cache/zebra/.cookie), custom headers,
 * JSON-RPC 2.0 formatting, and colored jq-style output.
 */

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const isDryRun = args.includes("--dry-run");
const cleanArgs = args.filter(a => a !== "--dry-run");

if (cleanArgs.length === 0) {
  console.log(`
ZPulse toCurl Gateway (Workshop CLI)
Usage:
  node scripts/toCurl.mjs [--dry-run] <method> [param1] [param2] ...

Examples:
  npm run tocurl getinfo
  npm run tocurl getblockchaininfo
  npm run tocurl getblock 1 1
  npm run tocurl z_gettreestate 1
  npm run tocurl getpeerinfo
  npm run tocurl --dry-run getblock 2000
`);
  process.exit(0);
}

const method = cleanArgs[0];
const rawParams = cleanArgs.slice(1);

// Parse typed params
const params = rawParams.map(p => {
  if (p === "true") return true;
  if (p === "false") return false;
  if (/^\d+$/.test(p)) return Number(p);
  if (p.startsWith("{") || p.startsWith("[")) {
    try { return JSON.parse(p); } catch {}
  }
  return p;
});

// Determine endpoint URL & Network
const rpcUrl = process.env.ZCASH_RPC_URL || "http://127.0.0.1:8232";
const headers = { "Content-Type": "application/json" };

// Detect cookie auth
let authStyle = "direct";
if (process.env.ZCASH_RPC_USER && process.env.ZCASH_RPC_PASSWORD) {
  const token = Buffer.from(`${process.env.ZCASH_RPC_USER}:${process.env.ZCASH_RPC_PASSWORD}`).toString("base64");
  headers["Authorization"] = `Basic ${token}`;
  authStyle = "basic auth";
} else {
  const cookiePath = process.env.ZCASH_RPC_COOKIE_FILE || join(homedir(), ".cache/zebra/.cookie");
  try {
    if (statSync(cookiePath).isFile()) {
      const cookieData = readFileSync(cookiePath, "utf8").trim();
      if (cookieData.includes(":")) {
        const token = Buffer.from(cookieData).toString("base64");
        headers["Authorization"] = `Basic ${token}`;
        authStyle = `cookie auth (${cookiePath})`;
      }
    }
  } catch {}
}

const payload = {
  jsonrpc: "2.0",
  id: "zpulse-cli",
  method,
  params,
};

if (isDryRun) {
  console.log("=== Dry Run Mode: JSON-RPC Payload ===");
  console.log(`Endpoint: ${rpcUrl} [${authStyle}]`);
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const start = Date.now();
try {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const latency = Date.now() - start;
  const json = await res.json();

  if (json.error) {
    console.error(`\x1b[31m[Error ${json.error.code || res.status}]\x1b[0m ${json.error.message} (${latency}ms)`);
    process.exit(1);
  }

  // Print formatted result
  console.log(JSON.stringify(json.result ?? json, null, 2));
} catch (err) {
  console.error(`\x1b[31m[Transport Error]\x1b[0m Could not connect to ${rpcUrl}: ${err.message}`);
  console.error(`Hint: Check if zebrad is running on Mainnet (8232) or Testnet (18232).`);
  process.exit(1);
}
