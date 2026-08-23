/**
 * JSONL history store.
 *
 * One JSON object per line, appended. That format is chosen over JSON-array-in-a-
 * file for a specific reason: appending to a JSON array means reading it, parsing
 * it, pushing, re-serialising and rewriting the whole thing — so a crash
 * mid-write truncates the file and loses every row. Appending a line cannot
 * corrupt the lines already there, and a torn final line is one bad row that the
 * reader skips.
 *
 * Two things this file is careful about:
 *
 * 1. **Reads are bounded by bytes, not rows.** `recent()` stats the file and
 *    reads only the last chunk of it, so the cost of rendering a sparkline does
 *    not grow with how long the poller has been running. The first line of that
 *    chunk is usually a fragment, so it is dropped.
 *
 * 2. **A read-only filesystem is expected, not exceptional.** Serverless hosts
 *    give you one. On the first EROFS/EACCES the store flips to holding rows in
 *    memory, keeps working, and says `durable: false` — which the node page
 *    renders, so nobody is told their history is being saved when it is not.
 */

import { appendFile, mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Snapshot } from "../data";
import { HISTORY_READ_MAX, type HistoryStore, type StoreDescription } from "./types";

/** Bytes to read from the tail. ~200 bytes/row, so this covers a few thousand rows. */
const TAIL_BYTES = 512 * 1024;

/**
 * Rows to keep. At one snapshot a minute this is about two weeks, and the file
 * stays under a couple of megabytes. Trimming is a rewrite, so it happens rarely.
 */
const MAX_ROWS = 20_000;
const TRIM_CHECK_BYTES = 4 * 1024 * 1024;

export class JsonlHistoryStore implements HistoryStore {
  private readonly path: string;
  private readonly displayPath: string;
  /** Set once a write fails unrecoverably; every later append goes to memory. */
  private fallbackReason: string | null = null;
  private memory: Snapshot[] = [];
  /** Serialises appends within this process so two ticks cannot interleave a trim. */
  private queue: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = resolve(path);
    this.displayPath = path;
  }

  async append(snapshot: Snapshot): Promise<void> {
    const run = this.queue.then(() => this.appendNow(snapshot));
    // Keep the chain alive even if this append failed, so one bad tick does not
    // wedge every later one.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async appendNow(snapshot: Snapshot): Promise<void> {
    if (this.fallbackReason !== null) {
      this.pushMemory(snapshot);
      return;
    }

    const line = `${JSON.stringify(snapshot)}\n`;
    try {
      await mkdir(dirname(this.path), { recursive: true });
      // A single append-mode write of a short line is atomic enough on POSIX that
      // two concurrent writers cannot interleave within it. The in-process queue
      // above covers the ordering we actually control.
      await appendFile(this.path, line, "utf8");
      await this.trimIfLarge();
    } catch (err) {
      this.fallbackReason = describeWriteFailure(err);
      this.pushMemory(snapshot);
    }
  }

  private pushMemory(snapshot: Snapshot): void {
    this.memory.push(snapshot);
    // Memory is the degraded path; keep it small enough that a long-running
    // process with a read-only disk cannot leak unboundedly.
    if (this.memory.length > 1_000) this.memory = this.memory.slice(-1_000);
  }

  /** Rewrite the file with only the newest MAX_ROWS rows. Cheap because it is rare. */
  private async trimIfLarge(): Promise<void> {
    const info = await stat(this.path).catch(() => null);
    if (!info || info.size < TRIM_CHECK_BYTES) return;

    const text = await readFile(this.path, "utf8").catch(() => null);
    if (text === null) return;

    const lines = text.split("\n").filter((line) => line.trim() !== "");
    if (lines.length <= MAX_ROWS) return;

    const kept = lines.slice(-MAX_ROWS).join("\n");
    // Write-then-rename would be safer, but a truncated history file is a
    // cosmetic loss and rename semantics differ across the hosts this might run
    // on. Losing rows here does not affect any live reading.
    await writeFile(this.path, `${kept}\n`, "utf8");
  }

  async recent(limit: number): Promise<Snapshot[]> {
    const capped = Math.max(1, Math.min(Math.floor(limit), HISTORY_READ_MAX));

    const rows = await this.readTail().catch(() => [] as Snapshot[]);

    // When the file store fell back to memory mid-run, the memory rows are the
    // newer ones and belong after whatever made it to disk. Sorting by timestamp
    // rather than concatenating blind, because the two sources can overlap.
    const combined = this.memory.length > 0 ? [...rows, ...this.memory] : rows;
    combined.sort((a, b) => a.at - b.at);
    return combined.slice(-capped);
  }

  private async readTail(): Promise<Snapshot[]> {
    const info = await stat(this.path).catch(() => null);
    if (!info || info.size === 0) return [];

    const start = Math.max(0, info.size - TAIL_BYTES);
    const length = info.size - start;

    const handle = await open(this.path, "r");
    let text: string;
    try {
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      text = buffer.toString("utf8");
    } finally {
      await handle.close();
    }

    const lines = text.split("\n");
    // Reading from an offset almost certainly landed mid-line; drop the fragment.
    if (start > 0) lines.shift();

    const rows: Snapshot[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      try {
        const parsed = JSON.parse(trimmed) as Snapshot;
        // A row without a timestamp cannot be plotted or ordered, so it is not a row.
        if (typeof parsed?.at === "number") rows.push(parsed);
      } catch {
        // A torn final line from a crashed write. Skipping it is the whole reason
        // this format was chosen over a JSON array.
      }
    }
    return rows;
  }

  async describe(): Promise<StoreDescription> {
    const rows = await this.readTail().catch(() => [] as Snapshot[]);
    if (this.fallbackReason !== null) {
      return {
        kind: "memory",
        location: "process memory",
        durable: false,
        entries: rows.length + this.memory.length,
        note: this.fallbackReason,
      };
    }
    return {
      kind: "jsonl",
      location: this.displayPath,
      durable: true,
      entries: rows.length,
    };
  }
}

function describeWriteFailure(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
    return "The filesystem is read-only, so history is being held in memory and will be lost on restart. This is normal on serverless hosts; point ZPULSE_HISTORY_PATH at a writable volume, or swap lib/store/index.ts for a database implementation.";
  }
  if (code === "ENOSPC") {
    return "No disk space left, so history is being held in memory.";
  }
  return `History could not be written to disk (${code ?? "unknown error"}), so it is being held in memory.`;
}
