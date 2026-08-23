/**
 * Network upgrade timeline.
 *
 * `getblockchaininfo` returns an `upgrades` map keyed by consensus branch id,
 * each entry carrying a name, an activation height and a status. Almost nothing
 * reads it, which is a shame: combined with a measured average block time it
 * gives a live countdown to the next upgrade, and a record of every past one.
 *
 * The ETA is honest about what it is. Zcash's difficulty adjustment targets 75s
 * blocks but the realised average drifts, so an ETA extrapolated from a recent
 * window is an estimate whose error grows with distance. `confidence` says which
 * estimates to trust.
 */

import type { NetworkUpgrade } from "../rpc/types";

/** Zcash's post-Blossom target block spacing, in seconds. */
export const TARGET_BLOCK_SECONDS = 75;

export type UpgradeStatus = "active" | "pending" | "disabled" | "unknown";

export type UpgradeEntry = {
  /** Consensus branch id — the map key, useful and shown verbatim. */
  branchId: string;
  name: string;
  activationHeight: number;
  status: UpgradeStatus;
  /** The node's own status string, in case it uses a vocabulary we did not expect. */
  rawStatus: string;
  info?: string;
  /** Negative once activated: how many blocks ago. */
  blocksAway: number;
  /** null for upgrades already active. */
  etaSeconds: number | null;
  /** ISO timestamp, null when not applicable. */
  etaIso: string | null;
  /** How much to trust the ETA. */
  confidence: "measured" | "target" | "none";
};

export type UpgradeTimeline = {
  height: number;
  /** Oldest activation first. */
  upgrades: UpgradeEntry[];
  /** The next upgrade not yet active, if any. */
  next: UpgradeEntry | null;
  /** Most recent already-active upgrade. */
  current: UpgradeEntry | null;
  /** Seconds per block used for the ETAs, and where it came from. */
  blockSeconds: number;
  blockSecondsBasis: "measured" | "target";
  note?: string;
};

function normaliseStatus(raw: string): UpgradeStatus {
  const value = (raw ?? "").toLowerCase();
  if (value === "active" || value === "activated") return "active";
  if (value === "pending" || value === "waiting") return "pending";
  if (value === "disabled") return "disabled";
  return "unknown";
}

/**
 * Build the timeline.
 *
 * `avgBlockSeconds` comes from the turnstile window's measured block timestamps
 * when available; otherwise the consensus target is used and labelled as such.
 * An upgrade's own `status` is trusted over a height comparison, because a node
 * mid-sync knows its activation state better than our arithmetic does — but a
 * node reporting nothing usable falls back to comparing heights.
 */
export function buildUpgradeTimeline(input: {
  height: number;
  upgrades: Record<string, NetworkUpgrade> | null | undefined;
  avgBlockSeconds?: number | null;
  nowMs?: number;
}): UpgradeTimeline {
  const nowMs = input.nowMs ?? Date.now();
  const measured =
    typeof input.avgBlockSeconds === "number" &&
    Number.isFinite(input.avgBlockSeconds) &&
    input.avgBlockSeconds > 0
      ? input.avgBlockSeconds
      : null;

  // Reject an implausible measured average — a small window straddling a
  // difficulty swing can produce a figure that would make the ETA nonsense.
  const plausible =
    measured !== null && measured > TARGET_BLOCK_SECONDS / 5 && measured < TARGET_BLOCK_SECONDS * 5;

  const blockSeconds = plausible && measured !== null ? measured : TARGET_BLOCK_SECONDS;
  const blockSecondsBasis: "measured" | "target" = plausible ? "measured" : "target";

  const entries = Object.entries(input.upgrades ?? {});
  if (entries.length === 0) {
    return {
      height: input.height,
      upgrades: [],
      next: null,
      current: null,
      blockSeconds,
      blockSecondsBasis,
      note: "This node does not report an upgrades map, so the timeline is unavailable.",
    };
  }

  const upgrades: UpgradeEntry[] = entries
    .map(([branchId, upgrade]) => {
      const activationHeight =
        typeof upgrade.activationheight === "number" ? upgrade.activationheight : 0;
      const rawStatus = typeof upgrade.status === "string" ? upgrade.status : "";
      let status = normaliseStatus(rawStatus);
      if (status === "unknown") {
        status = input.height >= activationHeight ? "active" : "pending";
      }

      const blocksAway = activationHeight - input.height;
      const pending = status === "pending" && blocksAway > 0;
      const etaSeconds = pending ? blocksAway * blockSeconds : null;

      return {
        branchId,
        name: typeof upgrade.name === "string" ? upgrade.name : branchId,
        activationHeight,
        status,
        rawStatus,
        ...(upgrade.info ? { info: upgrade.info } : {}),
        blocksAway,
        etaSeconds,
        etaIso: etaSeconds === null ? null : new Date(nowMs + etaSeconds * 1000).toISOString(),
        confidence: etaSeconds === null ? "none" : blockSecondsBasis,
      } satisfies UpgradeEntry;
    })
    .sort((a, b) => a.activationHeight - b.activationHeight);

  const active = upgrades.filter((upgrade) => upgrade.status === "active");
  const pendingList = upgrades.filter((upgrade) => upgrade.status === "pending");

  return {
    height: input.height,
    upgrades,
    next: pendingList.length > 0 ? pendingList[0] : null,
    current: active.length > 0 ? active[active.length - 1] : null,
    blockSeconds,
    blockSecondsBasis,
  };
}
