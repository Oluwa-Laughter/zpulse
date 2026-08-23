/**
 * Per-method RPC telemetry.
 *
 * Recorded centrally in lib/rpc/client.ts so every call is measured wherever it
 * originates, and surfaced on /node as latency per method. Two reasons this is
 * worth its ~60 lines: it is the honest way to show which methods the app
 * actually exercises at runtime, and when a panel is slow it tells you whether
 * the node or the app is responsible.
 *
 * Bounded ring buffer per method — this must not become a memory leak in a
 * process that runs for days.
 */

const MAX_SAMPLES = 24;

export type MethodStat = {
  method: string;
  calls: number;
  errors: number;
  lastLatencyMs: number | null;
  avgLatencyMs: number | null;
  minLatencyMs: number | null;
  maxLatencyMs: number | null;
  lastCalledAt: number | null;
  /** Recent latencies, oldest first — drives the sparkline on /node. */
  samples: number[];
};

const stats = new Map<string, MethodStat>();

function ensure(method: string): MethodStat {
  const existing = stats.get(method);
  if (existing) return existing;
  const fresh: MethodStat = {
    method,
    calls: 0,
    errors: 0,
    lastLatencyMs: null,
    avgLatencyMs: null,
    minLatencyMs: null,
    maxLatencyMs: null,
    lastCalledAt: null,
    samples: [],
  };
  stats.set(method, fresh);
  return fresh;
}

export function recordCall(method: string, latencyMs: number, ok: boolean): void {
  const stat = ensure(method);
  stat.calls += 1;
  if (!ok) stat.errors += 1;
  stat.lastCalledAt = Date.now();

  if (ok) {
    stat.lastLatencyMs = latencyMs;
    stat.samples.push(latencyMs);
    if (stat.samples.length > MAX_SAMPLES) stat.samples.shift();

    const sum = stat.samples.reduce((total, sample) => total + sample, 0);
    stat.avgLatencyMs = Math.round(sum / stat.samples.length);
    stat.minLatencyMs = Math.min(...stat.samples);
    stat.maxLatencyMs = Math.max(...stat.samples);
  }
}

/** Busiest methods first. */
export function methodStats(): MethodStat[] {
  return Array.from(stats.values())
    .map((stat) => ({ ...stat, samples: [...stat.samples] }))
    .sort((a, b) => b.calls - a.calls);
}

export function totalCalls(): { calls: number; errors: number } {
  let calls = 0;
  let errors = 0;
  for (const stat of stats.values()) {
    calls += stat.calls;
    errors += stat.errors;
  }
  return { calls, errors };
}

export function resetTelemetry(): void {
  stats.clear();
}
