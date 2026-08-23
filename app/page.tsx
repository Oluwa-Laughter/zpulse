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
} from "react-icons/hi2";
import { ZTicker } from "@/components/ZTicker";

const FEATURES = [
  {
    href: "/observatory",
    kicker: "Shielded Supply & Halvings",
    title: "Verify the supply mathematically from pool balances",
    body:
      "Independently audit every value pool reported by the node (Sprout, Sapling, Orchard, Ironwood) reconciled against modelled ZIP-208 issuance and the NU6 deferred lockbox. If the node and halving model disagree, the observatory flags it immediately.",
    methods: ["getblockchaininfo", "getblocksubsidy", "z_gettreestate"],
  },
  {
    href: "/observatory",
    kicker: "Turnstile Migration",
    title: "Track cross-pool migration out of Orchard",
    body:
      "Orchard became exit-only upon Ironwood activation. Watch funds drain out of deprecated pools into modern shielded destinations block-by-block with per-pool value deltas signed around zero.",
    methods: ["getblock (v1)", "getblockhash"],
  },
  {
    href: "/observatory",
    kicker: "Privacy Mix Analyzer",
    title: "Classify block privacy without trusting third parties",
    body:
      "Score every user transaction in recent blocks into Transparent, Shielding, Deshielding, Mixed, or Fully Shielded based on spend, output, and action counts directly from the node.",
    methods: ["getblock (v2)", "getrawtransaction"],
  },
  {
    href: "/node",
    kicker: "Zebra Node Operations & Sync",
    title: "Self-hosted Zebra health, mempool & latency telemetry",
    body:
      "Monitor your live Zebra node sync progress, block verification, inbound/outbound P2P peer mesh, mempool transaction footprint, and per-method round-trip latency sparklines.",
    methods: ["getpeerinfo", "getrawmempool", "getnetworksolps", "getinfo"],
  },
  {
    href: "/rpc",
    kicker: "Interactive RPC Console",
    title: "Execute allowlisted JSON-RPC queries with raw envelopes",
    body:
      "Run 16 read-only Zcash JSON-RPC methods with live parameter validation, latency metrics, syntax-highlighted responses, and multi-step chained recipes.",
    methods: ["allowlisted", "read-only", "live envelopes"],
  },
  {
    href: "/node",
    kicker: "Dialect & Capability Matrix",
    title: "Adaptive routing across Zebra releases and node versions",
    body:
      "ZPulse actively probes node capabilities, handles method-not-found (-32601) differences gracefully, and routes queries through the most optimal path supported by your node.",
    methods: ["capability probe", "-32601 detection", "field probe"],
  },
];

export default function HomePage() {
  return (
    <>
      <section className="z-hero">
        <span className="z-label">Zcash Foundation Sprint · Mini Build Challenge</span>
        <h1>
          Shielded Zcash, <em>verified live</em> from your Zebra node.
        </h1>
        <p>
          Independent cryptographic verification of Zcash circulating supply, cross-pool
          turnstile flows, and block-by-block privacy composition. Powered by direct JSON-RPC
          connection to the official Zcash Foundation Zebra node.
        </p>
        <div className="z-hero-actions">
          <Link href="/observatory" className="z-btn z-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span>Launch Observatory</span>
            <HiOutlineArrowRight style={{ fontSize: 15 }} />
          </Link>
          <Link href="/node" className="z-btn">
            Zebra Node & Sync
          </Link>
          <Link href="/rpc" className="z-btn">
            Interactive RPC Console
          </Link>
        </div>
      </section>

      <ZTicker />

      <h2 className="z-label" style={{ margin: "36px 0 14px" }}>
        Observatory Modules & Analytics
      </h2>
      <div className="z-grid-2">
        {FEATURES.map((feature) => (
          <Link href={feature.href} className="z-feature" key={feature.title}>
            <span className="z-label">{feature.kicker}</span>
            <h3>{feature.title}</h3>
            <p>{feature.body}</p>
            <div className="z-feature-methods">
              {feature.methods.map((method) => (
                <code key={method}>{method}</code>
              ))}
            </div>
          </Link>
        ))}
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

