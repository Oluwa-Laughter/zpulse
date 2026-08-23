# ZPulse

**A Zcash network observatory.** Not a dashboard that echoes `getblockcount` into a card — a page
that uses the node's own numbers to *verify* things about the shielded chain that no single RPC field
gives you.

Built for the Zcash Foundation Sprint Mini Build Challenge.

The premise comes from the workshop deck's claim about Ironwood: *at activation, users can
independently verify the circulating supply by checking active pool balances.* ZPulse does exactly
that, live, and shows its work — every panel names the RPC methods behind it, and the RPC console
lets you re-run any of those calls by hand and read the raw reply.

```bash
cd zpulse && npm install && npm run dev
```

That works with **no credentials** — the app starts in demo mode against a deterministic synthetic
node so the whole UI is explorable. Add an endpoint to `.env.local` to point it at a real one.

---

## What it does

Four pages.

### `/` — landing

The pitch, plus a live tip ticker. The ticker polls the two cheapest endpoints on their own cadences
(height every 10s, chain summary every 30s) rather than refetching everything on the fast interval,
because the same one number at six times the request cost is not a better ticker.

### `/observatory` — the shielded chain

- **Supply integrity.** A stacked bar of value per pool, the shielded share as a percentage, and the
  per-pool balances table. Pools are rendered from whatever `valuePools` actually returns — nothing
  is hardcoded, so Ironwood (activated July 2026) and any future pool appear without a code change.
  `lockbox` is treated as a value pool but *not* as shielded value, because it isn't.
- **Independent cross-check.** ZPulse computes expected issuance from the ZIP-208 halving schedule
  itself, then asks the node `getblocksubsidy` for the same height and puts the two side by side. Two
  independent derivations agreeing is a much stronger claim than one number displayed confidently.
- **Turnstile.** Orchard is exit-only after Ironwood, so value drains out of it. The chart is signed
  per-block deltas around zero for the largest flows in the window, plus a cumulative line — you can
  watch value migrate between pools block by block.
- **Privacy mix.** The last N blocks, one column each, with every transaction classified as
  coinbase / transparent / shielding / deshielding / mixed / fully-shielded from its spend, output
  and action counts. Plus which pools those transactions actually touched.
- **Upgrade timeline.** The `upgrades` map rendered as activated / pending, with blocks-to-go and an
  ETA computed from *measured* average block time — labelled `measured` when it is, `target` when it
  falls back to the 75-second block target.

### `/node` — the endpoint

- **The dialect report.** zcashd and Zebra implement different method sets. ZPulse probes the node
  once and records what it answered; this table is that probe made visible. The `unsupported` rows
  are the interesting ones — they are the calls the app is deliberately routing around.
- **Per-method latency**, measured inside the transport on every real call, with a sparkline per
  method. This is how you tell a slow provider from a slow app.
- **Request budget.** Cache hit rate, upstream calls, coalesced reads. On screen because it is a
  load-bearing claim, not an implementation detail — see [Surviving a request quota](#surviving-a-request-quota).
- **Alerts and history.** Peer count, stall detection and sync thresholds, plus sparklines from the
  poller's recorded time series.

### `/rpc` — the console

Every method ZPulse uses, runnable by hand, with the **exact JSON-RPC envelope that was sent** shown
next to the node's reply and the round-trip latency. Plus chained recipes
(`getblockcount → getblockhash → getblock`) that run one validated call at a time, substituting the
previous result — the same pattern the panels use internally.

The form is built from the server's own allowlist, fetched at runtime rather than duplicated in the
client, so it cannot drift. Methods the node does not implement are **marked, not hidden**: running
`getmempoolinfo` against Zebra and seeing the −32601 come back is the clearest possible demonstration
of why the dialect layer exists.

---

## RPC methods

16 methods, against a requirement of 3. Each one is here because something on screen needs it.
(`getblock` appears twice below because its two verbosity modes feed two different panels.)

| Method | What ZPulse uses it for |
| --- | --- |
| `getblockchaininfo` | The workhorse. Tip, chain, difficulty, sync progress, **`valuePools`**, `upgrades`, `consensus`. |
| `getblock` (verbosity 1) | Per-block `valueDelta` for each pool — the turnstile chart. |
| `getblock` (verbosity 2) | Inline transaction objects — the privacy mix. |
| `getblockcount` | The landing-page ticker: the cheapest live signal there is. |
| `getbestblockhash` | Tip identity when `getblockchaininfo` doesn't carry it. |
| `getblockhash` | Height → hash when walking a window of blocks. |
| `getblockheader` | Timestamps, for measured average block time and the upgrade ETA. |
| `z_gettreestate` | Per-pool commitment tree roots — the shielded-state fingerprint, shown as independent evidence next to the balances. |
| `getblocksubsidy` | Issuance split including the lockbox stream; cross-checks ZPulse's own ZIP-208 model. |
| `getrawtransaction` | Privacy-mix fallback where `getblock` verbosity 2 is unavailable. |
| `getrawmempool` (verbose) | Mempool size and bytes — the Zebra-compatible path. |
| `getmempoolinfo` | The zcashd fast path when the node has it. Expect `unsupported` on Zebra. |
| `getpeerinfo` | Peer count, inbound/outbound split, best peer height. |
| `getnetworkinfo` | Version and connection count on zcashd. Expect `unsupported` on Zebra. |
| `getnetworksolps` | Network hashrate. |
| `getmininginfo` | Hashrate fallback when `getnetworksolps` is unavailable. |
| `getinfo` | Node version — the one field both dialects agree on. |

Two methods that carry more weight than the rest:

**`getblock` is why this app fits in a free tier.** Verbosity ≥1 returns a `valuePools` array with a
`valueDelta` per pool, and verbosity 2 returns full transactions inline. So the turnstile chart and
the privacy mix each cost **one RPC call per block** — not one per transaction. And because block data
is immutable, it caches by hash forever.

**`getblockchaininfo` is read for fields most explorers ignore.** `valuePools` is the supply panel.
`upgrades` is the timeline. Both are already in a response that has to be fetched anyway.

### Methods that are *not* reachable

`/api/rpc` validates against a fixed allowlist of the read-only methods above. `stop`,
`sendrawtransaction`, `submitblock`, `generate`, `setban`, `addnode` and every `z_send*` / wallet
method are unreachable **by construction** — the console cannot name a method that isn't in the
table, so there is no denylist to keep up to date. There is also a drift check asserting the
allowlist and the capability-probe table describe the same method set.

---

## Setup

```bash
cd zpulse
npm install
cp .env.local.example .env.local
```

`.env.local.example` documents all 18 variables the code reads, and nothing it doesn't. You need
one: `ZCASH_RPC_URL`.

### Option A — demo mode (no endpoint)

Leave `ZCASH_RPC_URL` blank. Every page renders from a deterministic synthetic node that emulates a
Zebra-flavoured endpoint *including its dialect gaps*, so the capability table and the −32601 demo
both work.

Demo mode is badged in amber on every page, and it is **never** a fallback for a failed live call. If
you point ZPulse at a broken node it shows you a broken node. An unbadged demo would be a lie about a
live-data app.

### Option B — hosted provider

Free Zcash RPC endpoints put the access token in the URL path and need no username or password:

```
ZCASH_RPC_URL=https://go.getblock.io/<your-access-token>
```

Nothing else to set. ZPulse sends no `Authorization` header when user and password are blank.

> **The token is in the URL, so the URL is a credential.** ZPulse only ever reports the *host* to the
> browser — never the path. There is no `NEXT_PUBLIC_*` anything in this project, error messages are
> scrubbed of the URL, and there's a test asserting no route response contains a URL even when the
> node is unreachable.

### Option C — local zebrad

Zebra's RPC port has no auth. Enable it in `~/.config/zebrad.toml`:

```toml
[rpc]
listen_addr = "127.0.0.1:8232"
```

```
ZCASH_RPC_URL=http://127.0.0.1:8232
```

A syncing node is fine — the sync percentage and the "not at tip" state are part of what `/node`
shows. Pool balances need the sync to have passed the heights you're looking at.

### Option D — local zcashd

Basic auth, from your `zcash.conf`:

```
ZCASH_RPC_URL=http://127.0.0.1:8232
ZCASH_RPC_USER=<rpcuser>
ZCASH_RPC_PASSWORD=<rpcpassword>
```

---

## Running it

### Check the endpoint before blaming the app

```bash
npm run probe
```

Dependency-free, no TypeScript, no Next server. It calls every method once — `getblock` at both
verbosities — and prints `ok` / `unsupported` / `error` with a latency each, feeding heights and
hashes from earlier results so nothing is hardcoded to a chain. If this prints latencies, your endpoint is fine and anything still
broken afterwards is ZPulse's fault.

**Expect some `unsupported` lines.** On Zebra, `getmempoolinfo` and `getnetworkinfo` will fail with
−32601, and routing around that is the dialect layer's entire job. Either result is a pass; the script
only exits non-zero if *nothing* answered.

It writes the real response shapes to `lib/rpc/fixtures/recorded/` (gitignored) so you have them for
reference without committing anything about your endpoint.

### Start it

```bash
npm run dev
```

Then <http://localhost:3000>.

### Record history

The `/node` sparklines need a time series, and the alert rules need previous state to compare
against. In another terminal:

```bash
npm run poll
```

It's a loop around one `POST /api/cron/poll`. All the logic — snapshot, rule evaluation, transition
detection, notification, append — lives in the route, so this script and a production scheduler
exercise exactly the same code path. Samples land in `data/history.jsonl`.

That route spends real RPC requests and can fire webhooks, so it's guarded: if `ZPULSE_CRON_SECRET`
is set the secret is required from anywhere, and if it isn't, the route only answers on localhost.
`npm run poll` works out of the box without leaving a public amplifier in the default config.

### Check it before submitting

```bash
npm run typecheck
```

```bash
npm run build
```

```bash
npm run verify
```

`verify` is a headless suite over the pure analysis, the cache, the console allowlist, the store and
the route handlers — including a pass that points the app at a dead host and asserts the five
node-backed GET routes each return a `degraded` envelope, never demo data, and never a URL that could
carry a token. It runs the TypeScript directly via Node's native type-stripping, so it needs
**Node 22.18+ or 24**. The app itself only needs Node 18.17.

---

## Surviving a request quota

Hosted providers meter requests, so caching here isn't an optimisation — it's the reason a page anyone
can open doesn't exhaust a daily budget.

| Data | Key | Invalidated |
| --- | --- | --- |
| Chain tip (height, hash, difficulty) | `tip` | TTL 20s — Zcash targets ~75s blocks, so faster polling buys nothing |
| Pool balances, tree state | `pools:<height>` | when the height changes |
| A specific block and its transactions | `block:<hash>` | never — block data is immutable |
| Capability probe | `caps` | process lifetime |

On top of the TTLs, identical concurrent reads are **coalesced**: ten open browser tabs and one tab
cost the node the same, because the second caller through the door awaits the first one's in-flight
promise instead of opening its own. Steady-state usage lands in the low thousands of requests per day.

The cache hit rate is displayed on `/node` so the claim is checkable rather than asserted. To watch it
work:

```bash
curl -s localhost:3000/api/chain | head -c 400
```

Run it twice inside the TTL and `meta.source` flips from `live` to `cache`.

---

## How it's built

Next 14 App Router, TypeScript, three runtime dependencies (`next`, `react`, `react-dom`) and four
dev type packages. No Tailwind, no chart library, no ORM — the charts are hand-rolled SVG and the
styling is one stylesheet of `z-`-prefixed semantic classes.

```
app/
  page.tsx                    landing + live ticker island
  observatory/  node/  rpc/   the three tool pages
  globals.css                 the whole design system
  api/                        11 route handlers, all { data, meta } envelopes
lib/
  rpc/client.ts               transport: both auth modes, timeout, retry, structured errors
  rpc/capabilities.ts         probe once, cache; −32601 ⇒ unsupported
  rpc/dialect.ts              data need → best method this particular node has
  rpc/console.ts              the allowlist and its param validation
  rpc/demo.ts                 the synthetic node
  rpc/telemetry.ts            per-method latency, recorded in the transport
  cache.ts                    TTL + height-keyed + in-flight coalescing
  analysis/                   supply · turnstile · privacy · upgrades · format (pure functions)
  alerts/                     rules + transition-only notification
  store/                      HistoryStore interface → JSONL implementation
components/                   Z-prefixed primitives, charts, the polling hook
scripts/                      probe.mjs · poll.mjs · verify.mjs
```

Three decisions worth naming:

**Every API response is an envelope**, `{ data, meta }`, where `meta` carries the source
(`live` / `cache` / `demo`), the age, the endpoint host and **the RPC methods that produced it**. That
last field is what the `ZMeta` line under each panel renders, and it's what turns the app from *trust
these figures* into *here is how to check them*.

**Capability detection reads errors, not documentation.** JSON-RPC returns −32601 for a method that
doesn't exist, and *any other error proves the method is there* — a parameter complaint is a
successful existence probe. So the dialect report is a fact about the node in front of you, not a
guess from its version string.

**The store is behind an interface.** JSONL append-only today, so a torn final line costs one row
rather than the file; swappable for Postgres without touching the routes. On a read-only filesystem it
falls back to memory and reports itself as non-durable on `/node` instead of pretending.

---

## Known limits

- **Ironwood's exact `valuePools` field name is not hardcoded anywhere**, deliberately — the pool
  rendering is driven entirely by what the node returns, and an unrecognised pool id gets a
  deliberately off-palette colour so it's visually obvious rather than silently mislabelled.
- **The first load of a wide window is the expensive one.** A 144-block turnstile window is 144
  `getblock` calls the first time and zero forever after. The server clamps the window regardless of
  what the query string asks for, so no URL can make ZPulse walk the chain.
- **`getblock` verbosity 2 isn't universal.** Where it's missing, the privacy mix falls back to
  verbosity 1 plus `getrawtransaction`, and the panel says so.
- **Latency stats and the cache live in process memory**, so they reset on restart and are per-instance
  on a multi-instance deploy. The JSONL history is the part that persists.

---

## Credits

Built for the [Zcash Foundation Sprint](https://zechub.wiki/hackathon) Mini Build Challenge.
RPC surface documented at [zechub.wiki/developers](https://zechub.wiki/developers).
