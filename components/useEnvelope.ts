"use client";

/**
 * The one hook every live panel uses.
 *
 * Three things it has to get right, and each was a bug waiting to happen:
 *
 *  1. **Never show a stale error next to fresh data, or vice versa.** A poll that
 *     fails replaces `error` but keeps the last good `data`, so a blip does not
 *     blank the screen — and the meta strip reports the age, so nobody mistakes
 *     held-over data for current data.
 *
 *  2. **Do not stack requests.** A slow node plus a 10s interval means overlapping
 *     fetches forever. An in-flight guard skips the tick instead — but only within
 *     one generation. Blocking a *new* generation on the previous one's in-flight
 *     request is what used to wedge the non-polling panels; see `inFlight` below.
 *
 *  3. **Stop when the tab is hidden.** A dashboard left open in a background tab
 *     would otherwise burn the RPC quota all night for nobody. Polling resumes,
 *     and fetches immediately, on focus.
 *
 * The server's error responses keep the envelope shape (`{ data: null, error, meta }`),
 * so a failed panel still has `meta.notes` to explain itself — that is what makes
 * the "point it at a bad host" demo show a reason rather than a blank card.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Meta } from "@/lib/data";

export type ApiError = { kind: string; message: string };

/**
 * The request-coordination state machine, extracted so it can be tested.
 *
 * It is two facts — which generation of this hook is current, and which
 * generation owns the in-flight request — and the whole RPC-console outage lived
 * in how they interacted. React's own semantics are not involved, so this is
 * exercised directly in scripts/verify.mjs against the exact StrictMode mount
 * sequence rather than being reasoned about.
 *
 * A "generation" is one mount, or one url. It increments on remount and on a url
 * change, and a result from an older generation is discarded.
 */
export type LoadGate = {
  /** Bump on mount and on a url change. Returns the new generation. */
  nextGeneration: () => number;
  /**
   * Claim the right to fetch. Returns the claiming generation, or null when a
   * request from *this same* generation is already in the air — which is the
   * coalescing that stops a slow node plus a 10s interval from stacking requests.
   *
   * Crucially it does not refuse a *newer* generation. Refusing one deadlocks:
   * the new generation never fetches, the old generation's result is discarded as
   * stale, and nothing is left to clear `loading`.
   */
  begin: () => number | null;
  /** Whether `mine`'s result is still worth applying. */
  isCurrent: (mine: number) => boolean;
  /** Release the slot if still ours. Returns whether `mine` is still current. */
  end: (mine: number) => boolean;
};

export function createLoadGate(): LoadGate {
  let generation = 0;
  let inFlight: number | null = null;

  return {
    nextGeneration: () => (generation += 1),
    begin: () => {
      const mine = generation;
      if (inFlight === mine) return null;
      inFlight = mine;
      return mine;
    },
    isCurrent: (mine) => mine === generation,
    end: (mine) => {
      // Only release if still ours — a newer generation may have claimed the slot
      // while this request was in the air.
      if (inFlight === mine) inFlight = null;
      return mine === generation;
    },
  };
}

export type Live<T> = {
  data: T | null;
  meta: Meta | null;
  error: ApiError | null;
  loading: boolean;
  /** True while a background poll is in flight and we already have data. */
  refreshing: boolean;
  refresh: () => void;
};

type Body<T> = { data: T | null; meta: Meta; error?: ApiError };

export function useEnvelope<T>(url: string, intervalMs = 0): Live<T> {
  const [data, setData] = useState<T | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * See createLoadGate. Lazily constructed so a re-render does not allocate a
   * throwaway, and held in a ref so it survives every render of this mount.
   */
  const gateRef = useRef<LoadGate | null>(null);
  if (gateRef.current === null) gateRef.current = createLoadGate();
  const gate = gateRef.current;

  const load = useCallback(async () => {
    const mine = gate.begin();
    if (mine === null) return;
    setRefreshing(true);

    try {
      const response = await fetch(url, { cache: "no-store" });
      const body = (await response.json()) as Body<T>;
      if (!gate.isCurrent(mine)) return;

      setMeta(body.meta ?? null);
      if (body.error) {
        setError(body.error);
        // Keep whatever we had. A degraded panel with old numbers plus a visible
        // age is more useful than an empty one.
      } else {
        setError(null);
        setData(body.data ?? null);
      }
    } catch (err) {
      if (!gate.isCurrent(mine)) return;
      setError({
        kind: "NetworkError",
        message: err instanceof Error ? err.message : "The request to ZPulse itself failed.",
      });
    } finally {
      if (gate.end(mine)) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [url, gate]);

  useEffect(() => {
    gate.nextGeneration();
    setLoading(true);
    void load();

    if (intervalMs <= 0) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer === null) timer = setInterval(() => void load(), intervalMs);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void load();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, intervalMs]);

  return { data, meta, error, loading, refreshing, refresh: () => void load() };
}
