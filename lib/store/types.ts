/**
 * The history store interface.
 *
 * ZPulse keeps a short time series — height, peers, mempool size, hashrate,
 * shielded total — so the node page can show trend rather than only instant
 * state. That is the entire storage requirement, which is why the shipped
 * implementation is a JSONL file rather than a database.
 *
 * It sits behind an interface anyway, for one concrete reason: the file store
 * cannot work on a read-only filesystem, which is what a serverless deployment
 * gives you. Swapping in Postgres, Redis or a KV store means writing one file
 * that satisfies `HistoryStore` and changing one line in ./index.ts — no route
 * handler, no component and no analysis code refers to a file path.
 */

import type { Snapshot } from "../data";

export type StoreKind = "jsonl" | "memory";

export type StoreDescription = {
  kind: StoreKind;
  /** Where rows go. A relative path for the file store, "process memory" otherwise. */
  location: string;
  /** False when appends are being dropped or held only in memory. */
  durable: boolean;
  entries: number;
  /** Why the store is not durable, when it is not. Rendered in the UI. */
  note?: string;
};

export interface HistoryStore {
  /** Append one snapshot. Must never throw — a failed write degrades, it does not break the poller. */
  append(snapshot: Snapshot): Promise<void>;
  /** Most recent rows, oldest first, at most `limit`. */
  recent(limit: number): Promise<Snapshot[]>;
  describe(): Promise<StoreDescription>;
}

/** Hard ceiling on rows returned in one read, so /api/history cannot be asked for everything. */
export const HISTORY_READ_MAX = 2_000;
export const HISTORY_READ_DEFAULT = 240;
