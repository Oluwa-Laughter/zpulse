/**
 * Stable colour identity for value pools.
 *
 * Assigned by pool id, not by array position, so Orchard is the same violet in
 * the supply bar, the turnstile chart and the privacy strip — and stays that
 * colour when a new pool appears and shifts the ordering.
 *
 * Pools we do not recognise get a distinct colour rather than being hidden or
 * folded into "other". Ironwood activated in July 2026 and future Tachyon-era
 * pools will arrive the same way: the node reports an id we have never seen, and
 * the UI must still draw it. The `unknown` colour is deliberately off-palette so
 * an unrecognised pool is visually obvious.
 */

const POOL_COLORS: Record<string, string> = {
  sprout: "var(--z-pool-sprout)",
  sapling: "var(--z-pool-sapling)",
  orchard: "var(--z-pool-orchard)",
  ironwood: "var(--z-pool-ironwood)",
  lockbox: "var(--z-pool-lockbox)",
  deferred: "var(--z-pool-lockbox)",
  transparent: "var(--z-pool-transparent)",
};

export function poolColor(id: string): string {
  return POOL_COLORS[id.toLowerCase()] ?? "var(--z-pool-unknown)";
}

/** Colours for transaction classes on the privacy strip. */
export const TX_CLASS_COLORS: Record<string, string> = {
  coinbase: "var(--z-pool-lockbox)",
  transparent: "var(--z-pool-transparent)",
  shielding: "var(--z-pool-sapling)",
  deshielding: "var(--z-warn)",
  "fully-shielded": "var(--z-pool-orchard)",
  mixed: "var(--z-pool-sprout)",
};

/** Draw order for the strip, so the stack reads transparent → fully shielded. */
export const TX_CLASS_ORDER = [
  "coinbase",
  "transparent",
  "shielding",
  "deshielding",
  "mixed",
  "fully-shielded",
] as const;
