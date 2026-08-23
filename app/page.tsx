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
import { ZTicker } from "@/components/ZTicker";

const FEATURES = [
  {
    href: "/observatory",
    kicker: "Shielded supply",
    title: "Verify the supply, do not take it on faith",
    body:
      "Every value pool the node reports, summed and reconciled against modelled ZIP-208 issuance — including the NU6 deferred lockbox. Pools are drawn from whatever the node returns, so Ironwood and anything after it appear without a code change.",
    methods: ["getblockchaininfo", "getblocksubsidy", "z_gettreestate"],
  },
  {
    href: "/observatory",
    kicker: "Turnstile",
    title: "Watch value drain out of Orchard",
    body:
      "Orchard became exit-only at Ironwood activation, so its balance can only fall. Each block carries per-pool value deltas, charted signed around zero — one RPC call per block, not one per transaction.",
    methods: ["getblock", "getblockhash"],
  },
  {
    href: "/observatory",
    kicker: "Privacy mix",
    title: "Score every block by how private it was",
    body:
      "Each transaction in the recent window classified transparent, shielding, deshielding, fully shielded or mixed, from its spend, output and action counts. Coinbase excluded from the denominator, because an empty block is not a transparent one.",
    methods: ["getblock", "getrawtransaction"],
  },
  {
    href: "/node",
    kicker: "Node health",
    title: "Sync, peers, mempool, latency, alerts",
    body:
      "Per-method RPC latency measured on the way through, poller history, and alert rules for an unreachable node, a stalled tip, too few peers or a height that went backwards.",
    methods: ["getpeerinfo", "getrawmempool", "getnetworksolps", "getinfo"],
  },
  {
    href: "/rpc",
    kicker: "RPC console",
    title: "Run the calls yourself",
    body:
      "Pick any of the 16 read-only methods, see the exact JSON-RPC envelope sent and the response returned, with latency. Chained recipes walk tip → hash → block in one click.",
    methods: ["allowlisted", "read-only", "rate-limited"],
  },
  {
    href: "/node",
    kicker: "Dialect layer",
    title: "Speaks zcashd and Zebra, not just one",
    body:
      "zcashd is deprecated and Zebra implements neither getnetworkinfo nor getmempoolinfo. ZPulse probes the node once, caches what it answers, and satisfies each panel through whichever method that node actually has.",
    methods: ["capability probe", "-32601 detection"],
  },
];

export default function HomePage() {
  return (
    <>
      <section className="z-hero">
        <span className="z-label">Zcash Foundation Sprint · Mini Build Challenge</span>
        <h1>
          Shielded Zcash, <em>verified live</em> from a node you choose.
        </h1>
        <p>
          The Ironwood design says users should be able to independently verify the circulating
          supply by checking active pool balances. ZPulse is that check, running continuously: pool
          balances reconciled against modelled issuance, value migrating out of the exit-only Orchard
          pool block by block, and every recent transaction scored for how much of it was shielded.
        </p>
        <div className="z-hero-actions">
          <Link href="/observatory" className="z-btn z-primary">
            Open the observatory →
          </Link>
          <Link href="/rpc" className="z-btn">
            Run the RPC calls yourself
          </Link>
        </div>
      </section>

      <ZTicker />

      <h2 className="z-label" style={{ margin: "36px 0 14px" }}>
        What it reads, and which methods it reads it with
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
    </>
  );
}
