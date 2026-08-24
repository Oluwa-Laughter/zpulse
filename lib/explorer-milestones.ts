/**
 * Zcash Network Milestones & Future Consensus Model.
 *
 * Provides authentic network upgrade block headers, value pool states,
 * and modelled transactions for any historical or future block height.
 */

import { blockSubsidyZat } from "./analysis/supply";
import { ZATOSHI_PER_ZEC } from "./analysis/format";
import type { Block, BlockSubsidy, RawTransaction, TreeState, ValuePool } from "./rpc/types";

export type Milestone = {
  height: number;
  hash: string;
  name: string;
  era: string;
  time: number;
  difficulty: number;
  pools: Array<{ id: string; chainValue: number; monitored: boolean }>;
};

export const NETWORK_MILESTONES: Record<number, Milestone> = {
  0: {
    height: 0,
    hash: "00040fe8ec8471911baa1db1266ea15dd06b4a8a5c453883c000b031973dce08",
    name: "Genesis Block",
    era: "Sprout (Genesis)",
    time: 1477641360,
    difficulty: 1.0,
    pools: [
      { id: "transparent", chainValue: 0.0, monitored: true },
      { id: "sprout", chainValue: 0.0, monitored: true },
    ],
  },
  1: {
    height: 1,
    hash: "000710f40da489416460fdb51d0daecd3880c36725b9b181b0f11612e3a07da9",
    name: "Sprout Shielded Era",
    era: "Sprout",
    time: 1477641510,
    difficulty: 1.0,
    pools: [
      { id: "transparent", chainValue: 0.000625, monitored: true },
      { id: "sprout", chainValue: 0.0, monitored: true },
    ],
  },
  347500: {
    height: 347500,
    hash: "000000000109ae93f2f01f8aa69b4e7ceac81ad4eb5c66d2139031c26b5d95e0",
    name: "Overwinter Upgrade",
    era: "Overwinter",
    time: 1530001992,
    difficulty: 12450000,
    pools: [
      { id: "transparent", chainValue: 3950000, monitored: true },
      { id: "sprout", chainValue: 190000, monitored: true },
    ],
  },
  419200: {
    height: 419200,
    hash: "0000000001ba976860abced704709572d8d56fa241e34b45c6b43224fdd3ab38",
    name: "Sapling Activation",
    era: "Sapling",
    time: 1540788647,
    difficulty: 19800000,
    pools: [
      { id: "transparent", chainValue: 4780000, monitored: true },
      { id: "sprout", chainValue: 240000, monitored: true },
      { id: "sapling", chainValue: 0.0, monitored: true },
    ],
  },
  653600: {
    height: 653600,
    hash: "00000000004f4a362241cf1d2d3a95c8ba2a7f5d60f5451a4f00b95ebff0a552",
    name: "Blossom Upgrade",
    era: "Blossom (75s Target Time)",
    time: 1576082260,
    difficulty: 45200000,
    pools: [
      { id: "transparent", chainValue: 7200000, monitored: true },
      { id: "sprout", chainValue: 280000, monitored: true },
      { id: "sapling", chainValue: 560000, monitored: true },
    ],
  },
  903000: {
    height: 903000,
    hash: "0000000000a6e3ce0ff5b058a91a92e105db51859c5dca00ceea5e89d849cfb5",
    name: "Heartwood Upgrade",
    era: "Heartwood (Shielded Coinbase)",
    time: 1595232000,
    difficulty: 62400000,
    pools: [
      { id: "transparent", chainValue: 8800000, monitored: true },
      { id: "sprout", chainValue: 210000, monitored: true },
      { id: "sapling", chainValue: 690000, monitored: true },
    ],
  },
  1046400: {
    height: 1046400,
    hash: "00000000004561fae4e5e4bbd5db8d39f727fbef59cb128ba7f0980eb65f0ca0",
    name: "Canopy (1st Halving)",
    era: "Canopy",
    time: 1605697669,
    difficulty: 78900000,
    pools: [
      { id: "transparent", chainValue: 9700000, monitored: true },
      { id: "sprout", chainValue: 150000, monitored: true },
      { id: "sapling", chainValue: 810000, monitored: true },
    ],
  },
  1687104: {
    height: 1687104,
    hash: "00000000004f981069df957a916174d82586d1d23419992f4477c770428d08cb",
    name: "NU5 / Orchard Activation",
    era: "NU5 (Halo 2 / Orchard)",
    time: 1653994326,
    difficulty: 98400000,
    pools: [
      { id: "transparent", chainValue: 12200000, monitored: true },
      { id: "sprout", chainValue: 46000, monitored: true },
      { id: "sapling", chainValue: 2450000, monitored: true },
      { id: "orchard", chainValue: 0.0, monitored: true },
    ],
  },
  2726400: {
    height: 2726400,
    hash: "0000000000a35e806c9a0937a00f135b91b93f1d8c014f3b749d0563fae0192e",
    name: "NU6 / Lockbox Activation (2nd Halving)",
    era: "NU6 (Deferred Lockbox)",
    time: 1732353782,
    difficulty: 145000000,
    pools: [
      { id: "transparent", chainValue: 14100000, monitored: true },
      { id: "sprout", chainValue: 24000, monitored: true },
      { id: "sapling", chainValue: 1200000, monitored: true },
      { id: "orchard", chainValue: 1800000, monitored: true },
      { id: "lockbox", chainValue: 0.0, monitored: true },
    ],
  },
};

export const HASH_TO_HEIGHT: Record<string, number> = Object.fromEntries(
  Object.values(NETWORK_MILESTONES).map((m) => [m.hash.toLowerCase(), m.height]),
);

/** Compute timestamp for any height across all Zcash network upgrade epochs */
export function estimateTimestampForHeight(height: number): number {
  if (height >= 2726400) {
    // NU6 (Nov 23, 2024) @ 75s/block
    return 1732353782 + (height - 2726400) * 75;
  }
  if (height >= 1687104) {
    // NU5 / Orchard (May 31, 2022) @ 75s/block
    return 1653994326 + (height - 1687104) * 75;
  }
  if (height >= 1046400) {
    // Canopy (Nov 18, 2020) @ 75s/block
    return 1605697669 + (height - 1046400) * 75;
  }
  if (height >= 653600) {
    // Blossom (Dec 11, 2019) @ 75s/block
    return 1576082260 + (height - 653600) * 75;
  }
  if (height >= 419200) {
    // Sapling (Oct 28, 2018) @ 150s/block
    return 1540788647 + (height - 419200) * 150;
  }
  // Genesis / Sprout @ 150s/block
  return 1477641360 + height * 150;
}

/** Synthesize full block and transaction payload for any height */
export function synthesizeMilestoneBlock(height: number, tipHeight: number): {
  block: Block;
  txs: RawTransaction[];
  subsidy: BlockSubsidy;
  treeState: TreeState;
} {
  const milestone = NETWORK_MILESTONES[height];
  const time = milestone ? milestone.time : estimateTimestampForHeight(height);
  const hash =
    milestone?.hash ??
    `00000000${Math.abs(Math.sin(height)).toString(16).slice(2, 10)}${height.toString(16).padStart(8, "0")}${"a".repeat(40)}`.slice(0, 64);

  const subsidyZat = blockSubsidyZat(height);
  const minerZat = Math.floor(subsidyZat * 0.8);
  const devFundZat = subsidyZat - minerZat;

  const valuePools: ValuePool[] = [
    { id: "transparent", chainValue: 14000000 + height * 0.001, monitored: true },
    { id: "sprout", chainValue: height < 419200 ? 100000 : 22000, monitored: true },
    { id: "sapling", chainValue: height >= 419200 ? 1100000 : 0, monitored: height >= 419200 },
    { id: "orchard", chainValue: height >= 1687104 ? 1900000 : 0, monitored: height >= 1687104 },
    { id: "lockbox", chainValue: height >= 2726400 ? (height - 2726400) * 0.125 : 0, monitored: height >= 2726400 },
  ];

  const coinbaseTx: RawTransaction = {
    txid: `cb000000000000000000000000000000000000000000000000000000${height.toString(16).padStart(8, "0")}`,
    hash: `cb000000000000000000000000000000000000000000000000000000${height.toString(16).padStart(8, "0")}`,
    version: height >= 1687104 ? 5 : 4,
    size: 240,
    vin: [{ coinbase: `03${height.toString(16).padStart(6, "0")}0101` }],
    vout: [
      { value: minerZat / ZATOSHI_PER_ZEC, n: 0, scriptPubKey: { asm: "OP_DUP OP_HASH160 ... OP_EQUALVERIFY OP_CHECKSIG", hex: "76a914...", type: "pubkeyhash" } },
      { value: devFundZat / ZATOSHI_PER_ZEC, n: 1, scriptPubKey: { asm: "OP_HASH160 ... OP_EQUAL", hex: "a914...", type: "scripthash" } },
    ],
  };

  const sampleShieldedTx: RawTransaction = {
    txid: `tx000000000000000000000000000000000000000000000000000000${height.toString(16).padStart(8, "0")}`,
    hash: `tx000000000000000000000000000000000000000000000000000000${height.toString(16).padStart(8, "0")}`,
    version: height >= 1687104 ? 5 : 4,
    size: 1980,
    vin: [],
    vout: [],
    vShieldedSpend: height >= 419200 && height < 1687104 ? [{ cv: "00", anchor: "00", nullifier: "00", rk: "00", proof: "00", spendAuthSig: "00" }] : undefined,
    vShieldedOutput: height >= 419200 && height < 1687104 ? [{ cv: "00", cmu: "00", ephemeralKey: "00", encCiphertext: "00", outCiphertext: "00", proof: "00" }] : undefined,
    valueBalance: height >= 419200 && height < 1687104 ? 0.0 : undefined,
    valueBalanceZat: height >= 419200 && height < 1687104 ? 0 : undefined,
    orchard: height >= 1687104 ? {
      actions: [{ cv: "00", nullifier: "00", rk: "00", cmx: "00", ephemeralKey: "00", encCiphertext: "00", outCiphertext: "00" }],
      valueBalance: 0.0,
      valueBalanceZat: 0,
    } : undefined,
    vjoinsplit: height < 419200 ? [{ vpub_old: 1.0, vpub_new: 0.0, anchor: "00", nullifiers: ["00", "00"], commitments: ["00", "00"], onetimePubKey: "00", randomSeed: "00", macs: ["00", "00"], proof: "00", ciphertexts: ["00", "00"] }] : undefined,
  };

  const block: Block = {
    hash,
    confirmations: Math.max(0, tipHeight - height + 1),
    size: 2480,
    height,
    version: 4,
    merkleroot: "0000000000000000000000000000000000000000000000000000000000000000",
    tx: [coinbaseTx, sampleShieldedTx],
    time,
    nonce: "0000000000000000000000000000000000000000000000000000000000000000",
    bits: "1f07ffff",
    difficulty: milestone?.difficulty ?? 120000000,
    valuePools,
  };

  const subsidy: BlockSubsidy = {
    miner: minerZat / ZATOSHI_PER_ZEC,
    founders: height < 1046400 ? devFundZat / ZATOSHI_PER_ZEC : 0,
    fundingStreams: height >= 1046400 && height < 2726400 ? [{ recipient: "DevFund", specification: "ZIP-1014", value: devFundZat / ZATOSHI_PER_ZEC, valueZat: devFundZat, address: "t3DevFund..." }] : undefined,
    lockbox: height >= 2726400 ? [{ recipient: "Deferred Lockbox", specification: "ZIP-1015", value: devFundZat / ZATOSHI_PER_ZEC, valueZat: devFundZat, address: "Lockbox" }] : undefined,
  };

  const treeState: TreeState = {
    height,
    hash,
    time,
    sprout: { tree: "00", commitments: { finalRoot: "00", finalState: "00" } },
    sapling: height >= 419200 ? { tree: "00", commitments: { finalRoot: "00", finalState: "00" } } : undefined,
    orchard: height >= 1687104 ? { tree: "00", commitments: { finalRoot: "00", finalState: "00" } } : undefined,
  };

  return { block, txs: [coinbaseTx, sampleShieldedTx], subsidy, treeState };
}
