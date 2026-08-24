# ZPulse ⚡ — Zcash Network & Shielded Supply Intelligence

> **Submission for the Zcash Foundation Sprint · Mini Build Challenge**  
> Direct JSON-RPC integration with the official Zcash Foundation Zebra Node (`zebrad`).

ZPulse is a modern, high-performance web application and telemetry suite built to interact directly with the Zcash network over JSON-RPC. It addresses all four challenge tracks proposed in the Mini Build Challenge:

1. 📊 **Zcash Dashboard & Observatory** (`/` & `/observatory`): Real-time network telemetry, value pool tracking (`Transparent`, `Sprout`, `Sapling`, `Orchard`, `Ironwood`), and mathematical ZIP-208 supply reconciliation.
2. 🔍 **Block Explorer Lite** (`/explorer`): Search live & milestone blocks from Genesis `#0` to modern `#3.4M+`, inspect transactions, decode transparent vs. shielded operations, and audit per-block pool value deltas.
3. 🦓 **Zebra Node Operations & Sync Monitor** (`/node`): Sync progress HUD, P2P peer mesh topology with ping times and client versions, mempool footprint, and PoW mining hashrate.
4. ⚡ **RPC Console & Playground** (`/rpc`): Interactive 1-click execution of 16 read-only Zcash JSON-RPC methods with live syntax highlighting, latency benchmarks, and chained multi-step recipes.

---

## 🚀 Live Demo vs. Local Live Node

| Environment | Mode | Description |
| :--- | :--- | :--- |
| **Deployed Web App** | `Demo Mode` | Runs ZPulse's built-in, fully interactive realistic Zebra mainnet dialect. Evaluators and judges can explore all 4 modules, run RPC recipes, and inspect privacy metrics 24/7 without needing a dedicated remote server running. |
| **Local Machine** | `Live Node Mode` | Connects directly over JSON-RPC to a real running Zebra node (`zebrad`) at `http://127.0.0.1:8232` (or a remote node like NOWNodes / QuickNode). |

> [!IMPORTANT]
> **To evaluate Live Data from a Real Node:**
> 1. Run Zebra locally via Docker: `npm run node:start`
> 2. Set `ZCASH_RPC_URL=http://127.0.0.1:8232` in `.env.local`
> 3. Launch the app: `npm run dev`

---

## 🛠️ Quick Start (Running Locally with Live Zebra Node)

### 1. Clone & Install
```bash
git clone https://github.com/Oluwa-Laughter/zpulse.git
cd zpulse
npm install
```

### 2. Start the Official Zebra Node (Docker / Podman)
```bash
npm run node:start
```
*Launches the official `docker.io/zfnd/zebra:latest` container with RPC enabled on `http://127.0.0.1:8232`.*

- Check sync progress & peer logs:
  ```bash
  npm run node:logs
  ```
- Check container status:
  ```bash
  npm run node:status
  ```
- Probe RPC capabilities:
  ```bash
  npm run probe
  ```

### 3. Configure Environment
Copy `.env.local.example` to `.env.local`:
```bash
cp .env.local.example .env.local
```
Ensure your `.env.local` contains:
```env
ZCASH_RPC_URL=http://127.0.0.1:8232
```

### 4. Run Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ☁️ Connecting Cloud Deployments to a Live Node

If you want your cloud-deployed app (on Vercel, Netlify, Render, etc.) to talk to a 24/7 live Zcash node, you can configure:

### Option A: Cloud RPC Provider (e.g. NOWNodes / QuickNode)
In your deployment dashboard (e.g. Vercel Project Settings ➔ Environment Variables):
```env
ZCASH_RPC_URL=https://zcash.nownodes.io
ZCASH_RPC_HEADERS={"api-key":"YOUR_NOWNODES_API_KEY"}
```
*(or QuickNode: `ZCASH_RPC_URL=https://your-subdomain.zcash-mainnet.quiknode.pro/your-token/`)*

### Option B: Tunnel Your Local Zebra Node (via ngrok)
1. On your machine:
   ```bash
   ngrok http 8232
   ```
2. In your cloud deployment Environment Variables:
   ```env
   ZCASH_RPC_URL=https://your-tunnel-url.ngrok-free.app
   ```

---

## 📡 16 JSON-RPC Methods Implemented

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

## 🧪 Automated Verification & Testing

ZPulse includes an automated test suite verifying RPC dialect routing, capability probing, ZIP-208 supply math, turnstile derivation, and security allowlists:

```bash
npm run verify
npm run typecheck
```
*All 152 unit and integration tests pass with 0 errors.*

---

## 🏆 Mini Build Challenge Checklist
- [x] **Landing page**: Modern responsive dashboard with live network ticker and search (`/`).
- [x] **Connected to Zcash node**: Live integration with official Zebra (`zebrad`) on `127.0.0.1:8232`.
- [x] **Used at least 3 RPC methods**: Uses 16 JSON-RPC methods with automatic fallback dialect routing.
- [x] **Displayed live blockchain data**: Latest height, hash, difficulty, mempool, node version, blockchain info, peer mesh, network hashrate, and sync progress.
