/**
 * Landing page.
 *
 * A server component with one client island — the ticker. The copy is static so
 * the page paints instantly and says what the app is even while the node is being
 * contacted; nothing here depends on an RPC call succeeding.
 *
 * The feature cards name the RPC methods each page uses. That is not decoration:
 * the point of the whole submission is that the numbers on screen are traceable
 * to specific JSON-RPC calls, and the console at /rpc lets you run them yourself.
 */

import Link from "next/link";
import {
  HiOutlineBookOpen,
  HiOutlineShieldCheck,
  HiOutlineCube,
  HiOutlineArrowsRightLeft,
  HiOutlineScale,
  HiOutlineServer,
  HiOutlineCommandLine,
  HiOutlineArrowRight,
  HiOutlineMagnifyingGlass,
  HiOutlineChartBarSquare,
} from "react-icons/hi2";
import { ZTicker } from "@/components/ZTicker";

const CHALLENGE_MODULES = [
  {
    href: "/observatory",
    icon: HiOutlineShieldCheck,
    badge: "Supply & Halving Audit",
    title: "Shielded Supply Integrity & Halvings",
    body: "Mathematically audit all Value Pools (Sprout, Sapling, Orchard, Ironwood) reconciled against modelled ZIP-208 issuance and the NU6 lockbox.",
    methods: ["getblockchaininfo", "getblocksubsidy", "z_gettreestate"],
  },
  {
    href: "/explorer",
    icon: HiOutlineMagnifyingGlass,
    badge: "Block Explorer Lite",
    title: "Block & Transaction Deep Inspector",
    body: "Search and inspect live Zcash blocks, decode raw transaction anatomy, classify privacy types (Coinbase, Shielding, Deshielding, Fully Shielded), and view pool value deltas.",
    methods: ["getblock (verbosity 2)", "getrawtransaction", "getblockhash"],
  },
  {
    href: "/node",
    icon: HiOutlineServer,
    badge: "Node Operations",
    title: "Zebra Node Operations & Sync HUD",
    body: "Real-time sync progress tracking, peer mesh topology with round-trip pings, mempool footprint, and mining PoW Sol/s hashrate.",
    methods: ["getpeerinfo", "getrawmempool", "getnetworksolps", "getinfo"],
  },
  {
    href: "/rpc",
    icon: HiOutlineCommandLine,
    badge: "Interactive Console",
    title: "Interactive JSON-RPC Console",
    body: "Execute 16 read-only Zcash JSON-RPC methods directly against your Zebra node with live syntax highlighting, millisecond latency timers, and multi-step recipe workflows.",
    methods: ["allowlist validation", "recipe runner", "raw wire JSON"],
  },
];

export default function HomePage() {
  return (
    <>
      <section className="z-hero">
        <span className="z-label">Live Zebra Full Node Telemetry</span>
        <h1>
          Zcash Network & Shielded Supply Intelligence
        </h1>
        <p>
          Live JSON-RPC integration with the official Zcash Foundation Zebra node. Independently verify
          circulating supply, inspect block transactions, monitor node sync telemetry, and run live RPC queries.
        </p>

        <div className="z-hero-actions" style={{ marginBottom: 20 }}>
          <Link href="/observatory" className="z-btn z-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <HiOutlineShieldCheck style={{ fontSize: 16 }} />
            <span>Observatory</span>
            <HiOutlineArrowRight style={{ fontSize: 14 }} />
          </Link>
          <Link href="/explorer" className="z-btn" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <HiOutlineMagnifyingGlass style={{ fontSize: 16 }} />
            <span>Block Explorer</span>
          </Link>
          <Link href="/node" className="z-btn" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <HiOutlineServer style={{ fontSize: 16 }} />
            <span>Node Monitor</span>
          </Link>
          <Link href="/rpc" className="z-btn" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <HiOutlineCommandLine style={{ fontSize: 16 }} />
            <span>RPC Playground</span>
          </Link>
        </div>

        {/* Quick Search Bar */}
        <form action="/explorer" method="GET" style={{ display: "flex", gap: 8, maxWidth: 580, marginTop: 16 }}>
          <div style={{ position: "relative", flex: 1 }}>
            <HiOutlineMagnifyingGlass
              style={{
                position: "absolute",
                left: 12,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 16,
                color: "var(--z-text-faint)",
              }}
            />
            <input
              type="text"
              name="q"
              className="z-input"
              placeholder="Search by Block Height (#20491), Hash, or TxID..."
              style={{ paddingLeft: 36 }}
            />
          </div>
          <button type="submit" className="z-btn z-primary">
            Explore
          </button>
        </form>
      </section>

      <ZTicker />

      <h2 className="z-label" style={{ margin: "36px 0 14px", fontSize: 12, letterSpacing: "0.06em" }}>
        Observatory Modules & Capabilities
      </h2>
      <div className="z-grid-2">
        {CHALLENGE_MODULES.map((feature) => {
          const Icon = feature.icon;
          return (
            <Link href={feature.href} className="z-feature" key={feature.title}>
              <div className="z-row" style={{ alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Icon style={{ fontSize: 18, color: "var(--z-amber)", flexShrink: 0 }} />
                <span className="z-label" style={{ color: "var(--z-amber)" }}>{feature.badge}</span>
              </div>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
              <div className="z-feature-methods">
                {feature.methods.map((method) => (
                  <code key={method}>{method}</code>
                ))}
              </div>
            </Link>
          );
        })}
      </div>

      {/* Straight-to-the-point Glossary */}
      <section style={{ marginTop: 40 }}>
        <div className="z-explainer-card">
          <div className="z-explainer-head">
            <HiOutlineBookOpen style={{ fontSize: 18, color: "var(--z-amber)" }} />
            <h3 className="z-explainer-title">Core Concepts Glossary</h3>
          </div>
          <p className="z-explainer-desc">
            Quick reference guide for key privacy, supply verification, and consensus terms:
          </p>
          <div className="z-explainer-terms">
            <div className="z-term-item">
              <div className="z-term-title">
                <HiOutlineShieldCheck style={{ fontSize: 13, color: "var(--z-amber)" }} />
                <span>Shielded Pools</span>
              </div>
              <p className="z-term-desc">Zero-knowledge encrypted pools (Sapling, Orchard, Ironwood) where balances and transfers are private.</p>
            </div>
            <div className="z-term-item">
              <div className="z-term-title">
                <HiOutlineCube style={{ fontSize: 13, color: "var(--z-amber)" }} />
                <span>Transparent Pool</span>
              </div>
              <p className="z-term-desc">Public ledger balances (t-addresses) visible on-chain.</p>
            </div>
            <div className="z-term-item">
              <div className="z-term-title">
                <HiOutlineArrowsRightLeft style={{ fontSize: 13, color: "var(--z-amber)" }} />
                <span>Turnstile Migration</span>
              </div>
              <p className="z-term-desc">Cryptographic checkpoint verifying value moving out of older pools with zero inflation.</p>
            </div>
            <div className="z-term-item">
              <div className="z-term-title">
                <HiOutlineScale style={{ fontSize: 13, color: "var(--z-amber)" }} />
                <span>ZIP-208 Issuance</span>
              </div>
              <p className="z-term-desc">Mathematical block reward halving schedule (every 840,000 blocks).</p>
            </div>
            <div className="z-term-item">
              <div className="z-term-title">
                <HiOutlineServer style={{ fontSize: 13, color: "var(--z-amber)" }} />
                <span>Zebra (zebrad)</span>
              </div>
              <p className="z-term-desc">The official independent Rust node client developed by the Zcash Foundation.</p>
            </div>
            <div className="z-term-item">
              <div className="z-term-title">
                <HiOutlineCommandLine style={{ fontSize: 13, color: "var(--z-amber)" }} />
                <span>JSON-RPC</span>
              </div>
              <p className="z-term-desc">Standard communication protocol used by apps to query node state directly.</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

