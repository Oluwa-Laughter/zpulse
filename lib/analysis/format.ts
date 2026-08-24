/**
 * Display formatting. Pure functions, no React, so routes and components can
 * share them and they stay trivially testable.
 */

/** 1 ZEC = 100,000,000 zatoshi. */
export const ZATOSHI_PER_ZEC = 100_000_000;

export function zatToZec(zat: number): number {
  return zat / ZATOSHI_PER_ZEC;
}

/**
 * ZEC with thousands separators. Defaults to 2 decimals because pool balances
 * are large; pass more for per-block amounts where the tail matters.
 */
export function formatZec(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Compact ZEC for tight spaces: 1.9M, 548.9K. */
export function formatZecCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(2);
}

/** Signed, for value-pool deltas where direction is the whole point. */
export function formatDelta(value: number | null | undefined, decimals = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString("en-US");
}

export function formatPercent(fraction: number | null | undefined, decimals = 2): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** Zcash mining is measured in solutions per second, not hashes. */
export function formatSolps(solps: number | null | undefined): string {
  if (solps === null || solps === undefined || !Number.isFinite(solps)) return "—";
  if (solps >= 1e12) return `${(solps / 1e12).toFixed(2)} TSol/s`;
  if (solps >= 1e9) return `${(solps / 1e9).toFixed(2)} GSol/s`;
  if (solps >= 1e6) return `${(solps / 1e6).toFixed(2)} MSol/s`;
  if (solps >= 1e3) return `${(solps / 1e3).toFixed(2)} kSol/s`;
  return `${solps.toFixed(0)} Sol/s`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(2)} TiB`;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

/** Middle-truncated hash: 0000a1b2c3…9f8e7d6c. */
export function formatHash(hash: string | null | undefined, lead = 10, tail = 8): string {
  if (!hash) return "—";
  if (hash.length <= lead + tail + 1) return hash;
  return `${hash.slice(0, lead)}…${hash.slice(-tail)}`;
}

export function formatDifficulty(difficulty: number | null | undefined): string {
  if (difficulty === null || difficulty === undefined || !Number.isFinite(difficulty)) return "—";
  if (difficulty >= 1e9) return `${(difficulty / 1e9).toFixed(2)}B`;
  if (difficulty >= 1e6) return `${(difficulty / 1e6).toFixed(2)}M`;
  if (difficulty >= 1e3) return `${(difficulty / 1e3).toFixed(2)}K`;
  return difficulty.toFixed(2);
}

/** "4m 12s ago", "just now". Takes a unix timestamp in seconds. */
export function formatAgo(unixSeconds: number | null | undefined, nowMs = Date.now()): string {
  if (unixSeconds === null || unixSeconds === undefined || !Number.isFinite(unixSeconds)) return "—";
  const seconds = Math.max(0, Math.floor(nowMs / 1000 - unixSeconds));
  return `${formatDuration(seconds)} ago`;
}

/** Seconds as a compact human duration. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${total % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** Title case for pool ids that arrive lowercase from the node. */
export function titleCasePoolId(id: string): string {
  if (!id) return "Unknown";
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Format unix seconds into standard UTC date/time string: "2024-11-23 09:23:02 UTC" */
export function formatUtcDateTime(unixSeconds: number | null | undefined): string {
  if (unixSeconds === null || unixSeconds === undefined || !Number.isFinite(unixSeconds)) return "—";
  const d = new Date(unixSeconds * 1000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hours = String(d.getUTCHours()).padStart(2, "0");
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  const seconds = String(d.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds} UTC`;
}

/** Age formatting supporting past, recent, and future block timestamps */
export function formatBlockAge(unixSeconds: number | null | undefined, nowMs = Date.now()): string {
  if (unixSeconds === null || unixSeconds === undefined || !Number.isFinite(unixSeconds)) return "—";
  const diff = Math.floor(nowMs / 1000 - unixSeconds);
  if (diff < -30) {
    return `in ${formatDuration(Math.abs(diff))}`;
  }
  if (Math.abs(diff) <= 30) {
    return "just now";
  }
  return `${formatDuration(diff)} ago`;
}
