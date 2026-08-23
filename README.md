# ZPulse

**A Zcash network observatory.** Not a dashboard that echoes `getblockcount` into a card — a page
that uses the node's own numbers to _verify_ things about the shielded chain that no single RPC field
gives you.

Built for the Zcash Foundation Sprint Mini Build Challenge.

The premise comes from the workshop deck's claim about Ironwood: _at activation, users can
independently verify the circulating supply by checking active pool balances._ ZPulse does exactly
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
  `lockbox` is treated as a value pool but _not_ as shielded value, because it isn't.
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
  ETA computed from _measured_ average block time — labelled `measured` when it is, `target` when it
  falls back to the 75-second block target.

### `/node` — the endpoint

- **The RPC surface, probed.** zcashd is deprecated, so the interesting question is no longer
  *which implementation* but *which zebrad* — `getmempoolinfo`, `getnetworkinfo` and per-pool
  `valueDelta` all arrived partway through Zebra's life. ZPulse probes the node once and records what
  it answered; this table is that probe made visible. Any `unsupported` row is a call the app is
  routing around. The node's **identity** is a separate fact, read from its own user agent — never
  inferred from which methods are missing, because a method Zebra lacked last year it implements
  today.
- **Per-method latency**, measured inside the transport on every real call, with a sparkline per
  method. This is how you tell a slow provider from a slow app.
- **Request budget.** Cache hits, misses, hit rate and live entry count. On screen because it is a
  load-bearing claim, not an implementation detail — see [Surviving a request quota](#surviving-a-request-quota).
- **Alerts and history.** Peer count, stall detection and sync thresholds, plus sparklines from the
  poller's recorded time series.

### `/rpc` — the console

Every method ZPulse uses, runnable by hand, with the **exact JSON-RPC envelope that was sent** shown
next to the node's reply and the round-trip latency. Plus chained recipes
(`getblockcount → getblockhash → getblock`) that run one validated call at a time, substituting the
previous result — the same pattern the panels use internally.

The form is built from the server's own allowlist, fetched at runtime rather than duplicated in the
client, so it cannot drift. Methods the node does not implement are **marked, not hidden** — that is
what the `version-tell` recipe is for: watching `getmempoolinfo` come back −32601 dates the node
you're pointed at, and is the clearest possible demonstration of why the dialect layer exists. Try it
against `ZPULSE_DEMO_PROFILE=zebra-legacy` if your own node is too new to fail.

---

## RPC methods

The challenge asks for **at least 3–5**. That is a floor, not a cap, and ZPulse reads 16 — so the
honest question is which of them are load-bearing and which are there for their own sake. The answer:
**five carry the panels, eleven exist because the sixteenth thing this app is about is what happens
when a node doesn't have a method.**

### The five that carry the panels

| Method                   | What ZPulse uses it for                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `getblockchaininfo`      | The workhorse. Tip, chain, difficulty, sync progress, **`valuePools`**, `upgrades`, `consensus`.                      |
| `getblock` (verbosity 1) | Per-block `valueDelta` for each pool — the turnstile chart.                                                          |
| `getblock` (verbosity 2) | Inline transaction objects — the privacy mix.                                                                        |
| `z_gettreestate`         | Per-pool commitment tree roots — the shielded-state fingerprint, shown as independent evidence next to the balances. |
| `getblocksubsidy`        | Issuance split including the lockbox stream; cross-checks ZPulse's own ZIP-208 model.                                 |

Take those five away and there is no app. `getblock` counts twice because its two verbosity modes
return genuinely different payloads and feed different panels.

Two of them carry more weight than the rest:

**`getblock` is why this app fits in a free tier.** Verbosity ≥1 returns a `valuePools` array with a
`valueDelta` per pool, and verbosity 2 returns full transactions inline. So the turnstile chart and
the privacy mix each cost **one RPC call per block** — not one per transaction. And because block data
is immutable, it caches by hash forever.

**`getblockchaininfo` is read for fields most explorers ignore.** `valuePools` is the supply panel.
`upgrades` is the timeline. Both are already in a response that has to be fetched anyway.

### The eleven that make the first five survive a real node

| Method                    | Role                        | What it's for                                                                                          |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `getblockcount`           | cheapest signal             | The landing-page ticker, and the tip fallback when `getblockchaininfo` is unavailable.                  |
| `getbestblockhash`        | tip fallback                | Tip identity when `getblockchaininfo` doesn't carry it.                                                 |
| `getblockheader`          | primary                     | Two calls at the ends of a 24-block span give measured average block time and the upgrade ETA.          |
| `getrawtransaction`       | fallback for `getblock` v2  | The privacy mix where verbosity 2 is unsupported — costs 1+N calls per block, and the panel says so.    |
| `getmempoolinfo`          | primary                     | Mempool size and bytes in one call. Absent on a zebrad old enough to predate it.                        |
| `getrawmempool` (verbose) | fallback for the above      | Sum the entry sizes client-side. `getrawmempool()` bare is the floor: a txid count, no byte total.      |
| `getpeerinfo`             | primary                     | Peer count, inbound/outbound split, best peer height.                                                   |
| `getnetworkinfo`          | primary                     | Node user agent and connection count. Also absent on an older zebrad.                                   |
| `getinfo`                 | fallback for the above      | Version and build. Deprecated on zcashd, and the only version read an older zebrad answers.             |
| `getnetworksolps`         | primary                     | Network hashrate.                                                                                       |
| `getmininginfo`           | fallback for the above      | Hashrate when `getnetworksolps` is unavailable.                                                          |

Five **primary / fallback pairs** in that table, and each pair is one dialect resolver in
`lib/rpc/dialect.ts`. That is the point of the count: a fallback you never call is a fallback you
never tested, and `/node` renders the probe that decides which side of each pair runs. Reducing this
to five methods would mean deleting the layer the `/node` page exists to show.

One honest exception. **`getblockhash`** is on the allowlist but no panel calls it — every panel
already has a height, and `getblock` accepts a height directly, so resolving to a hash first would be
a wasted round trip. It reaches a node only through the console, by hand or as the first step of the
`tip-to-block` recipe that demonstrates chaining one call's output into the next. Labelled here rather
than quietly counted.

### Methods that are _not_ reachable

`/api/rpc` validates against a fixed allowlist of the read-only methods above. `stop`,
`sendrawtransaction`, `submitblock`, `generate`, `setban`, `addnode` and every `z_send*` / wallet
method are unreachable **by construction** — the console cannot name a method that isn't in the
table, so there is no denylist to keep up to date. There is also a drift check asserting the
allowlist and the capability-probe table describe the same method set.

---

## Pointing it at a node

`.env.local.example` documents all 20 variables the code reads, and nothing it doesn't. You need
one: `ZCASH_RPC_URL`.

### Option A — demo mode (no endpoint)

Leave `ZCASH_RPC_URL` blank. Every page renders from a deterministic synthetic node that emulates
zebrad — and it emulates two ages of it, because that is the axis that matters:

```
ZPULSE_DEMO_PROFILE=zebra          # default: a current node, every method answers
ZPULSE_DEMO_PROFILE=zebra-legacy   # an older node: -32601s and no valueDelta
```

`zebra-legacy` is what makes the capability table, the −32601 demo and the turnstile's derived tier
explorable with no node at all. Response shapes and block cadence are real; the chain is not.

Demo mode is badged in amber on every page, and it is **never** a fallback for a failed live call. If
you point ZPulse at a broken node it shows you a broken node. An unbadged demo would be a lie about a
live-data app.

### Option B — hosted provider

Free Zcash RPC endpoints put the access token in the URL path and need no username or password:

```
ZCASH_RPC_URL=https://go.getblock.io/<your-access-token>
```

Nothing else to set. ZPulse sends no `Authorization` header when user and password are blank.

> **The token is in the URL, so the URL is a credential.** ZPulse only ever reports the _host_ to the
> browser — never the path. There is no `NEXT_PUBLIC_*` anything in this project, error messages are
> scrubbed of the URL, and there's a test asserting no route response contains a URL even when the
> node is unreachable.

### Option C — local zebrad

Enable the RPC port in `~/.config/zebrad.toml`:

```toml
[rpc]
listen_addr = "127.0.0.1:8232"
```

**Zebra 2.x sets `enable_cookie_auth = true` by default**, so that alone gets you HTTP 401 — this is
the single likeliest way pointing ZPulse at a real node fails, and the error message says so rather
than sending you looking for an `rpcuser` you never had to set. Two ways past it. Either point ZPulse
at the cookie:

```
ZCASH_RPC_URL=http://127.0.0.1:8232
ZCASH_RPC_COOKIE_FILE=$HOME/.cache/zebra/.cookie
```

The file holds one `__cookie__:<secret>` line and is sent as HTTP basic auth exactly as written.
Zebra rewrites the secret on every restart, so ZPulse re-reads the file whenever its mtime changes —
restarting your node does not mean restarting the app. Or turn cookie auth off, which is reasonable on
a port already bound to localhost:

```toml
[rpc]
listen_addr = "127.0.0.1:8232"
enable_cookie_auth = false
```

> The cookie path is verified against Zebra's config source and covered by tests that assert the exact
> `Authorization: Basic` header ZPulse sends, that credentials never appear in an error message, and
> that an unreadable cookie file fails loudly instead of silently sending nothing. What is **not**
> verified here is a live handshake — I had no zebrad to test against. If it misbehaves, that is the
> first place to look.

A syncing node is fine — the sync percentage and the "not at tip" state are part of what `/node`
shows. Pool balances need the sync to have passed the heights you're looking at.

### Option D — local zcashd (legacy)

zcashd is deprecated and ZPulse is built for zebrad, but nothing here refuses it: the dialect layer
routes by what a node answers, not by what it is called. Basic auth, from your `zcash.conf`:

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

**Against a current zebrad, expect no `unsupported` lines at all** — modern Zebra implements every
method ZPulse reads, including `getmempoolinfo` and `getnetworkinfo`. Older builds answer −32601 for
those two, and routing around that is the dialect layer's job. Either result is a pass; the script only
exits non-zero if _nothing_ answered. Which lines you get is itself the useful output: it dates the
node.

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

134 assertions over the pure analysis, the cache, the console allowlist, the store and the route
handlers. Three passes are worth naming:

- The whole data layer runs twice, once against each demo profile, so **every dialect fallback is
  exercised** rather than only the happy path — and the derived turnstile is checked against the
  reported one for agreement to under a zatoshi.
- A pass points the app at a dead host and asserts the five node-backed GET routes each return a
  `degraded` envelope, never demo data, and never a URL that could carry a token.
- Cookie auth is checked by stubbing `fetch` and inspecting the header ZPulse was about to send.

It runs the TypeScript directly via Node's native type-stripping, so it needs **Node 22.18+ or 24**.
The app itself only needs Node 18.17.

---

## Surviving a request quota

Hosted providers meter requests, so caching here isn't an optimisation — it's the reason a page anyone
can open doesn't exhaust a daily budget.

| Data                                  | Key              | Invalidated                                                         |
| ------------------------------------- | ---------------- | ------------------------------------------------------------------- |
| Chain tip (height, hash, difficulty)  | `tip`            | TTL 20s — Zcash targets ~75s blocks, so faster polling buys nothing |
| Pool balances, tree state             | `pools:<height>` | when the height changes                                             |
| A specific block and its transactions | `block:<hash>`   | never — block data is immutable                                     |
| Capability probe                      | `caps`           | process lifetime                                                    |

On top of the TTLs, identical concurrent reads are **coalesced**: ten open browser tabs and one tab
cost the node the same, because the second caller through the door awaits the first one's in-flight
promise instead of opening its own. A coalesced ride counts as a cache hit, not as its own statistic —
`/node` reports hits, misses, hit rate and live entry count, and nothing it does not actually count.
Steady-state usage lands in the low thousands of requests per day.

The hit rate is on `/node` so the claim is checkable rather than asserted. To watch it work:

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
  rpc/client.ts               transport: basic + cookie auth, timeout, retry, structured errors
  rpc/capabilities.ts         probe once, cache; method / argument / field-shape probes
  rpc/dialect.ts              data need → best method this particular node has
  rpc/console.ts              the allowlist and its param validation
  rpc/demo.ts                 the synthetic node, at two zebrad ages
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
last field is what the `ZMeta` line under each panel renders, and it's what turns the app from _trust
these figures_ into _here is how to check them_.

**Capability detection reads errors, not documentation.** JSON-RPC returns −32601 for a method that
doesn't exist, and _any other error proves the method is there_ — a parameter complaint is a
successful existence probe. So the surface report is a fact about the node in front of you, not a guess
from its version string.

**And identity is read, not deduced.** An earlier version of this code inferred "Zebra" from the
_absence_ of `getmempoolinfo`. Current Zebra implements it, so that inference labelled every modern
zebrad as zcashd — confidently, in a table whose whole job is to be trustworthy. Which software a node
is now comes from its own `subversion` string; what it implements comes from the probes. Two facts, two
sources, never one standing in for the other.

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
- **Per-pool `valueDelta` isn't universal either.** An older zebrad returns pool totals without
  per-block deltas, so the turnstile derives them by differencing consecutive `chainValue` totals and
  labels the chart `derived` instead of `reported`. It is exact rather than approximate — `chainValueZat`
  is an integer near 1e14, well inside the range a float represents exactly — and a test asserts the
  derived flows match the reported ones to under one zatoshi. A derived chart is not a fabricated one,
  but you are entitled to know which you're looking at.
- **Latency stats and the cache live in process memory**, so they reset on restart and are per-instance
  on a multi-instance deploy. The JSONL history is the part that persists.

---

## Credits

Built for the [Zcash Foundation Sprint](https://zechub.wiki/hackathon) Mini Build Challenge.
RPC surface documented at [zechub.wiki/developers](https://zechub.wiki/developers).
