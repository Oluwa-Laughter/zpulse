# ZPulse ⚡ — Zcash Network & Shielded Supply Intelligence
 
> Direct JSON-RPC integration with the official Zcash Foundation Zebra Node (`zebrad`).

ZPulse is a modern, high-performance web application and suite built to interact directly with the Zcash network over JSON-RPC. It allows you to monitor, explore, and interact with the Zcash network in real-time.

1. 📊 **Network Dashboard** (`/`): Real-time network telemetry overview, quick chain metrics, instant block/tx search, and live network ticker.
2. 🔬 **Shielded Chain Observatory** (`/observatory`): Value pool balance tracking (`Transparent`, `Sprout`, `Sapling`, `Orchard`, `Ironwood`), turnstile migration deltas, per-block privacy transaction classification, and mathematical ZIP-208 supply reconciliation.
3. 🔍 **Block Explorer Lite** (`/explorer`): Search live & milestone blocks from Genesis `#0` to modern `#3.4M+`, inspect transactions, decode transparent vs. shielded operations, and audit per-block pool value deltas.
4. 🦓 **Zebra Node Operations & Sync Monitor** (`/node`): Sync progress HUD, P2P peer mesh topology with ping times and client versions, mempool footprint, and PoW mining hashrate.
5. ⚡ **RPC Console & Playground** (`/rpc`): Interactive 1-click execution of 16 read-only Zcash JSON-RPC methods with live syntax highlighting, latency benchmarks, and chained multi-step recipes.

---

## 🌐 3 Flexible Connection Modes (Switch in 1 Click)

ZPulse allows users and judges to switch between **3 connection modes** right from the UI using the **"Switch Node"** button in the header navbar or dashboard:

| Mode | Source | Best For |
| :--- | :--- | :--- |
| 🔵 **Interactive Demo Mode** | Built-in Simulated Zebra Mainnet Dialect | Zero-setup testing & live cloud evaluations 24/7. Demonstrates full dialect handling, RPC recipes, privacy mix, and ZIP-208 supply math. |
| 🟢 **Local Zebra Node** | `http://127.0.0.1:8232` (Docker / Native) | Full node operators running `zebrad` on their local machine with live peer gossip and on-chain verification. |
| 🟣 **3rd-Party Remote RPC** | Any Remote Zcash JSON-RPC Endpoint | Connecting to an always-on remote cloud node using a private API key or custom authentication header. |

> [!TIP]
> **Switching Nodes in the App:**
> Click the **Node Status Pill** in the top navigation bar or the **"Switch Node"** button on the dashboard/node monitor to open the **Node Switcher Modal**. You can test connection latency before saving!

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

## 🔒 3rd-Party Remote RPC Node & API Key Privacy

ZPulse supports connecting to **any remote 3rd-party Zcash RPC node** while keeping your API keys completely private:

### In-App Node Switcher (Zero Setup)
1. Click **"Switch Node"** in the top navigation bar.
2. Select **"3rd-Party Remote RPC"**.
3. Enter your **RPC URL** and **API Key / Secret Token**.
4. Click **"Test Connection"** and **"Save & Switch"**.

> [!NOTE]
> **Zero-Leak Security Architecture:**
> All RPC requests are proxied server-to-server. Your API key is encrypted and stored exclusively in a secure, server-side `HttpOnly` session cookie. It is never included in client JavaScript bundles, never sent to third parties, and never logged.

### Or via Environment Variables (`.env.local` / Cloud Hosting Settings)
```env
ZCASH_RPC_URL=https://your-zcash-rpc-provider.com/rpc
ZCASH_RPC_HEADERS={"api-key":"YOUR_PRIVATE_API_KEY"}
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
