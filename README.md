# ZPulse ⚡

**A Zcash Network Observatory.** Built for the **Zcash Foundation Sprint Mini Build Challenge**.

ZPulse is a web application that interacts directly with a Zcash node via JSON-RPC to independently verify shielded pool supply integrity (`Sprout`, `Sapling`, `Orchard`, `Ironwood`), track cross-pool turnstile migration, analyze per-block privacy transaction mixes, and profile node performance.

---

## What It Does

ZPulse features four core pages:

- **`/` — Landing Page**: Overview of the observatory with a lightweight live network ticker polling block height and chain status.
- **`/observatory` — Shielded Chain & Supply**:
  - **Supply Integrity**: Displays live ZEC balances across all pools (`valuePools`) post-Ironwood.
  - **Subsidy Cross-Check**: Compares ZIP-208 halving schedule calculations against live `getblocksubsidy` node responses.
  - **Turnstile Migration**: Visualizes per-block net value flows (`valueDelta`) as funds migrate out of exit-only pools.
  - **Privacy Mix**: Classifies transactions in recent blocks (Coinbase, Transparent, Shielding, Deshielding, Mixed, Fully Shielded).
  - **Upgrade Timeline**: Tracks network upgrade states and calculates ETAs from measured average block times.
- **`/node` — Node Endpoint & Capability Monitor**: Probes node capabilities, surfaces `zcashd` vs `zebrad` dialect differences, measures per-method latency sparklines, and monitors peer connections.
- **`/rpc` — Interactive RPC Console**: Enables manual execution of read-only RPC calls and multi-step recipes with raw JSON requests, responses, and latency metrics.

---

## RPC Methods Used

ZPulse uses **16 RPC methods** with automatic fallback routing to support both `zebrad` and legacy `zcashd` nodes:

| Call | Purpose & Usage in ZPulse |
| :--- | :--- |
| `getblockchaininfo` | **Core State**: Tip height, difficulty, sync progress, upgrade activation map, and **`valuePools`** (pool balances). |
| `getblock` *(verbosity 1)* | **Turnstile**: Per-block pool `valueDelta` flows (1 cheap call per block). |
| `getblock` *(verbosity 2)* | **Privacy Mix**: Inline spend, output, and Orchard action analysis. |
| `z_gettreestate` | **State Fingerprint**: Commitment tree roots for Sapling, Orchard, and Ironwood pools. |
| `getblocksubsidy` | **Issuance Check**: Block reward allocation cross-check. |
| `getblockcount` | **Fast Ticker**: Lightweight polling for landing page tip height updates. |
| `getblockheader` | **Upgrade ETAs**: Timestamp delta scanning for measured average block time. |
| `getrawmempool` *(verbose)* | **Mempool Metrics**: Zebra-compatible mempool transaction scanning. |
| `getmempoolinfo` | **Mempool Summary**: `zcashd` path for mempool size and memory footprint. |
| `getpeerinfo` | **P2P Health**: Active peer count, inbound/outbound split, and peer sync height. |
| `getnetworkinfo` | **Node Status**: Version string and network connectivity details (`zcashd`). |
| `getnetworksolps` | **Mining**: Network hashrate in solutions per second. |
| `getmininginfo` | **Hashrate Fallback**: Backup mining metrics if `getnetworksolps` is unavailable. |
| `getinfo` | **Node Version**: Baseline node version info across all node types. |
| `getrawtransaction` | **Privacy Fallback**: Transaction decoding fallback when `getblock` v2 is unavailable. |
| `getbestblockhash` | **Tip Identity**: Backup block hash lookup. |

---

---

## How to Run It

### Option A: Local Zebra Node via Docker

1. **Start the Zebra node container**:
   ```bash
   npm run node:start
   ```
   *This starts the official `zfnd/zebra:latest` container with JSON-RPC enabled on `http://127.0.0.1:8232`.*

2. **Check Node Sync Status & Logs**:
   ```bash
   npm run node:logs
   # or check container status:
   npm run node:status
   ```

3. **Probe RPC Endpoint**:
   ```bash
   npm run probe
   ```

4. **Start Development Web Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

5. **Stop Node Container when finished**:
   ```bash
   npm run node:stop
   ```

---

### Option B: Docker Compose (Full Stack Node & Web App)
Launch both the Zebra node (`zebrad`) and the ZPulse web app in orchestrated containers:
```bash
docker compose up
# Or using podman:
# podman compose up
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

### Option C: Demo Mode (Instant Synthetic Fixture)
Leave `ZCASH_RPC_URL` empty or unset in `.env.local` to explore the full observatory, turnstiles, and RPC console with the built-in deterministic Zebra emulator fixture (zero setup required).

---

## Verification & Tests

Run the complete 152-test test suite and TypeScript typecheck:
```bash
npm run typecheck
npm run build
npm run verify
```

---

## Tech Stack & Architectural Principles

- **Framework**: Next.js 14 (App Router), React 18, TypeScript
- **Direct Node Transport**: Native JSON-RPC directly to `zebrad` without centralized third-party intermediaries
- **Styling**: High-performance dark instrument console (`globals.css`) with custom SVG charts and responsive HUDs
- **Reliability**: In-flight request coalescing, TTL caching, robust dialect fallback routing, and zero credential exposure

