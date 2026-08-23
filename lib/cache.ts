/**
 * In-process cache with request coalescing.
 *
 * This is load-bearing, not an optimisation. A hosted provider's free tier is
 * on the order of 40,000 requests/day; a dashboard polling every 10s would
 * spend that in about five hours, and every extra open browser tab would
 * multiply it. With this layer, N concurrent readers of the same key cost one
 * upstream request, and the two kinds of Zcash data get the TTL they deserve:
 *
 *   - chain tip          short TTL (~20s). Blocks target 75s, so polling faster
 *                        than this cannot learn anything new.
 *   - a specific block   immutable, keyed by hash or height, cached effectively
 *                        forever. This is what makes the 48-block turnstile
 *                        window affordable: the cost is paid once, not per view.
 *
 * Deliberately not Redis or `unstable_cache`: no new dependency, and the whole
 * point is to be swappable. A multi-instance deployment replaces this file's
 * three functions with a shared cache and nothing else changes.
 */

export const IMMUTABLE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Entry = { value: unknown; storedAt: number; expiresAt: number };

/** Bounded so a long-running process walking the chain cannot grow without limit. */
const MAX_ENTRIES = 1_500;

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

let hits = 0;
let misses = 0;

function evictIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return;
  // Map preserves insertion order, so the oldest key is the first one.
  const overflow = store.size - MAX_ENTRIES;
  let removed = 0;
  for (const key of store.keys()) {
    store.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

export type CacheResult<T> = {
  value: T;
  /** True when served from cache without touching the node. */
  hit: boolean;
  storedAt: number;
};

/**
 * Read `key` from cache, or produce it with `loader`.
 *
 * A failing loader is never cached — a transient node error would otherwise be
 * pinned in place for the whole TTL.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<CacheResult<T>> {
  const now = Date.now();
  const existing = store.get(key);

  if (existing && existing.expiresAt > now) {
    hits += 1;
    return { value: existing.value as T, hit: true, storedAt: existing.storedAt };
  }

  const pending = inflight.get(key);
  if (pending) {
    // Someone else is already fetching this exact key; ride along.
    hits += 1;
    const value = (await pending) as T;
    return { value, hit: true, storedAt: store.get(key)?.storedAt ?? now };
  }

  misses += 1;
  const promise = loader()
    .then((value) => {
      const storedAt = Date.now();
      store.set(key, { value, storedAt, expiresAt: storedAt + ttlMs });
      evictIfNeeded();
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  const value = (await promise) as T;
  return { value, hit: false, storedAt: store.get(key)?.storedAt ?? Date.now() };
}

/** Drop every key starting with `prefix`. Used when the tip advances. */
export function invalidatePrefix(prefix: string): number {
  let dropped = 0;
  for (const key of Array.from(store.keys())) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      dropped += 1;
    }
  }
  return dropped;
}

export function cacheStats(): { entries: number; hits: number; misses: number; hitRate: number } {
  const total = hits + misses;
  return {
    entries: store.size,
    hits,
    misses,
    hitRate: total === 0 ? 0 : hits / total,
  };
}

/** Test seam. */
export function clearCache(): void {
  store.clear();
  inflight.clear();
  hits = 0;
  misses = 0;
}

function envInt(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** TTL for anything that changes when a block arrives. */
export function tipTtlMs(): number {
  return envInt("ZPULSE_TIP_TTL_MS", 20_000);
}

/** TTL for things that move slowly: peers, hashrate, capability-adjacent data. */
export function slowTtlMs(): number {
  return envInt("ZPULSE_SLOW_TTL_MS", 120_000);
}
