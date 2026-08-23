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
 *     fetches forever. An in-flight guard skips the tick instead.
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

  const inFlight = useRef(false);
  // Guards against a response landing after the component unmounted, and against
  // a stale response from a previous url overwriting a newer one.
  const generation = useRef(0);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    const mine = generation.current;
    setRefreshing(true);

    try {
      const response = await fetch(url, { cache: "no-store" });
      const body = (await response.json()) as Body<T>;
      if (mine !== generation.current) return;

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
      if (mine !== generation.current) return;
      setError({
        kind: "NetworkError",
        message: err instanceof Error ? err.message : "The request to ZPulse itself failed.",
      });
    } finally {
      if (mine === generation.current) {
        setLoading(false);
        setRefreshing(false);
      }
      inFlight.current = false;
    }
  }, [url]);

  useEffect(() => {
    generation.current += 1;
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
