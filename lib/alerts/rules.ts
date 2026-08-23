/**
 * Alert rules.
 *
 * Each rule reads the latest snapshot plus recent history and returns either
 * nothing or one alert. The poller then diffs the active set against the previous
 * tick's, so a notification fires when a problem *starts* or *clears* — not once
 * per poll for as long as it lasts. That distinction is the difference between an
 * alert channel someone reads and one they mute.
 *
 * Ported from the earlier prototype's `lib/alertRules.js`, whose transition-only
 * design and stall-check subtlety (see `checkStalled`) were already right. What is
 * new here: types, two rules that only make sense for a chain observatory, and
 * severities so the UI can rank them.
 *
 * Thresholds are environment-tunable because the right value depends on the node.
 * A freshly started node legitimately has two peers; a long-running one with two
 * peers has a problem.
 */

import type { Snapshot } from "../data";

export type AlertSeverity = "critical" | "warning";

export type Alert = {
  id: string;
  severity: AlertSeverity;
  message: string;
};

export type AlertSet = Record<string, Alert>;

function envNum(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function alertThresholds(): {
  minPeers: number;
  stallMinutes: number;
  minSyncProgress: number;
} {
  return {
    minPeers: envNum("ZPULSE_MIN_PEERS", 3),
    stallMinutes: envNum("ZPULSE_STALL_MINUTES", 20),
    minSyncProgress: envNum("ZPULSE_MIN_SYNC_PROGRESS", 0.999),
  };
}

type Rule = (current: Snapshot, history: Snapshot[]) => Alert | null;

/* ── rules ───────────────────────────────────────────────────────────────── */

const checkUnreachable: Rule = (current) => {
  if (current.reachable && !current.error) return null;
  return {
    id: "unreachable",
    severity: "critical",
    message: current.error ? `Node unreachable: ${current.error}` : "Node did not answer.",
  };
};

const checkLowPeers: Rule = (current) => {
  // Every rule below this point returns early when the node is unreachable.
  // Otherwise one outage produces five alerts describing the same outage, and the
  // transition log becomes noise at exactly the moment it needs to be readable.
  if (!current.reachable) return null;
  const { minPeers } = alertThresholds();
  if (current.peers === null || current.peers >= minPeers) return null;
  return {
    id: "low_peers",
    severity: "warning",
    message: `Peer count is ${current.peers}, below the minimum of ${minPeers}.`,
  };
};

const checkStalled: Rule = (current, history) => {
  if (!current.reachable || current.height === null) return null;
  const { stallMinutes } = alertThresholds();

  const cutoff = Date.now() - stallMinutes * 60_000;
  const window = history.filter((snapshot) => snapshot.at >= cutoff);

  // The current snapshot is included in the comparison on purpose. Without it, a
  // node that has just started advancing again still reads as stalled until the
  // old equal-height rows age out of the window — so the alert would clear
  // minutes after the problem did.
  const heights = [...window.map((snapshot) => snapshot.height), current.height].filter(
    (height): height is number => height !== null,
  );

  if (heights.length < 3) return null; // too few points to call it

  const first = heights[0] as number;
  if (!heights.every((height) => height === first)) return null;

  return {
    id: "stalled",
    severity: "critical",
    message: `Block height has not advanced from ${first} in the last ${stallMinutes} minutes.`,
  };
};

/**
 * A node still catching up reports a verification progress below 1. Worth an
 * alert of its own because every other panel's numbers are *correct but not
 * current* while it is true, and that is a confusing state to debug without
 * being told.
 */
const checkSyncing: Rule = (current) => {
  if (!current.reachable) return null;
  const { minSyncProgress } = alertThresholds();
  if (current.verificationProgress === null) return null;
  if (current.verificationProgress >= minSyncProgress) return null;
  return {
    id: "syncing",
    severity: "warning",
    message: `Node is ${(current.verificationProgress * 100).toFixed(2)}% synced, so pool balances and the privacy mix reflect an older tip.`,
  };
};

/**
 * Height going *backwards* between ticks.
 *
 * Shallow reorgs are normal and this will not see them: a one-block rollback
 * followed by two new blocks nets out to an advance between polls. What it does
 * catch is a node that has been repointed at a different network, restored from
 * an older snapshot, or has rolled back further than it has re-mined — all cases
 * where the observatory would otherwise keep drawing a confident chart of the
 * wrong chain.
 */
const checkHeightRegressed: Rule = (current, history) => {
  if (!current.reachable || current.height === null) return null;

  const previous = [...history].reverse().find((snapshot) => snapshot.height !== null);
  if (!previous || previous.height === null) return null;
  if (current.height >= previous.height) return null;

  const dropped = previous.height - current.height;
  return {
    id: "height_regressed",
    severity: "critical",
    message: `Height went backwards by ${dropped} block(s), from ${previous.height} to ${current.height}. A reorg this deep is unusual — check that the endpoint still points at the chain you expect.`,
  };
};

const RULES: Rule[] = [
  checkUnreachable,
  checkLowPeers,
  checkStalled,
  checkSyncing,
  checkHeightRegressed,
];

/**
 * Every rule currently failing.
 *
 * `history` is oldest-first and must NOT include `current` — several rules append
 * it themselves and would double-count it.
 */
export function evaluateAlerts(current: Snapshot, history: Snapshot[]): AlertSet {
  const active: AlertSet = {};
  for (const rule of RULES) {
    const result = rule(current, history);
    if (result) active[result.id] = result;
  }
  return active;
}

export type AlertTransitions = {
  started: Alert[];
  cleared: Alert[];
};

/**
 * What changed since the previous tick.
 *
 * `previousIds` comes from the last stored snapshot's own `alerts` field rather
 * than from process memory, so a restart does not re-announce every alert that
 * was already active before it.
 *
 * A cleared alert is reported by id only — the snapshot rows store ids, not
 * messages, and inventing a message for a condition that no longer holds would
 * mean describing state we no longer have.
 */
export function diffAlerts(previousIds: string[], active: AlertSet): AlertTransitions {
  const previous = new Set(previousIds);
  const started = Object.values(active).filter((alert) => !previous.has(alert.id));
  const cleared = [...previous]
    .filter((id) => !(id in active))
    .map((id) => ({ id, severity: "warning" as AlertSeverity, message: describeCleared(id) }));
  return { started, cleared };
}

const CLEARED_TEXT: Record<string, string> = {
  unreachable: "Node is answering again.",
  low_peers: "Peer count is back above the minimum.",
  stalled: "Block height is advancing again.",
  syncing: "Node has caught up to the tip.",
  height_regressed: "Height is advancing normally again.",
};

function describeCleared(id: string): string {
  return CLEARED_TEXT[id] ?? `Alert "${id}" is no longer active.`;
}
