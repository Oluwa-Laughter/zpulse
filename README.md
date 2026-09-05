<h1 align='center'>⚡ ZPulse </h1>  

## A Zcash Network and Shielded Supply Intelligence

> Real-time network observatory, turnstile migration tracker, and JSON-RPC developer toolkit built on the official Zcash Foundation Zebra node (`zebrad`).

**Live Deployment**: [https://zpulse-v1.vercel.app/](https://zpulse-v1.vercel.app/)

---

## 🌟 Key Features

1. 📊 **Network Dashboard** (`/`): Real-time network telemetry, live block ticker, search lookup, and circulating supply.
2. 🔬 **Shielded Observatory** (`/observatory`): Live balance tracking across all 5 pools (`Transparent`, `Sprout`, `Sapling`, `Orchard`, `Ironwood`), turnstile migration flows, ZIP-208 supply math reconciliation, and per-block zero-knowledge transaction classification.
3. 🔍 **Block Explorer** (`/explorer`): Inspect on-chain blocks and milestones from Genesis `#0` to modern `#3.4M+` with raw transaction decoding and commitment tree states.
4. 🦓 **Zebra Node Monitor** (`/node`): Sync status HUD, P2P peer mesh topology, ping latencies, mempool size, and mining hashrate.
5. ⚡ **RPC Playground** (`/rpc`): Interactive 1-click execution of 16 read-only JSON-RPC methods, recipe workflows, and copyable `curl` exports.
6. 📱 **Responsive Mobile UX**: Full mobile navigation drawer, touch-friendly controls, and adaptive data grids across phones, tablets, and desktops.

---

## 🌐 3 Connection Modes (Switch in 1 Click)

Switch between modes anytime using the **"Switch Node"** button in the header navbar:

| Mode | Target | Description |
| :--- | :--- | :--- |
| 🔵 **Interactive Demo** | Synthetic Zebra Mainnet | **Zero-setup evaluation**|
| 🟢 **Local Zebra Node** | `127.0.0.1:8232` (Mainnet)<br>`127.0.0.1:18232` (Testnet) | Direct connection to native `zebrad` with auto-detected session cookie auth (`~/.cache/zebra/.cookie`). |
| 🟣 **3rd-Party Remote RPC** | Any Remote Endpoint | Connect via API key/token, secured in server-side `HttpOnly` session cookies. |

---

## 🛠️ Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/Oluwa-Laughter/zpulse.git
cd zpulse
npm install
```

### 2. Install & Start Native Zebra Node (Optional for Local Mode)
```bash
# Install prebuilt zebrad binary (~/.cargo/bin/zebrad)
npm run node:install

# Start on Mainnet (Port 8232)
npm run node:mainnet

# Or start on Testnet (Port 18232)
npm run node:testnet
```

### 3. Run the Web Dashboard
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 💻 CLI Toolkit (`toCurl`)

Query your running Zebra node directly from the terminal (matching the workshop `toCurl.sh` foundation):

```bash
# Check chain & sync state
npm run tocurl getblockchaininfo

# Inspect block #1
npm run tocurl getblock 1 1

# Inspect Sapling & Orchard commitment tree roots
npm run tocurl z_gettreestate 1

# View connected P2P peers
npm run tocurl getpeerinfo
```

---

## 🧪 Testing & Verification

```bash
npm run verify      # Run 152 automated tests (supply math, turnstile, RPC dialect)
npm run typecheck   # Validate TypeScript types
npm run build       # Build production application
```
