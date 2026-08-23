/**
 * The store singleton.
 *
 * This module is the only place that decides *which* implementation is in use.
 * Everything else imports `historyStore()` and talks to the interface, so
 * swapping the file store for Postgres is a change to this file and nothing else.
 *
 * Module-scope singleton rather than a per-request instance, because the JSONL
 * store keeps an in-process append queue and a memory-fallback buffer; a fresh
 * instance per request would lose both. Next's dev-mode hot reload re-evaluates
 * modules, so the instance is parked on `globalThis` to survive that — otherwise
 * every save during development would silently reset the fallback state and the
 * bug would only ever appear in production.
 */

import { JsonlHistoryStore } from "./jsonl";
import type { HistoryStore } from "./types";

/** Default is a gitignored folder in the project. Override for a mounted volume. */
const DEFAULT_PATH = "data/history.jsonl";

function historyPath(): string {
  const configured = process.env.ZPULSE_HISTORY_PATH?.trim();
  return configured && configured !== "" ? configured : DEFAULT_PATH;
}

const globalRef = globalThis as typeof globalThis & { __zpulseHistoryStore?: HistoryStore };

export function historyStore(): HistoryStore {
  if (!globalRef.__zpulseHistoryStore) {
    globalRef.__zpulseHistoryStore = new JsonlHistoryStore(historyPath());
  }
  return globalRef.__zpulseHistoryStore;
}

export type { HistoryStore, StoreDescription } from "./types";
export { HISTORY_READ_DEFAULT, HISTORY_READ_MAX } from "./types";
