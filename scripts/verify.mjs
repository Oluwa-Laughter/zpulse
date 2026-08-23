/**
 * Verification for the analysis layer — the pure functions that turn RPC
 * responses into the numbers on screen.
 *
 * Run it:   npm run verify
 *
 * Zero dependencies. It uses Node's built-in TypeScript type-stripping (Node
 * 22.18+ / 24+) and node:assert, so it works before `npm install` has fetched
 * anything and without Next running.
 *
 * Why this exists rather than a test framework: the supply model computes Zcash's
 * issuance schedule, and a wrong constant there produces a confident, plausible,
 * completely wrong "circulating supply" figure. That deserves a check that runs
 * on demand, not a comment claiming the constants are right. Every assertion
 * below compares against a figure from the public record or against an
 * independent brute-force computation.
 */

import assert from "node:assert/strict";

import {
  formatDuration,
  formatHash,
  formatSolps,
  formatZec,
  formatZecCompact,
  ZATOSHI_PER_ZEC,
} from "../lib/analysis/format.ts";
import {
  blockSubsidyZat,
  checkSubsidy,
  classifyPool,
  cumulativeIssuanceZat,
  halvingHeight,
  halvingIndex,
  issuanceModelSelfCheck,
  KNOWN_HALVING_HEIGHTS,
  summarizeSupply,
} from "../lib/analysis/supply.ts";
import { summarizeTurnstile } from "../lib/analysis/turnstile.ts";
import { classifyTx, detectShieldedComponents, summarizePrivacy } from "../lib/analysis/privacy.ts";
import { buildUpgradeTimeline } from "../lib/analysis/upgrades.ts";

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write(`  ok   ${name}\n`);
  } catch (err) {
    failed += 1;
    failures.push({ name, message: err?.message ?? String(err) });
    process.stdout.write(`  FAIL ${name}\n`);
  }
}

function section(title) {
  process.stdout.write(`\n${title}\n`);
}

/* ── format ──────────────────────────────────────────────────────────────── */

section("format");

test("formatZec adds separators and fixes decimals", () => {
  assert.equal(formatZec(1902774.5), "1,902,774.50");
  assert.equal(formatZec(1.5625, 4), "1.5625");
});

test("formatZec renders absent values as an em dash, not NaN or 0", () => {
  assert.equal(formatZec(null), "—");
  assert.equal(formatZec(undefined), "—");
  assert.equal(formatZec(Number.NaN), "—");
});

test("formatZecCompact abbreviates by magnitude", () => {
  assert.equal(formatZecCompact(1_902_774), "1.90M");
  assert.equal(formatZecCompact(548_930), "548.9K");
  assert.equal(formatZecCompact(12.5), "12.50");
});

test("formatSolps uses solutions per second, not hashes", () => {
  assert.match(formatSolps(6_500_000_000), /GSol\/s$/);
  assert.equal(formatSolps(null), "—");
});

test("formatHash truncates in the middle and leaves short strings alone", () => {
  const hash = "0".repeat(56) + "abcdef12";
  assert.ok(formatHash(hash).includes("…"));
  assert.equal(formatHash("abc"), "abc");
  assert.equal(formatHash(null), "—");
});

test("formatDuration steps through units", () => {
  assert.equal(formatDuration(45), "45s");
  assert.equal(formatDuration(75), "1m 15s");
  assert.equal(formatDuration(3700), "1h 1m");
  assert.equal(formatDuration(90_000), "1d 1h");
});

/* ── supply: the issuance model vs the public record ─────────────────────── */

section("supply — issuance model");

test("halving heights match the two halvings that actually happened", () => {
  assert.equal(halvingHeight(1), 1_046_400);
  assert.equal(halvingHeight(2), 2_726_400);
});

test("halvingIndex flips exactly at the boundary, not one block off", () => {
  assert.equal(halvingIndex(1_046_399), 0);
  assert.equal(halvingIndex(1_046_400), 1);
  assert.equal(halvingIndex(2_726_399), 1);
  assert.equal(halvingIndex(2_726_400), 2);
});

test("block subsidy matches published values at each era", () => {
  assert.equal(blockSubsidyZat(600_000) / ZATOSHI_PER_ZEC, 12.5); // pre-Blossom
  assert.equal(blockSubsidyZat(700_000) / ZATOSHI_PER_ZEC, 6.25); // post-Blossom
  assert.equal(blockSubsidyZat(1_100_000) / ZATOSHI_PER_ZEC, 3.125); // after halving 1
  assert.equal(blockSubsidyZat(3_470_000) / ZATOSHI_PER_ZEC, 1.5625); // today
});

test("slow start issues exactly 125,000 ZEC", () => {
  assert.equal(cumulativeIssuanceZat(19_999) / ZATOSHI_PER_ZEC, 125_000);
});

test("issuance through the block before halving 2 is exactly 15,750,000 ZEC", () => {
  assert.equal(cumulativeIssuanceZat(2_726_399) / ZATOSHI_PER_ZEC, 15_750_000);
});

test("closed-form issuance equals a brute-force sum at every epoch boundary", () => {
  const bruteForce = (height) => {
    let total = 0;
    for (let h = 1; h <= height; h += 1) total += blockSubsidyZat(h);
    return total;
  };
  for (const height of [1, 9_999, 10_000, 19_999, 20_000, 20_001, 653_599, 653_600, 1_046_400]) {
    assert.equal(cumulativeIssuanceZat(height), bruteForce(height), `mismatch at height ${height}`);
  }
});

test("issuance stays under the 21M cap", () => {
  const issued = cumulativeIssuanceZat(3_470_000) / ZATOSHI_PER_ZEC;
  assert.ok(issued > 16_000_000 && issued < 21_000_000, `implausible issuance: ${issued}`);
});

test("the model's own self-check passes, so the UI footnote will not cry wolf", () => {
  const check = issuanceModelSelfCheck();
  assert.equal(check.ok, true, check.detail);
});

test("KNOWN_HALVING_HEIGHTS is what the self-check thinks it is", () => {
  assert.deepEqual([...KNOWN_HALVING_HEIGHTS], [1_046_400, 2_726_400]);
});

/* ── supply: pool classification ─────────────────────────────────────────── */

section("supply — pool classification");

test("known shielded pools are classified as shielded", () => {
  for (const id of ["sprout", "sapling", "orchard", "ironwood"]) {
    const pool = classifyPool({ id, chainValueZat: 100 * ZATOSHI_PER_ZEC });
    assert.equal(pool.shielded, true, `${id} should be shielded`);
    assert.equal(pool.unrecognised, false, `${id} should be recognised`);
  }
});

test("lockbox and transparent are not counted as shielded", () => {
  assert.equal(classifyPool({ id: "lockbox", chainValue: 1 }).shielded, false);
  assert.equal(classifyPool({ id: "transparent", chainValue: 1 }).shielded, false);
});

test("a pool name from the future is assumed shielded AND flagged as an assumption", () => {
  const pool = classifyPool({ id: "someFuturePool", chainValueZat: 5 * ZATOSHI_PER_ZEC });
  assert.equal(pool.shielded, true);
  assert.equal(pool.unrecognised, true);
  assert.equal(pool.classification, "assumed-shielded");
});

test("zatoshi is preferred over the float field when both are present", () => {
  // A node giving both should be read from the integer, which cannot lose precision.
  const pool = classifyPool({ id: "sapling", chainValue: 1, chainValueZat: 2 * ZATOSHI_PER_ZEC });
  assert.equal(pool.balanceZec, 2);
});

test("a pool with no balance at all yields null, not zero", () => {
  const pool = classifyPool({ id: "sapling" });
  assert.equal(pool.balanceZec, null);
});

/* ── supply: the independent check ───────────────────────────────────────── */

section("supply — subsidy cross-check against the node");

test("agrees when the node's split sums to the modelled subsidy", () => {
  const height = 3_470_000; // 1.5625 ZEC era
  const check = checkSubsidy(height, {
    miner: 1.25,
    fundingstreams: [{ recipient: "Zcash Community Grants", value: 0.15625 }],
    lockboxstreams: [{ recipient: "Deferred", value: 0.15625 }],
  });
  assert.equal(check.modelledZec, 1.5625);
  assert.equal(check.nodeZec, 1.5625);
  assert.equal(check.agrees, true);
});

test("disagrees loudly when the node reports something else", () => {
  const check = checkSubsidy(3_470_000, { miner: 3.125 });
  assert.equal(check.agrees, false);
  assert.match(check.detail, /Trust the node/);
});

test("reports 'unverified' rather than 'agrees' when the node has no getblocksubsidy", () => {
  const check = checkSubsidy(3_470_000, null);
  assert.equal(check.agrees, null);
  assert.equal(check.nodeZec, null);
  assert.match(check.detail, /unverified/);
});

section("supply — summary");

const shieldedOnlyPools = [
  { id: "sprout", chainValueZat: 4_812 * ZATOSHI_PER_ZEC },
  { id: "sapling", chainValueZat: 548_930 * ZATOSHI_PER_ZEC },
  { id: "orchard", chainValueZat: 1_902_774 * ZATOSHI_PER_ZEC },
  { id: "ironwood", chainValueZat: 913_409 * ZATOSHI_PER_ZEC },
];

test("shielded total is the sum of shielded pools only", () => {
  const summary = summarizeSupply({
    height: 3_470_000,
    valuePools: [...shieldedOnlyPools, { id: "lockbox", chainValueZat: 500 * ZATOSHI_PER_ZEC }],
    subsidy: null,
  });
  assert.equal(summary.shieldedZec, 4_812 + 548_930 + 1_902_774 + 913_409);
  assert.equal(summary.otherReportedZec, 500);
});

test("transparent is DERIVED and labelled as such when the node reports no transparent pool", () => {
  const summary = summarizeSupply({
    height: 3_470_000,
    valuePools: shieldedOnlyPools,
    subsidy: null,
  });
  assert.equal(summary.transparent.basis, "derived");
  assert.equal(summary.reconciliation.meaningful, false);
  assert.match(summary.reconciliation.detail, /cannot check itself/);
});

test("reconciliation becomes a real check when a transparent pool IS reported", () => {
  const summary = summarizeSupply({
    height: 3_470_000,
    valuePools: [...shieldedOnlyPools, { id: "transparent", chainValueZat: 13_000_000 * ZATOSHI_PER_ZEC }],
    subsidy: null,
  });
  assert.equal(summary.transparent.basis, "reported");
  assert.equal(summary.reconciliation.meaningful, true);
  assert.equal(typeof summary.reconciliation.deltaZec, "number");
});

test("shielded share is a sane fraction", () => {
  const summary = summarizeSupply({
    height: 3_470_000,
    valuePools: shieldedOnlyPools,
    subsidy: null,
  });
  assert.ok(summary.shieldedShare > 0 && summary.shieldedShare < 1);
});

test("no value pools at all degrades cleanly instead of dividing by zero", () => {
  const summary = summarizeSupply({ height: 3_470_000, valuePools: null, subsidy: null });
  assert.equal(summary.pools.length, 0);
  assert.equal(summary.shieldedZec, 0);
  assert.equal(summary.transparent.basis, "unknown");
});

/* ── turnstile ───────────────────────────────────────────────────────────── */

section("turnstile");

/** Blocks where orchard drains and ironwood fills by the same amount. */
function turnstileBlocks(count) {
  const blocks = [];
  for (let i = 0; i < count; i += 1) {
    blocks.push({
      hash: `hash${i}`,
      height: 3_470_000 - count + 1 + i,
      time: 1_755_000_000 + i * 75,
      valuePools: [
        { id: "orchard", valueDeltaZat: -25 * ZATOSHI_PER_ZEC },
        { id: "ironwood", valueDeltaZat: 25 * ZATOSHI_PER_ZEC },
      ],
    });
  }
  return blocks;
}

test("net flow sums per-block deltas", () => {
  const summary = summarizeTurnstile(turnstileBlocks(10));
  const orchard = summary.flows.find((flow) => flow.id === "orchard");
  const ironwood = summary.flows.find((flow) => flow.id === "ironwood");
  assert.equal(orchard.netZec, -250);
  assert.equal(ironwood.netZec, 250);
  assert.equal(orchard.direction, "draining");
  assert.equal(ironwood.direction, "filling");
});

test("offsetting drain and fill is described as the turnstile pattern", () => {
  const summary = summarizeTurnstile(turnstileBlocks(48));
  assert.match(summary.narrative, /turnstile/i);
});

test("non-offsetting flow is NOT described as the turnstile pattern", () => {
  const blocks = turnstileBlocks(10);
  // Break the symmetry: ironwood gains far more than orchard loses.
  for (const block of blocks) block.valuePools[1].valueDeltaZat = 900 * ZATOSHI_PER_ZEC;
  const summary = summarizeTurnstile(blocks);
  assert.doesNotMatch(summary.narrative, /turnstile/i);
  assert.match(summary.narrative, /do not offset/);
});

test("blocks arriving out of order are sorted by height", () => {
  const blocks = turnstileBlocks(5).reverse();
  const summary = summarizeTurnstile(blocks);
  assert.equal(summary.window.fromHeight < summary.window.toHeight, true);
});

test("a pool absent from some blocks is zero-filled to full series length", () => {
  const blocks = turnstileBlocks(4);
  blocks[0].valuePools = [{ id: "sapling", valueDeltaZat: 7 * ZATOSHI_PER_ZEC }];
  const summary = summarizeTurnstile(blocks);
  for (const flow of summary.flows) {
    assert.equal(flow.series.length, 4, `${flow.id} series should span every block`);
    assert.equal(flow.cumulative.length, 4);
  }
});

test("cumulative series is a running total ending at the net", () => {
  const summary = summarizeTurnstile(turnstileBlocks(6));
  const orchard = summary.flows.find((flow) => flow.id === "orchard");
  assert.equal(orchard.cumulative[orchard.cumulative.length - 1], orchard.netZec);
});

test("average block time is computed over intervals, not blocks", () => {
  // 6 blocks 75s apart span 375s across 5 intervals => 75s average.
  const summary = summarizeTurnstile(turnstileBlocks(6));
  assert.equal(summary.avgBlockSeconds, 75);
});

test("an empty window degrades to a message rather than throwing", () => {
  const summary = summarizeTurnstile([]);
  assert.equal(summary.window.blocks, 0);
  assert.equal(summary.flows.length, 0);
  assert.match(summary.narrative, /No block data/);
});

test("blocks with no valuePools produce no flows and say so upstream", () => {
  const summary = summarizeTurnstile([{ hash: "h", height: 1, time: 1, tx: [] }]);
  assert.equal(summary.poolIds.length, 0);
});

/* ── privacy ─────────────────────────────────────────────────────────────── */

section("privacy — transaction classification");

const coinbaseTx = { txid: "cb", vin: [{ coinbase: "03aabbcc" }], vout: [{ value: 1.5625 }] };
const transparentTx = { txid: "t1", vin: [{ txid: "prev" }], vout: [{ value: 1 }, { value: 2 }] };
const shieldingTx = {
  txid: "s1",
  vin: [{ txid: "prev" }],
  vout: [],
  orchard: { actions: [{}, {}], valueBalanceZat: -3 * ZATOSHI_PER_ZEC },
};
const deshieldingTx = {
  txid: "d1",
  vin: [],
  vout: [{ value: 3 }],
  orchard: { actions: [{}, {}], valueBalanceZat: 3 * ZATOSHI_PER_ZEC },
};
const fullyShieldedTx = { txid: "f1", vin: [], vout: [], orchard: { actions: [{}, {}, {}] } };
const mixedTx = {
  txid: "m1",
  vin: [{ txid: "prev" }],
  vout: [{ value: 1 }],
  vShieldedSpend: [{}],
  vShieldedOutput: [{}],
};

test("coinbase is its own class, never lumped in with transparent", () => {
  assert.equal(classifyTx(coinbaseTx).klass, "coinbase");
});

test("all five non-coinbase classes are distinguished", () => {
  assert.equal(classifyTx(transparentTx).klass, "transparent");
  assert.equal(classifyTx(shieldingTx).klass, "shielding");
  assert.equal(classifyTx(deshieldingTx).klass, "deshielding");
  assert.equal(classifyTx(fullyShieldedTx).klass, "fully-shielded");
  assert.equal(classifyTx(mixedTx).klass, "mixed");
});

test("component counts come out right per shape", () => {
  assert.equal(classifyTx(fullyShieldedTx).shieldedComponents, 3);
  assert.equal(classifyTx(mixedTx).shieldedComponents, 2); // 1 spend + 1 output
});

test("Sprout joinsplits are detected", () => {
  const uses = detectShieldedComponents({ vjoinsplit: [{}, {}] });
  assert.equal(uses.length, 1);
  assert.equal(uses[0].pool, "sprout");
  assert.equal(uses[0].shape, "joinsplit");
  assert.equal(uses[0].components, 2);
});

test("Sapling spend/output pairs are detected and its valueBalance read", () => {
  const uses = detectShieldedComponents({
    vShieldedSpend: [{}],
    vShieldedOutput: [{}, {}],
    valueBalanceZat: -5 * ZATOSHI_PER_ZEC,
  });
  assert.equal(uses.length, 1);
  assert.equal(uses[0].pool, "sapling");
  assert.equal(uses[0].components, 3);
  assert.equal(uses[0].valueBalanceZec, -5);
});

test("THE FORWARD-COMPAT TEST: an action-based pool this code has never heard of is still counted", () => {
  const uses = detectShieldedComponents({
    somePoolFromTheFuture: { actions: [{}, {}, {}, {}], valueBalanceZat: 2 * ZATOSHI_PER_ZEC },
  });
  assert.equal(uses.length, 1);
  assert.equal(uses[0].pool, "somepoolfromthefuture");
  assert.equal(uses[0].shape, "action");
  assert.equal(uses[0].components, 4);
  assert.equal(uses[0].recognised, false, "should be flagged as an unrecognised pool name");
});

test("Ironwood, whose serialisation postdates this code, classifies correctly if action-shaped", () => {
  const tx = { txid: "iw", vin: [], vout: [], ironwood: { actions: [{}, {}] } };
  const classified = classifyTx(tx);
  assert.equal(classified.klass, "fully-shielded");
  assert.deepEqual(classified.pools, ["ironwood"]);
  assert.equal(detectShieldedComponents(tx)[0].recognised, true);
});

test("a transaction touching two pools reports both", () => {
  const uses = detectShieldedComponents({
    vShieldedSpend: [{}],
    orchard: { actions: [{}] },
  });
  assert.equal(uses.length, 2);
  assert.deepEqual(uses.map((use) => use.pool).sort(), ["orchard", "sapling"]);
});

test("vin/vout and non-pool objects are not mistaken for shielded pools", () => {
  const uses = detectShieldedComponents(transparentTx);
  assert.equal(uses.length, 0);
});

test("a coinbase paying to a shielded address still records its shielded components", () => {
  const tx = { txid: "cb2", vin: [{ coinbase: "01" }], vout: [], orchard: { actions: [{}] } };
  const classified = classifyTx(tx);
  assert.equal(classified.klass, "coinbase");
  assert.equal(classified.shieldedComponents, 1);
});

section("privacy — window aggregation");

function privacyEntry(height, txs) {
  return { block: { hash: `h${height}`, height, time: 1_755_000_000 + height }, txs };
}

test("shielded share excludes coinbase from the denominator", () => {
  const mix = summarizePrivacy([
    privacyEntry(100, [coinbaseTx, fullyShieldedTx, transparentTx]),
  ]);
  assert.equal(mix.totalTxs, 3);
  assert.equal(mix.userTxs, 2);
  assert.equal(mix.shieldedShare, 0.5);
  assert.equal(mix.fullyShieldedShare, 0.5);
});

test("a coinbase-only block reports no share rather than 0% or NaN", () => {
  const mix = summarizePrivacy([privacyEntry(100, [coinbaseTx])]);
  assert.equal(mix.userTxs, 0);
  assert.equal(mix.shieldedShare, null);
  assert.match(mix.narrative, /coinbase only/);
});

test("pool usage is tallied across the window, busiest first", () => {
  const mix = summarizePrivacy([
    privacyEntry(100, [coinbaseTx, fullyShieldedTx, shieldingTx]),
    privacyEntry(101, [coinbaseTx, mixedTx]),
  ]);
  const orchard = mix.poolUsage.find((usage) => usage.pool === "orchard");
  const sapling = mix.poolUsage.find((usage) => usage.pool === "sapling");
  assert.equal(orchard.txs, 2);
  assert.equal(sapling.txs, 1);
  assert.equal(mix.poolUsage[0].pool, "orchard");
});

test("unrecognised pools are surfaced so the UI can admit uncertainty", () => {
  const mix = summarizePrivacy([
    privacyEntry(100, [coinbaseTx, { txid: "x", vin: [], vout: [], mysteryPool: { actions: [{}] } }]),
  ]);
  assert.deepEqual(mix.unrecognisedPools, ["mysterypool"]);
});

test("blocks are sorted and the window bounds reported", () => {
  const mix = summarizePrivacy([
    privacyEntry(102, [coinbaseTx]),
    privacyEntry(100, [coinbaseTx]),
  ]);
  assert.equal(mix.window.fromHeight, 100);
  assert.equal(mix.window.toHeight, 102);
  assert.equal(mix.window.blocks, 2);
});

test("an empty window degrades to a message", () => {
  const mix = summarizePrivacy([]);
  assert.equal(mix.window.blocks, 0);
  assert.match(mix.narrative, /No transaction data/);
});

/* ── upgrades ────────────────────────────────────────────────────────────── */

section("upgrades");

const upgradeMap = {
  "5ba81b19": { name: "Overwinter", activationheight: 347_500, status: "active" },
  "76b809bb": { name: "Sapling", activationheight: 419_200, status: "active" },
  c2d6d0b4: { name: "NU6", activationheight: 2_726_400, status: "active" },
  ffffffff: { name: "Ironwood", activationheight: 3_366_400, status: "active" },
  eeeeeeee: { name: "Future", activationheight: 3_500_000, status: "pending" },
};

test("current is the most recent active upgrade and next is the pending one", () => {
  const timeline = buildUpgradeTimeline({ height: 3_470_000, upgrades: upgradeMap });
  assert.equal(timeline.current.name, "Ironwood");
  assert.equal(timeline.next.name, "Future");
});

test("ETA uses the measured block time when it is plausible", () => {
  const timeline = buildUpgradeTimeline({
    height: 3_470_000,
    upgrades: upgradeMap,
    avgBlockSeconds: 80,
  });
  assert.equal(timeline.blockSecondsBasis, "measured");
  assert.equal(timeline.blockSeconds, 80);
  assert.equal(timeline.next.etaSeconds, 30_000 * 80);
  assert.equal(timeline.next.confidence, "measured");
});

test("an implausible measured block time is rejected in favour of the 75s target", () => {
  const timeline = buildUpgradeTimeline({
    height: 3_470_000,
    upgrades: upgradeMap,
    avgBlockSeconds: 4000, // a window straddling a difficulty swing
  });
  assert.equal(timeline.blockSecondsBasis, "target");
  assert.equal(timeline.blockSeconds, 75);
});

test("activated upgrades get no ETA and report how far back they activated", () => {
  const timeline = buildUpgradeTimeline({ height: 3_470_000, upgrades: upgradeMap });
  const sapling = timeline.upgrades.find((upgrade) => upgrade.name === "Sapling");
  assert.equal(sapling.etaSeconds, null);
  assert.equal(sapling.confidence, "none");
  assert.ok(sapling.blocksAway < 0);
});

test("upgrades are ordered oldest activation first", () => {
  const timeline = buildUpgradeTimeline({ height: 3_470_000, upgrades: upgradeMap });
  const heights = timeline.upgrades.map((upgrade) => upgrade.activationHeight);
  assert.deepEqual(heights, [...heights].sort((a, b) => a - b));
});

test("a status vocabulary we did not expect falls back to comparing heights", () => {
  const timeline = buildUpgradeTimeline({
    height: 3_470_000,
    upgrades: { aa: { name: "Odd", activationheight: 100, status: "somethingElse" } },
  });
  assert.equal(timeline.upgrades[0].status, "active");
  assert.equal(timeline.upgrades[0].rawStatus, "somethingElse");
});

test("a node with no upgrades map degrades with a note", () => {
  const timeline = buildUpgradeTimeline({ height: 3_470_000, upgrades: null });
  assert.equal(timeline.upgrades.length, 0);
  assert.equal(timeline.next, null);
  assert.match(timeline.note, /does not report an upgrades map/);
});

/* ── data layer, end to end against the demo node ────────────────────────── */

/**
 * Everything above is pure. This section exercises the real stack — transport,
 * capability probing, dialect routing, caching, composition — against the
 * synthetic node in lib/rpc/demo.ts.
 *
 * The demo node emulates zebrad, and it does so at two ages, because "zebrad" is
 * not one target: `getmempoolinfo`, `getnetworkinfo` and per-pool `valueDelta` on
 * `getblock` all arrived partway through Zebra's life.
 *
 *   zebra         (default) a current node. Everything answers. This is what a
 *                 reader following the README will actually be running, so it is
 *                 the profile the bulk of these tests use.
 *   zebra-legacy  an older node. The section further down runs against it, and it
 *                 is where the dialect layer is actually put under load: every
 *                 fallback path fires, and the turnstile has to reconstruct flows
 *                 the node does not report.
 */

// Pin the default explicitly. Otherwise a ZPULSE_DEMO_PROFILE left in the shell
// would silently decide which node this section runs against, and withDemoProfile
// would restore to it — turning "the default profile" into "whatever you exported".
delete process.env.ZPULSE_DEMO_PROFILE;

section("data layer — demo node (current zebrad)");

const { getCapabilities, getChain, getHeight, getNode, getPools, getPrivacy, getTurnstile, getUpgrades, describeConfig, takeSnapshot } =
  await import("../lib/data.ts");
const { cacheStats, clearCache } = await import("../lib/cache.ts");
const { FEATURE_BLOCK_VALUE_DELTA, FEATURE_BLOCK_VERBOSITY_2, resetCapabilityCache } =
  await import("../lib/rpc/capabilities.ts");

async function asyncTest(name, fn) {
  try {
    await fn();
    passed += 1;
    process.stdout.write(`  ok   ${name}\n`);
  } catch (err) {
    failed += 1;
    failures.push({ name, message: err?.message ?? String(err) });
    process.stdout.write(`  FAIL ${name}\n`);
  }
}

/**
 * Run a block of tests against a specific demo-node profile.
 *
 * Both the response cache and the capability cache are per-process and neither
 * has invalidation, because a real node does not gain or lose RPC methods while
 * it is running. Swapping the node underneath them is a thing only a test does,
 * so both are cleared on the way in and again on the way out — otherwise a probe
 * result from the previous profile would decide the next profile's fallbacks.
 */
async function withDemoProfile(profile, fn) {
  const previous = process.env.ZPULSE_DEMO_PROFILE;
  process.env.ZPULSE_DEMO_PROFILE = profile;
  clearCache();
  resetCapabilityCache();
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.ZPULSE_DEMO_PROFILE;
    else process.env.ZPULSE_DEMO_PROFILE = previous;
    clearCache();
    resetCapabilityCache();
  }
}

await asyncTest("identity comes from the user agent, not from which methods are missing", async () => {
  // The bug this pins down: an earlier version inferred "Zebra" from the absence
  // of getmempoolinfo. Current Zebra implements it, so that inference labelled
  // every modern zebrad as zcashd. Identity is now read, not deduced — which
  // means a node answering every method must still identify as zebra.
  const { data } = await getCapabilities();
  assert.equal(data.implementation, "zebra");
  assert.match(data.userAgent, /Zebra/, `unexpected user agent: ${data.userAgent}`);

  const unsupported = data.entries.filter((entry) => !entry.supported);
  assert.deepEqual(
    unsupported.map((entry) => entry.key),
    [],
    "a current zebrad should answer every probe, including the two once thought Zebra lacked",
  );
  const has = (key) => data.entries.find((entry) => entry.key === key)?.supported;
  assert.equal(has("getnetworkinfo"), true);
  assert.equal(has("getmempoolinfo"), true);
  assert.equal(has(FEATURE_BLOCK_VERBOSITY_2), true);
  assert.equal(has(FEATURE_BLOCK_VALUE_DELTA), true);

  // The three probe kinds are distinct, and the console depends on the
  // distinction: only a `method` row being unsupported means -32601.
  const kinds = new Set(data.entries.map((entry) => entry.kind));
  assert.deepEqual([...kinds].sort(), ["feature", "method", "shape"]);
  assert.equal(data.entries.find((entry) => entry.key === FEATURE_BLOCK_VALUE_DELTA).kind, "shape");
});

await asyncTest("credentials never leak: endpoint description carries no URL or token", async () => {
  const config = describeConfig();
  assert.equal(config.mode, "demo");
  assert.equal(config.endpoint, "demo (synthetic node)");
  assert.doesNotMatch(JSON.stringify(config), /http|token|password/i);
});

await asyncTest("getChain returns a live-looking tip and names the method that produced it", async () => {
  const { data, meta } = await getChain();
  assert.ok(data.height > 3_000_000, `implausible height: ${data.height}`);
  assert.match(data.hash, /^[0-9a-f]{64}$/);
  assert.equal(meta.source, "demo");
  assert.ok(meta.via.includes("getblockchaininfo"));
  assert.equal(meta.degraded, false, `unexpected notes: ${meta.notes.join(" | ")}`);
});

await asyncTest("node panel takes the one-call path when the node has it", async () => {
  const { data, meta } = await getNode();
  assert.ok(data.mempool !== null);
  assert.ok(data.version !== null);
  // The cheap path: one call each, and specifically NOT the fallbacks, which cost
  // a verbose mempool dump and a client-side sum.
  assert.ok(meta.via.includes("getmempoolinfo"), "should prefer getmempoolinfo on a node that has it");
  assert.ok(meta.via.includes("getnetworkinfo"), "should prefer getnetworkinfo on a node that has it");
  assert.ok(data.mempool.bytes !== null, "getmempoolinfo reports bytes directly");
  assert.ok(data.peers.count > 0);
  assert.ok(data.solps > 0);
  assert.equal(meta.degraded, false, `unexpected notes: ${meta.notes.join(" | ")}`);
});

await asyncTest("supply panel reconciles, and the node agrees with the issuance model", async () => {
  const { data } = await getPools();
  assert.ok(data.supply.pools.length >= 3, "expected several value pools");
  assert.ok(data.supply.shieldedZec > 0);
  assert.equal(data.supply.modelCheck.ok, true, data.supply.modelCheck.detail);
  // The independent check: our ZIP-208 model vs the node's own getblocksubsidy.
  assert.equal(
    data.supply.subsidyCheck.agrees,
    true,
    `subsidy mismatch — ${data.supply.subsidyCheck.detail}`,
  );
  assert.ok(data.supply.shieldedShare > 0 && data.supply.shieldedShare < 1);
  assert.deepEqual(data.supply.unrecognisedPools, [], "demo pools should all be recognised");
  assert.ok(data.treeState !== null, "z_gettreestate should resolve");
});

await asyncTest("turnstile shows one pool draining and another filling", async () => {
  // This assertion used to be a coin flip. The demo tip advances with the wall
  // clock, so the window lands somewhere different every run, and hash32() was
  // bare FNV-1a with no output avalanche — lag-1 correlation 0.8796, and 8.26% of
  // 16-block windows had no pool movement at all. Adding MurmurHash3's fmix32
  // finalizer took that to correlation -0.0036 and a longest all-flat run of 6.
  // Checked exhaustively afterwards: all 460,737 consecutive 16-block windows
  // across 400 days of synthetic chain satisfy the three assertions below, so
  // this test no longer depends on what day it runs.
  const { data, meta } = await getTurnstile(16);
  assert.equal(data.requestedBlocks, 16);
  assert.equal(data.window.blocks, 16);
  assert.equal(data.deltaSource, "reported", "a current zebrad reports valueDelta directly");
  assert.ok(data.flows.length >= 2);
  assert.ok(
    data.flows.some((flow) => flow.direction === "draining"),
    "expected a draining pool",
  );
  assert.ok(
    data.flows.some((flow) => flow.direction === "filling"),
    "expected a filling pool",
  );
  assert.ok(meta.via.includes("getblock"));
  for (const flow of data.flows) {
    assert.equal(flow.series.length, 16, `${flow.id} series must span the window`);
  }
});

await asyncTest("privacy mix classifies real transaction objects from getblock verbosity 2", async () => {
  const { data, meta } = await getPrivacy(6);
  assert.equal(data.window.blocks, 6);
  assert.ok(data.totalTxs > 0);
  assert.ok(data.userTxs > 0);
  assert.equal(data.counts.coinbase, 6, "one coinbase per block");
  assert.ok(data.shieldedShare > 0 && data.shieldedShare <= 1);
  assert.ok(data.poolUsage.length > 0);
  assert.deepEqual(data.unrecognisedPools, []);
  // Verbosity 2 means one call per block, so no getrawtransaction fallback.
  assert.ok(!meta.via.includes("getrawtransaction"), "verbosity 2 should have avoided the 1+N path");
});

await asyncTest("upgrade timeline reads the upgrades map and dates the next one", async () => {
  const { data } = await getUpgrades();
  assert.ok(data.upgrades.length > 0);
  assert.ok(data.current !== null, "expected a current active upgrade");
  assert.ok(data.blockSeconds > 0);
  const heights = data.upgrades.map((upgrade) => upgrade.activationHeight);
  assert.deepEqual(heights, [...heights].sort((a, b) => a - b));
});

await asyncTest("getHeight is a single cheap call for the ticker", async () => {
  const { data, meta } = await getHeight();
  assert.ok(data.height > 3_000_000);
  assert.deepEqual(meta.via, ["getblockcount"]);
});

await asyncTest("caching coalesces: the second identical read does not re-fetch", async () => {
  clearCache();
  await getChain();
  const afterFirst = cacheStats();
  await getChain();
  const afterSecond = cacheStats();
  assert.ok(
    afterSecond.hits > afterFirst.hits,
    `expected a cache hit on the repeat read (${afterFirst.hits} -> ${afterSecond.hits})`,
  );
});

await asyncTest("concurrent readers of the same key cost one upstream call", async () => {
  clearCache();
  const before = cacheStats();
  await Promise.all(Array.from({ length: 8 }, () => getChain()));
  const after = cacheStats();
  assert.equal(after.misses - before.misses, 1, "8 concurrent readers should produce exactly 1 miss");
});

await asyncTest("a block window is cached, so re-reading it is free", async () => {
  clearCache();
  await getTurnstile(12);
  const afterFirst = cacheStats();
  await getTurnstile(12);
  const afterSecond = cacheStats();
  assert.equal(
    afterSecond.misses,
    afterFirst.misses,
    "the second pass over the same window must not miss at all",
  );
});

await asyncTest("takeSnapshot produces a narrow row for the history store", async () => {
  const snapshot = await takeSnapshot();
  assert.equal(snapshot.reachable, true);
  assert.ok(snapshot.height > 3_000_000);
  assert.ok(snapshot.peers > 0);
  assert.equal(typeof snapshot.shieldedZec, "number");
  assert.equal(snapshot.error, undefined);
});

await asyncTest("window sizes are clamped so a query param cannot walk the chain", async () => {
  const { data } = await getTurnstile(100_000);
  assert.ok(data.requestedBlocks <= 144, `window not clamped: ${data.requestedBlocks}`);
  const privacy = await getPrivacy(100_000);
  assert.ok(privacy.data.requestedBlocks <= 32, `window not clamped: ${privacy.data.requestedBlocks}`);
});

await asyncTest("the demo tip advances with the clock, so the live ticker genuinely ticks", async () => {
  const { demoTipHeight } = await import("../lib/rpc/demo.ts");
  const now = 1_800_000_000_000;
  const before = demoTipHeight(now);
  assert.equal(demoTipHeight(now + 1_000), before, "a one-second gap must not move the tip");
  assert.equal(demoTipHeight(now + 75_000), before + 1, "one target spacing must advance one block");
});

await asyncTest("an unsupported method still throws rather than being papered over", async () => {
  const { rpcCall } = await import("../lib/rpc/client.ts");
  const { RpcUnsupportedError } = await import("../lib/rpc/errors.ts");
  // getaddressbalance is real on zcashd and on Zebra with the address index
  // enabled, and the demo node does not implement it. So it is the right shape of
  // "no": a method that exists in the world but not on this endpoint.
  //
  // The point is that demo mode is not a yes-machine. If the fixture answered
  // everything, the dialect fallbacks would never be exercised by these tests and
  // a broken fallback would ship green.
  await assert.rejects(() => rpcCall("getaddressbalance", [{ addresses: [] }]), RpcUnsupportedError);
});

/* ── the older zebrad ────────────────────────────────────────────────────── */

/**
 * Everything above ran against a node that answers every method. That is the easy
 * case, and it is not the case the dialect layer exists for.
 *
 * This section runs the same stack against `zebra-legacy` — a zebrad old enough to
 * predate `getmempoolinfo`, `getnetworkinfo` and per-pool `valueDelta`. Every
 * fallback tier fires here, and the turnstile has to reconstruct flows from
 * consecutive pool totals because the node does not report them.
 *
 * These are the assertions that used to be the "regression test" above, when this
 * file wrongly believed *all* zebrad refused those two methods. The tests were
 * good; only their premise about which node lacked the methods was wrong. So they
 * moved rather than being deleted.
 */

section("data layer — older zebrad (every fallback fires)");

await withDemoProfile("zebra-legacy", async () => {
  await asyncTest("node panel routes around methods this node predates", async () => {
    const { data, meta } = await getNode();
    // Both of these would have thrown in the original prototype, which called the
    // two methods unconditionally.
    assert.ok(data.mempool !== null, "mempool must resolve without getmempoolinfo");
    assert.ok(data.version !== null, "version must resolve without getnetworkinfo");
    assert.ok(meta.via.includes("getrawmempool"), "should have fallen back to getrawmempool");
    assert.ok(meta.via.includes("getinfo"), "should have fallen back to getinfo for the version");
    assert.ok(!meta.via.includes("getmempoolinfo"), "must not have called the unsupported method");
    assert.ok(!meta.via.includes("getnetworkinfo"), "must not have called the unsupported method");
    assert.ok(data.peers.count > 0);
    assert.ok(data.solps > 0);
  });

  await asyncTest("the two methods really are -32601 on this profile", async () => {
    const { rpcCall } = await import("../lib/rpc/client.ts");
    const { RpcUnsupportedError } = await import("../lib/rpc/errors.ts");
    await assert.rejects(() => rpcCall("getmempoolinfo"), RpcUnsupportedError);
    await assert.rejects(() => rpcCall("getnetworkinfo"), RpcUnsupportedError);
  });

  await asyncTest("identity survives a node that answers fewer methods", async () => {
    // The inverse of the modern-profile test: fewer methods must not change who
    // the node says it is. Both profiles report /Zebra:.../ and both classify as
    // zebra, because the classification reads the user agent.
    const { data } = await getCapabilities();
    assert.equal(data.implementation, "zebra");
    assert.match(data.userAgent, /Zebra/);
    const has = (key) => data.entries.find((entry) => entry.key === key)?.supported;
    assert.equal(has("getmempoolinfo"), false);
    assert.equal(has("getnetworkinfo"), false);
    assert.equal(has(FEATURE_BLOCK_VALUE_DELTA), false, "this node's getblock omits valueDelta");
    assert.equal(has("getblockchaininfo"), true, "the core five must still answer");
  });

  await asyncTest("THE REGRESSION TEST: the turnstile derives flows the node never reported", async () => {
    const { data, meta } = await getTurnstile(16);
    assert.equal(
      data.deltaSource,
      "derived",
      "with no valueDelta field, deltas must come from differencing chainValue",
    );
    assert.equal(data.window.blocks, 16);
    assert.ok(data.flows.length >= 2, "a derived chart is still a chart");
    assert.ok(
      data.flows.some((flow) => flow.direction === "draining"),
      "expected a draining pool",
    );
    assert.ok(
      data.flows.some((flow) => flow.direction === "filling"),
      "expected a filling pool",
    );
    for (const flow of data.flows) {
      assert.equal(flow.series.length, 16, `${flow.id} series must span the window`);
    }
    // Deriving costs one block below the window, for the oldest block's baseline.
    assert.ok(meta.via.includes("getblock"));
    assert.ok(
      meta.notes.some((note) => /derived/i.test(note)),
      `the panel must say "derived" out loud: ${meta.notes.join(" | ")}`,
    );
  });
});

await asyncTest("derived deltas agree with reported ones to within a zatoshi", async () => {
  /**
   * The claim the derived tier rests on: differencing consecutive `chainValue`
   * totals gives the same answer the node would have reported.
   *
   * It is exact rather than approximate, and the reason is scale. `chainValueZat`
   * is an integer near 1e14 — comfortably inside 2^53 — so the subtraction loses
   * nothing. Only the ZEC-denominated float carries any error at all, and it
   * telescopes: measured agreement below is ~1e-10 ZEC, four orders of magnitude
   * finer than one zatoshi (1e-8).
   *
   * Both profiles are read at the same window here so the comparison is like for
   * like. Anything else would be comparing two different stretches of chain.
   */
  const blocks = 60;
  let reported;
  let derived;
  await withDemoProfile("zebra", async () => {
    reported = (await getTurnstile(blocks)).data;
  });
  await withDemoProfile("zebra-legacy", async () => {
    derived = (await getTurnstile(blocks)).data;
  });

  assert.equal(reported.deltaSource, "reported");
  assert.equal(derived.deltaSource, "derived");
  assert.equal(reported.window.fromHeight, derived.window.fromHeight, "same window, or no comparison");
  assert.deepEqual(derived.poolIds, reported.poolIds, "deriving must not invent or drop a pool");

  const ZATOSHI = 1e-8;
  for (const expected of reported.flows) {
    const actual = derived.flows.find((flow) => flow.id === expected.id);
    assert.ok(actual, `derived flows are missing ${expected.id}`);
    const drift = Math.abs(actual.netZec - expected.netZec);
    assert.ok(
      drift < ZATOSHI,
      `${expected.id}: derived net ${actual.netZec} vs reported ${expected.netZec} (drift ${drift})`,
    );
    assert.equal(actual.direction, expected.direction, `${expected.id} direction disagrees`);
  }
  assert.equal(derived.narrative, reported.narrative, "the same flows must read the same way");
});

/* ── console allowlist: the security boundary ────────────────────────────── */

/**
 * These are the tests that matter most in the whole file. /api/rpc takes a method
 * name from the browser, and lib/rpc/console.ts is the only thing standing between
 * that string and a node. If the allowlist ever stops being an allowlist, nothing
 * else in this app matters.
 */

section("console allowlist — the security boundary");

const {
  CONSOLE_METHODS,
  ConsoleRejectedError,
  consoleAllowlistDrift,
  validateConsoleCall,
} = await import("../lib/rpc/console.ts");

function rejects(method, params) {
  assert.throws(
    () => validateConsoleCall(method, params),
    ConsoleRejectedError,
    `${JSON.stringify(method)} with ${JSON.stringify(params)} should have been rejected`,
  );
}

test("every mutating and wallet method is unreachable", () => {
  // Not a denylist — none of these are mentioned anywhere in console.ts. They are
  // unreachable because they were never added. This test asserts that property.
  const dangerous = [
    "stop",
    "sendrawtransaction",
    "submitblock",
    "generate",
    "setban",
    "addnode",
    "z_sendmany",
    "z_shieldcoinbase",
    "sendtoaddress",
    "walletpassphrase",
    "dumpprivkey",
    "dumpwallet",
    "importprivkey",
    "z_exportkey",
    "z_getnewaccount",
    "backupwallet",
    "setgenerate",
    "clearbanned",
  ];
  for (const method of dangerous) rejects(method, []);
});

test("a method that merely looks plausible is still rejected", () => {
  rejects("getbalance", []);
  rejects("getblockchaininfo2", []);
  rejects("GETBLOCKCHAININFO", []); // case-sensitive on purpose
  rejects("", []);
  rejects(null, []);
  rejects(undefined, []);
  rejects(42, []);
  rejects({ method: "getblockcount" }, []);
});

test("the allowlist and the capability probe table do not disagree", () => {
  const drift = consoleAllowlistDrift();
  assert.deepEqual(
    drift,
    { consoleOnly: [], probeOnly: [] },
    "one table gained a method the other did not",
  );
});

test("params must be a positional array, not an object", () => {
  rejects("getblockhash", { index: 1 });
  rejects("getblockhash", "1");
});

test("too many params is a rejection, not a silent truncation", () => {
  rejects("getblockcount", [1]);
  rejects("getblock", ["1", 1, "extra"]);
});

test("a required param cannot be omitted", () => {
  rejects("getblockhash", []);
  rejects("getblock", []);
  rejects("getrawtransaction", []);
  rejects("z_gettreestate", []);
});

test("integer params are range-checked", () => {
  rejects("getblock", ["1", 3]); // verbosity above 2
  rejects("getblock", ["1", -1]);
  rejects("getblockhash", [-1]);
  rejects("getrawtransaction", ["ab".repeat(32), 2]);
  rejects("getblockhash", ["not a number"]);
  rejects("getblockhash", [{}]);
});

test("a block id must be a height or a real hash, and a txid must be hex64", () => {
  rejects("getblock", ["latest"]);
  rejects("getblock", ["0x1"]);
  rejects("getblock", ["ab".repeat(31)]); // 62 chars
  rejects("getblock", [{}]);
  rejects("getrawtransaction", ["not-a-txid"]);
  rejects("getrawtransaction", ["zz".repeat(32)]);
});

test("a height given as a number is stringified, because both dialects want it quoted", () => {
  const { params } = validateConsoleCall("getblock", [1234, 2]);
  assert.deepEqual(params, ["1234", 2]);
});

test("a hash is normalised to lower case", () => {
  const hash = "AB".repeat(32);
  const { params } = validateConsoleCall("getblock", [hash]);
  assert.deepEqual(params, [hash.toLowerCase()]);
});

test("booleans accept the string spellings a form field produces", () => {
  assert.deepEqual(validateConsoleCall("getrawmempool", ["true"]).params, [true]);
  assert.deepEqual(validateConsoleCall("getrawmempool", ["false"]).params, [false]);
  assert.deepEqual(validateConsoleCall("getrawmempool", [true]).params, [true]);
  rejects("getrawmempool", ["yes"]);
  rejects("getrawmempool", [1]);
});

test("trailing params the caller did not supply are dropped, so the envelope is minimal", () => {
  assert.deepEqual(validateConsoleCall("getblock", ["1"]).params, ["1"]);
  assert.deepEqual(validateConsoleCall("getrawmempool", []).params, []);
  assert.deepEqual(validateConsoleCall("getblocksubsidy", []).params, []);
  assert.deepEqual(validateConsoleCall("getnetworksolps", []).params, []);
});

test("supplying a later optional fills the earlier one from its default", () => {
  // JSON-RPC params are positional, so argument 1 cannot be skipped to reach
  // argument 2. This is what the defaults exist for.
  const { params } = validateConsoleCall("getnetworksolps", [null, 100]);
  assert.deepEqual(params, [120, 100]);
});

test("every allowlisted method is a read, and every param spec is usable", () => {
  for (const entry of CONSOLE_METHODS) {
    assert.match(
      entry.method,
      /^(get|z_get)/,
      `${entry.method} does not look like a getter — read methods only`,
    );
    assert.ok(entry.summary.length > 10, `${entry.method} needs a summary`);
    assert.ok(entry.usedFor.length > 10, `${entry.method} must say what ZPulse uses it for`);
    let seenOptional = false;
    for (const param of entry.params) {
      if (param.default !== undefined) seenOptional = true;
      else if (seenOptional) {
        assert.fail(`${entry.method} has a required param after an optional one, which is unrepresentable`);
      }
    }
  }
});

/* ── rate limiting ───────────────────────────────────────────────────────── */

section("rate limiting");

const { checkRateLimit, clientKey, resetRateLimits } = await import("../lib/ratelimit.ts");

test("a bucket allows exactly its limit, then refuses", () => {
  resetRateLimits();
  const results = [];
  for (let i = 0; i < 5; i += 1) results.push(checkRateLimit("t", 3, 60_000));
  assert.deepEqual(
    results.map((result) => result.allowed),
    [true, true, true, false, false],
  );
  assert.equal(results[2].remaining, 0);
  assert.ok(results[3].retryAfterMs > 0);
});

test("buckets are independent, so one client cannot exhaust another", () => {
  resetRateLimits();
  checkRateLimit("a", 1, 60_000);
  assert.equal(checkRateLimit("a", 1, 60_000).allowed, false);
  assert.equal(checkRateLimit("b", 1, 60_000).allowed, true);
});

test("an expired window starts fresh", () => {
  resetRateLimits();
  assert.equal(checkRateLimit("c", 1, 1).allowed, true);
  assert.equal(checkRateLimit("c", 1, 1).allowed, false);
  // A 1ms window: a synchronous busy-wait is enough to pass it.
  const until = Date.now() + 3;
  while (Date.now() < until) {
    /* spin */
  }
  assert.equal(checkRateLimit("c", 1, 1).allowed, true);
});

test("client key prefers the first forwarded hop and degrades to a constant", () => {
  const forwarded = new Request("http://x/", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } });
  assert.equal(clientKey(forwarded), "203.0.113.7");
  assert.equal(clientKey(new Request("http://x/")), "unknown");
});

/* ── history store ───────────────────────────────────────────────────────── */

section("history store");

// Set before the first historyStore() call — the singleton reads the path once.
const storeDir = `${process.env.TMPDIR ?? "/tmp"}/zpulse-verify-${process.pid}`;
process.env.ZPULSE_HISTORY_PATH = `${storeDir}/history.jsonl`;

const { JsonlHistoryStore } = await import("../lib/store/jsonl.ts");
const {
  appendFile: appendRaw,
  mkdir: mkdirRaw,
  rm: rmRaw,
  writeFile: writeRaw,
} = await import("node:fs/promises");

await asyncTest("rows round-trip through the file, oldest first", async () => {
  const path = `${storeDir}/roundtrip.jsonl`;
  await rmRaw(path, { force: true });
  const store = new JsonlHistoryStore(path);

  for (let i = 0; i < 5; i += 1) {
    await store.append({
      at: 1_000 + i,
      reachable: true,
      height: 100 + i,
      peers: 8,
      mempoolSize: 1,
      solps: 5,
      verificationProgress: 1,
      shieldedZec: 42,
    });
  }

  const rows = await store.recent(10);
  assert.equal(rows.length, 5);
  assert.deepEqual(
    rows.map((row) => row.height),
    [100, 101, 102, 103, 104],
  );
});

await asyncTest("recent(n) returns the newest n, not the oldest", async () => {
  const path = `${storeDir}/limit.jsonl`;
  await rmRaw(path, { force: true });
  const store = new JsonlHistoryStore(path);
  for (let i = 0; i < 40; i += 1) {
    await store.append({
      at: 1_000 + i,
      reachable: true,
      height: i,
      peers: 8,
      mempoolSize: 0,
      solps: 0,
      verificationProgress: 1,
      shieldedZec: 0,
    });
  }
  const rows = await store.recent(5);
  assert.deepEqual(
    rows.map((row) => row.height),
    [35, 36, 37, 38, 39],
  );
});

await asyncTest("A TORN FINAL LINE COSTS ONE ROW, NOT THE FILE", async () => {
  // This is the whole reason the format is JSONL rather than a JSON array. A
  // process killed mid-write leaves a fragment; every row before it must survive.
  const path = `${storeDir}/torn.jsonl`;
  await rmRaw(path, { force: true });
  await mkdirRaw(storeDir, { recursive: true });
  const store = new JsonlHistoryStore(path);
  await store.append({
    at: 1,
    reachable: true,
    height: 7,
    peers: 8,
    mempoolSize: 0,
    solps: 0,
    verificationProgress: 1,
    shieldedZec: 0,
  });
  await appendRaw(path, '{"at":2,"height":8,"reach');

  const rows = await store.recent(10);
  assert.equal(rows.length, 1, "the good row must survive the torn one");
  assert.equal(rows[0].height, 7);
});

await asyncTest("a row with no timestamp is not a row", async () => {
  const path = `${storeDir}/undated.jsonl`;
  await rmRaw(path, { force: true });
  await mkdirRaw(storeDir, { recursive: true });
  await appendRaw(path, '{"height":9,"reachable":true}\n{"at":5,"height":10}\n');
  const store = new JsonlHistoryStore(path);
  const rows = await store.recent(10);
  assert.deepEqual(
    rows.map((row) => row.height),
    [10],
    "an unordered, unplottable row is dropped",
  );
});

await asyncTest("an empty or missing file reads as no history, not an error", async () => {
  const store = new JsonlHistoryStore(`${storeDir}/does-not-exist.jsonl`);
  assert.deepEqual(await store.recent(10), []);
  const description = await store.describe();
  assert.equal(description.entries, 0);
  assert.equal(description.durable, true);
});

await asyncTest("an unwritable path degrades to memory and says so", async () => {
  // A path *underneath a regular file* can never be created — mkdir returns ENOTDIR
  // on every POSIX system — which is the same shape as the read-only filesystem a
  // serverless platform gives you. (An earlier version of this test used /proc,
  // which works on a normal box but blocks forever under a syscall-filtering
  // sandbox, hanging the whole suite. A plain file is portable.)
  const blocker = `${storeDir}/not-a-directory`;
  await mkdirRaw(storeDir, { recursive: true });
  await appendRaw(blocker, "this is a file, so nothing can live inside it\n", "utf8");

  const store = new JsonlHistoryStore(`${blocker}/history.jsonl`);
  await store.append({
    at: 1,
    reachable: true,
    height: 3,
    peers: 1,
    mempoolSize: 0,
    solps: 0,
    verificationProgress: 1,
    shieldedZec: 0,
  });
  const rows = await store.recent(10);
  assert.equal(rows.length, 1, "the row must survive in memory");
  const description = await store.describe();
  assert.equal(description.kind, "memory");
  assert.equal(description.durable, false);
  assert.match(description.note ?? "", /read-only|disk|memory/i);
});

/* ── alert rules ─────────────────────────────────────────────────────────── */

section("alert rules");

const { diffAlerts, evaluateAlerts } = await import("../lib/alerts/rules.ts");

function snap(overrides) {
  return {
    at: Date.now(),
    reachable: true,
    height: 3_000_000,
    peers: 8,
    mempoolSize: 2,
    solps: 9e9,
    verificationProgress: 1,
    shieldedZec: 3_000_000,
    ...overrides,
  };
}

test("an unreachable node produces exactly one alert, not five", () => {
  // Every other rule returns early when the node is down. Otherwise a single
  // outage fans out into five alerts describing the same outage, and the
  // transition log becomes unreadable at the moment it matters most.
  const active = evaluateAlerts(snap({ reachable: false, error: "connect ECONNREFUSED", height: null, peers: null }), []);
  assert.deepEqual(Object.keys(active), ["unreachable"]);
  assert.equal(active.unreachable.severity, "critical");
  assert.match(active.unreachable.message, /ECONNREFUSED/);
});

test("low peers fires below the threshold and not at it", () => {
  assert.ok("low_peers" in evaluateAlerts(snap({ peers: 2 }), []));
  assert.ok(!("low_peers" in evaluateAlerts(snap({ peers: 3 }), [])));
  // A node that does not report peers is not a node with no peers.
  assert.ok(!("low_peers" in evaluateAlerts(snap({ peers: null }), [])));
});

test("a stalled height fires once there are enough points to judge", () => {
  const now = Date.now();
  const history = [snap({ at: now - 600_000, height: 500 }), snap({ at: now - 300_000, height: 500 })];
  const active = evaluateAlerts(snap({ at: now, height: 500 }), history);
  assert.ok("stalled" in active);
  assert.match(active.stalled.message, /500/);
});

test("two points is not enough to call a stall", () => {
  const now = Date.now();
  const history = [snap({ at: now - 300_000, height: 500 })];
  assert.ok(!("stalled" in evaluateAlerts(snap({ at: now, height: 500 }), history)));
});

test("THE PORTED SUBTLETY: a stall clears the moment height moves, not minutes later", () => {
  // The current snapshot is included in the height comparison. Without that, a
  // node that just resumed still reads as stalled until the old equal-height rows
  // age out of the lookback window — so the alert would clear long after the
  // problem did.
  const now = Date.now();
  const history = [
    snap({ at: now - 600_000, height: 500 }),
    snap({ at: now - 300_000, height: 500 }),
    snap({ at: now - 60_000, height: 500 }),
  ];
  assert.ok(!("stalled" in evaluateAlerts(snap({ at: now, height: 501 }), history)));
});

test("history older than the stall window is ignored", () => {
  const now = Date.now();
  const history = [
    snap({ at: now - 86_400_000, height: 500 }),
    snap({ at: now - 86_000_000, height: 500 }),
  ];
  assert.ok(!("stalled" in evaluateAlerts(snap({ at: now, height: 500 }), history)));
});

test("a syncing node is flagged, because its numbers are correct but not current", () => {
  const active = evaluateAlerts(snap({ verificationProgress: 0.82 }), []);
  assert.ok("syncing" in active);
  assert.match(active.syncing.message, /82\.00%/);
  assert.ok(!("syncing" in evaluateAlerts(snap({ verificationProgress: 1 }), [])));
  assert.ok(!("syncing" in evaluateAlerts(snap({ verificationProgress: null }), [])));
});

test("height going backwards is caught", () => {
  const now = Date.now();
  const history = [snap({ at: now - 60_000, height: 3_000_010 })];
  const active = evaluateAlerts(snap({ at: now, height: 3_000_000 }), history);
  assert.ok("height_regressed" in active);
  assert.match(active.height_regressed.message, /10 block/);
  // Advancing normally is not a regression.
  assert.ok(!("height_regressed" in evaluateAlerts(snap({ at: now, height: 3_000_011 }), history)));
});

test("transitions distinguish newly-started from ongoing", () => {
  const active = evaluateAlerts(snap({ peers: 1 }), []);
  const first = diffAlerts([], active);
  assert.deepEqual(first.started.map((alert) => alert.id), ["low_peers"]);
  assert.deepEqual(first.cleared, []);

  // Same condition, second tick: nothing to announce.
  const second = diffAlerts(["low_peers"], active);
  assert.deepEqual(second.started, []);
  assert.deepEqual(second.cleared, []);

  // Condition gone: one resolution.
  const third = diffAlerts(["low_peers"], {});
  assert.deepEqual(third.started, []);
  assert.deepEqual(third.cleared.map((alert) => alert.id), ["low_peers"]);
  assert.match(third.cleared[0].message, /back above/);
});

/* ── route handlers ──────────────────────────────────────────────────────── */

/**
 * The route handlers take a standard `Request` and return a standard `Response`,
 * with no Next-specific APIs, which means they can be called directly here. So
 * these are not mock tests of a fake HTTP layer — they are the real handlers, the
 * real composition layer and the real RPC stack, exercised without a server.
 */

section("route handlers");

async function callRoute(handler, url, init) {
  const response = await handler(new Request(url, init));
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    assert.fail(`route did not return JSON: ${text.slice(0, 200)}`);
  }
  return { response, body };
}

await asyncTest("GET /api/chain returns the envelope and forbids HTTP caching", async () => {
  const { GET } = await import("../app/api/chain/route.ts");
  const { response, body } = await callRoute(GET, "http://localhost:3000/api/chain");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  // no-store is deliberate: the server cache does the request-saving, and an HTTP
  // cache would serve a body whose own meta.ageMs claims it is fresh.
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  assert.ok(body.data.height > 3_000_000);
  assert.equal(body.meta.mode, "demo");
  assert.ok(body.meta.via.includes("getblockchaininfo"));
});

await asyncTest("GET /api/height is the one-call ticker endpoint", async () => {
  const { GET } = await import("../app/api/height/route.ts");
  const { response, body } = await callRoute(GET, "http://localhost:3000/api/height");
  assert.equal(response.status, 200);
  assert.deepEqual(body.meta.via, ["getblockcount"]);
});

await asyncTest("GET /api/turnstile honours and clamps ?blocks", async () => {
  const { GET } = await import("../app/api/turnstile/route.ts");
  const small = await callRoute(GET, "http://localhost:3000/api/turnstile?blocks=4");
  assert.equal(small.body.data.requestedBlocks, 4);
  const huge = await callRoute(GET, "http://localhost:3000/api/turnstile?blocks=99999");
  assert.ok(huge.body.data.requestedBlocks <= 144);
  const junk = await callRoute(GET, "http://localhost:3000/api/turnstile?blocks=abc");
  assert.ok(junk.body.data.requestedBlocks > 0, "unparseable param falls back to the default");
});

await asyncTest("GET /api/capabilities publishes the probe results and leaks no token", async () => {
  const { GET } = await import("../app/api/capabilities/route.ts");
  const { response, body } = await callRoute(GET, "http://localhost:3000/api/capabilities");
  assert.equal(response.status, 200);
  assert.equal(body.data.implementation, "zebra");
  assert.ok(body.data.entries.length > 10);
  assert.equal(body.data.config.mode, "demo");
  assert.doesNotMatch(JSON.stringify(body), /password|apikey|api_key/i);
});

await asyncTest("GET /api/rpc describes the allowlist so the UI cannot offer more than the server accepts", async () => {
  const { GET } = await import("../app/api/rpc/route.ts");
  const { body } = await callRoute(GET, "http://localhost:3000/api/rpc");
  assert.equal(body.data.methods.length, CONSOLE_METHODS.length);
  assert.ok(body.data.recipes.length >= 3);
  for (const recipe of body.data.recipes) {
    for (const step of recipe.steps) {
      assert.ok(
        CONSOLE_METHODS.some((entry) => entry.method === step.method),
        `recipe "${recipe.id}" uses ${step.method}, which is not on the allowlist`,
      );
    }
  }
});

await asyncTest("POST /api/rpc executes an allowlisted call and shows the exact envelope sent", async () => {
  const { POST } = await import("../app/api/rpc/route.ts");
  resetRateLimits();
  const { response, body } = await callRoute(POST, "http://localhost:3000/api/rpc", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.4" },
    body: JSON.stringify({ method: "getblockcount", params: [] }),
  });
  assert.equal(response.status, 200);
  assert.equal(body.data.ok, true);
  assert.ok(body.data.result > 3_000_000);
  // The console's whole claim is "this is real JSON-RPC". That claim is the envelope.
  assert.equal(body.data.request.jsonrpc, "2.0");
  assert.equal(body.data.request.method, "getblockcount");
  assert.deepEqual(body.data.request.params, []);
  assert.match(String(body.data.request.id), /^zpulse-/);
});

await asyncTest("POST /api/rpc refuses a mutating method with 400, having contacted nothing", async () => {
  const { POST } = await import("../app/api/rpc/route.ts");
  resetRateLimits();
  for (const method of ["stop", "sendrawtransaction", "z_sendmany", "dumpprivkey"]) {
    const { response, body } = await callRoute(POST, "http://localhost:3000/api/rpc", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.5" },
      body: JSON.stringify({ method, params: [] }),
    });
    assert.equal(response.status, 400, `${method} should be a 400`);
    assert.equal(body.data, null);
    assert.match(body.error.message, /allowlist/);
  }
});

await withDemoProfile("zebra-legacy", async () => {
  await asyncTest("POST /api/rpc reports a node's -32601 as a result, not as a server failure", async () => {
    // The version-tell recipe depends on this: watching getmempoolinfo come back
    // -32601 is the demonstration, so it has to render where a result would, at
    // status 200. A 500 would read as "the console is broken" instead of "this
    // node is older than that method".
    const { POST } = await import("../app/api/rpc/route.ts");
    resetRateLimits();
    const { response, body } = await callRoute(POST, "http://localhost:3000/api/rpc", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.6" },
      body: JSON.stringify({ method: "getmempoolinfo", params: [] }),
    });
    assert.equal(response.status, 200);
    assert.equal(body.data.ok, false);
    assert.match(body.data.error.message, /does not support/i);
    assert.equal(body.data.request.method, "getmempoolinfo");
    assert.equal(body.meta.degraded, true);
  });
});

await asyncTest("POST /api/rpc rejects malformed JSON without consulting the allowlist", async () => {
  const { POST } = await import("../app/api/rpc/route.ts");
  resetRateLimits();
  const { response, body } = await callRoute(POST, "http://localhost:3000/api/rpc", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.7" },
    body: "{not json",
  });
  assert.equal(response.status, 400);
  assert.match(body.error.message, /valid JSON/);
});

await asyncTest("POST /api/rpc rate-limits, with a Retry-After a client can honour", async () => {
  const { POST } = await import("../app/api/rpc/route.ts");
  resetRateLimits();
  const send = () =>
    callRoute(POST, "http://localhost:3000/api/rpc", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.8" },
      body: JSON.stringify({ method: "getblockcount", params: [] }),
    });

  let limited = null;
  for (let i = 0; i < 40; i += 1) {
    const attempt = await send();
    if (attempt.response.status === 429) {
      limited = attempt;
      break;
    }
  }
  assert.ok(limited, "30 calls a minute should have triggered the per-client limit");
  assert.ok(Number(limited.response.headers.get("retry-after")) > 0);
  assert.match(limited.body.error.message, /per minute/);
});

await asyncTest("the poller tick is refused from a remote address when no secret is set", async () => {
  delete process.env.ZPULSE_CRON_SECRET;
  const { POST } = await import("../app/api/cron/poll/route.ts");
  const { response, body } = await callRoute(POST, "http://localhost:3000/api/cron/poll", {
    method: "POST",
    headers: { "x-forwarded-for": "203.0.113.9" },
  });
  assert.equal(response.status, 400);
  assert.match(body.error.message, /localhost/);
});

await asyncTest("the poller tick runs from localhost, records a row, and evaluates the rules", async () => {
  const { POST } = await import("../app/api/cron/poll/route.ts");
  const { historyStore } = await import("../lib/store/index.ts");
  await rmRaw(process.env.ZPULSE_HISTORY_PATH, { force: true });

  const { response, body } = await callRoute(POST, "http://localhost:3000/api/cron/poll", {
    method: "POST",
    headers: { "x-forwarded-for": "127.0.0.1" },
  });
  assert.equal(response.status, 200);
  assert.equal(body.data.snapshot.reachable, true);
  assert.ok(body.data.snapshot.height > 3_000_000);
  assert.ok(Array.isArray(body.data.snapshot.alerts));
  // No webhooks configured, so the delivery is log-only rather than pretended.
  for (const delivery of body.data.deliveries) assert.equal(delivery.logOnly, true);

  const rows = await historyStore().recent(10);
  assert.ok(rows.length >= 1, "the tick must have appended a row");
  assert.equal(rows[rows.length - 1].height, body.data.snapshot.height);
});

await asyncTest("a configured secret is required, and a wrong one is refused", async () => {
  process.env.ZPULSE_CRON_SECRET = "correct-horse-battery-staple";
  const { POST } = await import("../app/api/cron/poll/route.ts");

  const missing = await callRoute(POST, "http://localhost:3000/api/cron/poll", {
    method: "POST",
    headers: { "x-forwarded-for": "127.0.0.1" },
  });
  assert.equal(missing.response.status, 400, "a set secret must apply even on localhost");

  const wrong = await callRoute(POST, "http://localhost:3000/api/cron/poll", {
    method: "POST",
    headers: { authorization: "Bearer wrong-horse", "x-forwarded-for": "203.0.113.9" },
  });
  assert.equal(wrong.response.status, 400);

  const right = await callRoute(POST, "http://localhost:3000/api/cron/poll", {
    method: "POST",
    headers: {
      authorization: "Bearer correct-horse-battery-staple",
      "x-forwarded-for": "203.0.113.9",
    },
  });
  assert.equal(right.response.status, 200, "the right secret works from anywhere");
  delete process.env.ZPULSE_CRON_SECRET;
});

await asyncTest("GET /api/history returns the series, the live alerts and the store's honesty", async () => {
  const { GET } = await import("../app/api/history/route.ts");
  const { response, body } = await callRoute(GET, "http://localhost:3000/api/history?limit=50");
  assert.equal(response.status, 200);
  assert.ok(body.data.snapshots.length >= 1);
  assert.ok(Array.isArray(body.data.alerts));
  assert.equal(body.data.store.kind, "jsonl");
  assert.equal(body.data.store.durable, true);
  assert.ok(body.data.thresholds.minPeers > 0);
  assert.deepEqual(body.data.sinks, { discord: false, webhook: false });
});

await asyncTest("every route survives an unreachable node with an error envelope, not a crash", async () => {
  // The one case demo mode cannot cover, and the one the plan's verification
  // sequence calls for: point the app at a host that is not there. Each route must
  // return the envelope shape with degraded: true, so the UI has something to
  // render, and must NOT quietly fall back to demo data.
  const previousMode = process.env.ZCASH_RPC_MODE;
  const previousUrl = process.env.ZCASH_RPC_URL;
  process.env.ZCASH_RPC_MODE = "live";
  process.env.ZCASH_RPC_URL = "http://127.0.0.1:1/";
  process.env.ZCASH_RPC_TIMEOUT_MS = "300";

  const { clearCache: clear } = await import("../lib/cache.ts");
  const { resetCapabilityCache } = await import("../lib/rpc/capabilities.ts");
  clear();
  resetCapabilityCache();

  try {
    const routes = [
      ["chain", "../app/api/chain/route.ts"],
      ["height", "../app/api/height/route.ts"],
      ["pools", "../app/api/pools/route.ts"],
      ["node", "../app/api/node/route.ts"],
      ["upgrades", "../app/api/upgrades/route.ts"],
    ];
    for (const [name, path] of routes) {
      const { GET } = await import(path);
      const { response, body } = await callRoute(GET, `http://localhost:3000/api/${name}`);
      assert.ok(response.status === 200 || response.status >= 500, `${name}: unexpected ${response.status}`);
      assert.equal(body.meta.degraded, true, `${name} must report itself degraded`);
      assert.notEqual(body.meta.source, "demo", `${name} must NOT fall back to demo data`);
      assert.ok(body.meta.notes.length > 0, `${name} must say why`);
      // The endpoint is named by host only — never a URL that could carry a token.
      assert.doesNotMatch(JSON.stringify(body), /http:\/\//, `${name} leaked a URL`);
    }
  } finally {
    delete process.env.ZCASH_RPC_TIMEOUT_MS;
    if (previousUrl === undefined) delete process.env.ZCASH_RPC_URL;
    else process.env.ZCASH_RPC_URL = previousUrl;
    if (previousMode === undefined) delete process.env.ZCASH_RPC_MODE;
    else process.env.ZCASH_RPC_MODE = previousMode;
    clear();
    resetCapabilityCache();
  }
});

/* ── cookie auth: the thing that stops a default zebrad answering ────────── */

/**
 * Zebra 2.x ships `enable_cookie_auth = true`, so a freshly-built zebrad answers
 * HTTP 401 to an unauthenticated request. That is the likeliest reason following
 * the README against a real node fails, and it is not something demo mode can
 * surface — demo mode never opens a socket.
 *
 * So these tests stub `globalThis.fetch`, which is what the transport calls, and
 * inspect the request it was about to send. That verifies the half of cookie auth
 * that lives in this repo: reading the file, and encoding it the way Bitcoin Core
 * established and Zebra copied. The other half — that a real zebrad accepts what
 * we send — needs a real zebrad, and is flagged as unverified in the README.
 */

section("cookie auth");

let cookieFixtureCounter = 0;

/**
 * Write a cookie file, point the transport at a dead socket, and capture the
 * request it tries to make.
 *
 * Each call gets its own path on purpose. The client caches the encoded cookie
 * against the file's mtime, and filesystem mtime granularity is coarse enough that
 * two writes within the same millisecond can look unchanged — which would make one
 * test silently reuse the previous test's credential.
 */
async function captureCookieRequest(cookieContents) {
  cookieFixtureCounter += 1;
  const cookiePath = `${storeDir}/zebra-cookie-${cookieFixtureCounter}`;
  await mkdirRaw(storeDir, { recursive: true });
  await writeRaw(cookiePath, cookieContents);

  const previous = {
    mode: process.env.ZCASH_RPC_MODE,
    url: process.env.ZCASH_RPC_URL,
    cookie: process.env.ZCASH_RPC_COOKIE_FILE,
    fetch: globalThis.fetch,
  };
  process.env.ZCASH_RPC_MODE = "live";
  process.env.ZCASH_RPC_URL = "http://127.0.0.1:1/";
  process.env.ZCASH_RPC_COOKIE_FILE = cookiePath;

  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url, headers: init?.headers ?? {}, body: init?.body });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: "1", result: 42 }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const { rpcCall } = await import("../lib/rpc/client.ts");
    return { seen, result: await rpcCall("getblockcount"), cookiePath, error: null };
  } catch (err) {
    return { seen, result: null, cookiePath, error: err };
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.mode === undefined) delete process.env.ZCASH_RPC_MODE;
    else process.env.ZCASH_RPC_MODE = previous.mode;
    if (previous.url === undefined) delete process.env.ZCASH_RPC_URL;
    else process.env.ZCASH_RPC_URL = previous.url;
    if (previous.cookie === undefined) delete process.env.ZCASH_RPC_COOKIE_FILE;
    else process.env.ZCASH_RPC_COOKIE_FILE = previous.cookie;
    await rmRaw(cookiePath, { force: true });
  }
}

await asyncTest("a cookie file becomes an Authorization: Basic header, encoded verbatim", async () => {
  // Zebra writes one line: `__cookie__:<secret>`. Those contents *are* the
  // user:password pair, so they are base64'd whole rather than split and
  // reassembled — splitting would corrupt any secret containing a colon.
  const secret = "sHK9pQ2vX7mR4tL0";
  const { seen, result, error } = await captureCookieRequest(`__cookie__:${secret}\n`);
  assert.equal(error, null, `unexpected failure: ${error?.message}`);
  assert.equal(result, 42);
  assert.equal(seen.length, 1, "one call, no retry");
  assert.equal(
    seen[0].headers.Authorization,
    `Basic ${Buffer.from(`__cookie__:${secret}`).toString("base64")}`,
  );
  // The trailing newline must not survive into the credential — Zebra's file has one.
  const decoded = Buffer.from(seen[0].headers.Authorization.slice(6), "base64").toString("utf8");
  assert.equal(decoded, `__cookie__:${secret}`);
});

await asyncTest("explicit credentials win over a cookie file", async () => {
  // A zcashd, or a basic-auth proxy in front of zebrad, wants what you configured —
  // not whatever cookie happens to be sitting in a cache directory.
  const previousUser = process.env.ZCASH_RPC_USER;
  const previousPassword = process.env.ZCASH_RPC_PASSWORD;
  process.env.ZCASH_RPC_USER = "alice";
  process.env.ZCASH_RPC_PASSWORD = "hunter2";
  try {
    const { seen, error } = await captureCookieRequest("__cookie__:ignored-secret\n");
    assert.equal(error, null, `unexpected failure: ${error?.message}`);
    assert.equal(
      seen[0].headers.Authorization,
      `Basic ${Buffer.from("alice:hunter2").toString("base64")}`,
    );
    const decoded = Buffer.from(seen[0].headers.Authorization.slice(6), "base64").toString("utf8");
    assert.doesNotMatch(decoded, /ignored-secret/, "the cookie must not be sent");
  } finally {
    if (previousUser === undefined) delete process.env.ZCASH_RPC_USER;
    else process.env.ZCASH_RPC_USER = previousUser;
    if (previousPassword === undefined) delete process.env.ZCASH_RPC_PASSWORD;
    else process.env.ZCASH_RPC_PASSWORD = previousPassword;
  }
});

await asyncTest("an unreadable cookie file fails loudly, naming the path and nothing else", async () => {
  const previousMode = process.env.ZCASH_RPC_MODE;
  const previousUrl = process.env.ZCASH_RPC_URL;
  const previousCookie = process.env.ZCASH_RPC_COOKIE_FILE;
  const missing = `${storeDir}/definitely-not-here/.cookie`;
  process.env.ZCASH_RPC_MODE = "live";
  process.env.ZCASH_RPC_URL = "http://127.0.0.1:1/";
  process.env.ZCASH_RPC_COOKIE_FILE = missing;

  try {
    const { rpcCall } = await import("../lib/rpc/client.ts");
    const { RpcConfigError } = await import("../lib/rpc/errors.ts");
    // Quietly sending no Authorization header would turn this into a 401 from the
    // node — a misconfiguration wearing a node problem's clothes. It has to be a
    // config error, and it has to name the path, because a typo is the likely cause.
    await assert.rejects(
      () => rpcCall("getblockcount"),
      (err) => {
        assert.ok(
          err instanceof RpcConfigError,
          `expected RpcConfigError, got ${err?.constructor?.name}: ${err?.message}`,
        );
        assert.ok(err.message.includes(missing), `must name the path: ${err.message}`);
        assert.match(err.message, /enable_cookie_auth/, "and must say how to opt out");
        return true;
      },
    );
  } finally {
    if (previousMode === undefined) delete process.env.ZCASH_RPC_MODE;
    else process.env.ZCASH_RPC_MODE = previousMode;
    if (previousUrl === undefined) delete process.env.ZCASH_RPC_URL;
    else process.env.ZCASH_RPC_URL = previousUrl;
    if (previousCookie === undefined) delete process.env.ZCASH_RPC_COOKIE_FILE;
    else process.env.ZCASH_RPC_COOKIE_FILE = previousCookie;
  }
});

await asyncTest("a file that is not a cookie file is rejected rather than sent", async () => {
  // Pointing this at the wrong file is easy. If it does not look like Zebra's
  // cookie, say so here instead of base64ing a stray config file into a header —
  // and say it without quoting the file back, since the next wrong file might be
  // a real secret.
  const { seen, error } = await captureCookieRequest("this is not a credential\n");
  assert.equal(seen.length, 0, "nothing should have been sent");
  assert.ok(error, "expected a rejection");
  assert.match(error.message, /user:secret/);
  assert.doesNotMatch(error.message, /this is not a credential/, "must not echo the contents");
});

await asyncTest("the endpoint description names the auth style without leaking the token", async () => {
  // Hosted providers put the access token in the URL *path*, which is why only the
  // host is ever surfaced. This also gives /node something honest to show about how
  // it is authenticating, which is otherwise invisible.
  const { describeEndpoint } = await import("../lib/rpc/client.ts");
  const base = {
    mode: "live",
    url: "https://node.example.com/AbCdEfSecretToken123",
    timeoutMs: 1,
    jsonrpcVersion: "2.0",
  };
  const cases = [
    [{ user: "", password: "", cookieFile: "" }, "node.example.com (token in URL)"],
    [{ user: "", password: "", cookieFile: "/var/cache/zebra/.cookie" }, "node.example.com (cookie auth)"],
    [{ user: "alice", password: "hunter2", cookieFile: "" }, "node.example.com (basic auth)"],
  ];
  for (const [auth, expected] of cases) {
    const rendered = describeEndpoint({ ...base, ...auth });
    assert.equal(rendered, expected);
    assert.doesNotMatch(rendered, /AbCdEfSecretToken123/, "the URL path is where the token lives");
    assert.doesNotMatch(rendered, /hunter2|\.cookie/, "credentials are not part of a description");
  }
});

await rmRaw(storeDir, { recursive: true, force: true });

/* ── report ──────────────────────────────────────────────────────────────── */

process.stdout.write(`\n${"─".repeat(64)}\n`);
process.stdout.write(`${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.stdout.write("\nFailures:\n");
  for (const failure of failures) {
    process.stdout.write(`  ${failure.name}\n    ${failure.message}\n`);
  }
  process.exit(1);
}
process.stdout.write("Analysis layer and data layer verified.\n");

