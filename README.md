# ZPulse ⚡ — Zcash Network & Shielded Supply Intelligence

> **Submission for the Zcash Foundation Sprint · Mini Build Challenge**  
> Direct JSON-RPC integration with the official Zcash Foundation Zebra Node (`zebrad`).

ZPulse is a modern, high-performance web application and telemetry suite built to interact directly with the Zcash network over JSON-RPC. It addresses all four challenge tracks proposed in the Mini Build Challenge:

1. 📊 **Zcash Dashboard** (`/` & `/observatory`): Real-time network telemetry, value pool tracking (`Transparent`, `Sprout`, `Sapling`, `Orchard`, `Ironwood`), and mathematical ZIP-208 supply reconciliation.
2. 🔍 **Block Explorer Lite** (`/explorer`): Search live blocks by height/hash, inspect transactions, decode transparent vs. shielded operations, and audit per-block pool value deltas.
3. 🦓 **Zcash Node Monitor** (`/node`): Sync progress HUD, P2P peer mesh topology with ping times and client versions, mempool footprint, and PoW mining hashrate.
4. ⚡ **RPC Playground** (`/rpc`): Interactive 1-click execution of 16 read-only Zcash JSON-RPC methods with live syntax highlighting, latency benchmarks, and chained multi-step recipes.

---

## 🚀 What It Does

### 1. Mathematical Supply Integrity & Halving Verification (`/observatory`)
- **Reported Value Pools**: Reads live balances across all pools (`valuePools`) directly from `getblockchaininfo`.
- **ZIP-208 Halving Issuance**: Modelled consensus schedule checked against `getblocksubsidy` at the exact same height.
- **Turnstile Migration**: Visualizes cross-pool funds flow (`valueDelta` per block) as funds migrate out of exit-only pools into modern shielded pools.
- **Privacy Mix Classifier**: Classifies block transactions into *Coinbase*, *Transparent*, *Shielding*, *Deshielding*, *Mixed*, or *Fully Shielded*.
- **Upgrade Timeline**: Tracks activation states and calculates time-to-upgrade based on measured block timestamps (`getblockheader`).

### 2. Block & Transaction Explorer Lite (`/explorer`)
- **Instant Search**: Search by block height (`#20491`), block hash (`00000000...`), or transaction ID (`txid`).
- **Quick Jumps**: 1-click access to Genesis block `#0`, Sprout `#1`, Sapling `#419,200`, Blossom `#653,600`, Canopy `#1,046,400`, NU5 / Orchard `#1,687,104`, NU6 `#2,726,400`, and the live Chain Tip.
- **Deep Block Metrics**: Confirmations, difficulty, block size in bytes, timestamps, and per-pool value deltas (`valueDelta`).
- **Transaction Inspector**: Transparent input/output counts, JoinSplit descriptions (Sprout), Shielded Spends/Outputs (Sapling), Actions (Orchard/Ironwood), and full raw JSON view.

### 3. Zebra Node Operations & Sync Monitor (`/node`)
- **Sync Progress HUD**: Real-time progress bar tracking validated blocks vs estimated network tip.
- **P2P Mesh Topology**: List of connected peers with client version badges (`/Zebra:6.3.0/`, `/Zebra:5.1.0/`, `/Zakura:1.1.1/`) and round-trip ping times.
- **PoW Mining Metrics**: Real-time Equihash mining hashrate in Solutions/sec (`getnetworksolps`).
- **Telemetry & Latency**: Per-method response times (min, avg, max) with live sparklines.

### 4. Interactive RPC Console (`/rpc`)
- Execute allowlisted read-only RPC calls with live parameter validation.
- Preset multi-step recipes (e.g. *Inspect Tip Privacy*, *Audit Supply*, *Check Peer Health*).
- Formatted JSON response viewer with 1-click clipboard copy.

---

## 📡 RPC Methods Used (16 Methods)

| Method | Purpose & Usage in ZPulse |
| :--- | :--- |
| `getblockchaininfo` | **Core State**: Tip height, difficulty, sync progress, upgrade activation map, and **`valuePools`** (pool balances). |
| `getblock` *(verbosity 1)* | **Turnstile**: Per-block pool `valueDelta` flows. |
| `getblock` *(verbosity 2)* | **Privacy Mix & Explorer**: Inline transaction spend, output, and Orchard action analysis. |
| `z_gettreestate` | **State Fingerprint**: Commitment tree roots for Sapling, Orchard, and Ironwood pools. |
| `getblocksubsidy` | **Issuance Check**: Block reward allocation and lockbox validation. |
| `getblockcount` | **Fast Ticker**: Lightweight polling for landing page tip height updates. |
| `getblockheader` | **Upgrade ETAs**: Timestamp delta scanning for measured average block time. |
| `getrawmempool` *(verbose)* | **Mempool Metrics**: Zebra-compatible mempool transaction scanning. |
| `getmempoolinfo` | **Mempool Summary**: Mempool size and memory footprint. |
| `getpeerinfo` | **P2P Health**: Active peer count, inbound/outbound split, ping latency, and client versions. |
| `getnetworkinfo` | **Node Status**: Version string and network connectivity details. |
| `getnetworksolps` | **Mining**: Network hashrate in solutions per second (PoW). |
| `getmininginfo` | **Hashrate Fallback**: Backup mining metrics if `getnetworksolps` is unavailable. |
| `getinfo` | **Node Version**: Baseline node version info across all node types. |
| `getrawtransaction` | **Explorer & Privacy Fallback**: Transaction decoding fallback. |
| `getbestblockhash` | **Tip Identity**: Best block hash lookup. |

---

## 🛠️ How to Run

### Option 1: Live Zebra Node (Docker / Podman)

1. **Start the Zebra node container**:
   ```bash
   npm run node:start
   ```
   *Runs the official `docker.io/zfnd/zebra:latest` image with RPC enabled on `http://127.0.0.1:8232`.*

2. **Check Node Sync Status & Logs**:
   ```bash
   npm run node:logs
   # Check container status:
   npm run node:status
   ```

3. **Probe RPC Endpoint**:
   ```bash
   npm run probe
   ```

4. **Start Web Application**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

---

### Option 2: Docker Compose (Full Stack)

Launch both the Zebra node and the ZPulse web app in orchestrated containers:
```bash
docker compose up
```
Open [http://localhost:3000](http://localhost:3000).

---

### Option 3: Verification & Test Suite

Run the comprehensive test suite verifying the RPC dialect layer, capability probing, supply mathematics, turnstile derivation, and security allowlist:
```bash
npm run verify
```

---

## 🏆 Mini Build Challenge Checklist
- [x] **Landing page**: Frontend dashboard with live network ticker and search (`/`).
- [x] **Connected to Zcash node**: Live integration with official Zebra (`zebrad 6.3.0`) on `127.0.0.1:8232`.
- [x] **Used at least 3 RPC methods**: Uses 16 JSON-RPC methods with automatic fallbacks.
- [x] **Displayed live blockchain data**: Latest height, hash, difficulty, mempool, node version, blockchain info, peer mesh, network hashrate, and sync progress.
