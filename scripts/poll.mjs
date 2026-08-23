/**
 * Development poller.  node scripts/poll.mjs
 *
 * Ticks /api/cron/poll on an interval so the /node page has history to draw and
 * the alert rules have preceding state to compare against. In production you would
 * point a platform cron at that route instead; this exists because "install a cron
 * daemon" is a bad first step for someone evaluating the app.
 *
 * It is a loop around one fetch on purpose. All the logic — snapshot, rule
 * evaluation, transition detection, notification, append — lives in the route, so
 * this script and a production scheduler exercise exactly the same code path. A
 * poller that took its own snapshots would be a second implementation to keep in
 * step with the first.
 *
 * Because it talks to localhost, it needs no secret. If ZPULSE_CRON_SECRET is set
 * the route requires it even locally, so the script forwards it when present.
 *
 * Usage:
 *   node scripts/poll.mjs                  every 60s against localhost:3000
 *   node scripts/poll.mjs --interval 20    every 20s
 *   node scripts/poll.mjs --once           one tick, then exit
 *   ZPULSE_URL=http://localhost:4000 node scripts/poll.mjs
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value && !value.startsWith("--") ? value : true;
}

/** Only ZPULSE_CRON_SECRET is needed here — the RPC credentials stay in the server. */
async function loadSecret() {
  if (process.env.ZPULSE_CRON_SECRET) return process.env.ZPULSE_CRON_SECRET.trim();
  try {
    const text = await readFile(resolve(ROOT, ".env.local"), "utf8");
    const match = text.match(/^\s*ZPULSE_CRON_SECRET\s*=\s*(.*)$/m);
    if (!match) return "";
    return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    return "";
  }
}

const base = (process.env.ZPULSE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const url = `${base}/api/cron/poll`;
const once = process.argv.includes("--once");
const intervalSeconds = Math.max(5, Number(flag("interval", 60)) || 60);
const secret = await loadSecret();

const DIM = process.stdout.isTTY ? "[2m" : "";
const OFF = process.stdout.isTTY ? "[0m" : "";

let ticks = 0;
let failures = 0;

async function tick() {
  ticks += 1;
  const stamp = new Date().toISOString().slice(11, 19);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    });
    const body = await response.json().catch(() => null);

    if (!response.ok) {
      failures += 1;
      const message = body?.error?.message ?? `HTTP ${response.status}`;
      process.stdout.write(`${stamp}  tick ${ticks} refused — ${message}\n`);
      return;
    }

    const snapshot = body?.data?.snapshot ?? {};
    const started = body?.data?.started ?? [];
    const cleared = body?.data?.cleared ?? [];
    const active = body?.data?.active ?? [];

    process.stdout.write(
      `${stamp}  height ${snapshot.height ?? "—"}` +
        `  peers ${snapshot.peers ?? "—"}` +
        `  mempool ${snapshot.mempoolSize ?? "—"}` +
        `  shielded ${snapshot.shieldedZec === null || snapshot.shieldedZec === undefined ? "—" : Math.round(snapshot.shieldedZec).toLocaleString()}` +
        `${active.length > 0 ? `  ${DIM}${active.length} alert(s) active${OFF}` : ""}\n`,
    );

    // Transitions only. An alert that is still active prints nothing on later
    // ticks, which is the same rule the webhook notifier follows — otherwise a
    // node down overnight is ten thousand identical lines.
    for (const alert of started) process.stdout.write(`          ▲ ${alert.severity}: ${alert.message}\n`);
    for (const alert of cleared) process.stdout.write(`          ▼ resolved: ${alert.message}\n`);
  } catch (err) {
    failures += 1;
    const reason = err?.cause?.code === "ECONNREFUSED" || /fetch failed/i.test(err?.message ?? "")
      ? `cannot reach ${base} — is "npm run dev" running?`
      : (err?.message ?? String(err));
    process.stdout.write(`${stamp}  tick ${ticks} failed — ${reason}\n`);
  }
}

process.stdout.write(
  `\nZPulse poller → ${url}\n${DIM}  every ${intervalSeconds}s${secret ? ", authenticated" : ""}. Ctrl-C to stop.${OFF}\n\n`,
);

await tick();

if (once) {
  process.exit(failures > 0 ? 1 : 0);
}

const timer = setInterval(() => void tick(), intervalSeconds * 1000);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearInterval(timer);
    process.stdout.write(`\n  ${ticks} tick(s), ${failures} failure(s).\n\n`);
    process.exit(0);
  });
}
