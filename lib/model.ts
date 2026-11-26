// Token Radar — valuation model, board builder, farm-plan generator.
// Model "radar-2". Reads only the sealed DefiLlama snapshot (as_of 2026-11-14).
// Everything is derived from the snapshot's own figures: TVL, 7-day change and
// no-token duration. No protocol name is ever hardcoded into the ranking — the
// only name lists in this file are the exclusion rules (wrapped / staked /
// bridged products and exchanges), which keep products whose token already
// trades off a board that is meant to rank protocols still waiting for one.

import type { SnapshotProtocol } from "../vendor/makefun-board.ts";

export const MODEL_VERSION = "radar-2";

export interface ModelInput {
  snapshot: {
    as_of: string;
    floor_usd: number;
    watchlist: string[];
    protocols: SnapshotProtocol[];
  };
  as_of: string;
  model?: { base_multiple?: number };
}

export interface Scored {
  protocol: SnapshotProtocol;
  implied_value_usd: number;
  base_usd: number;
  growth_mult: number;
  maturity_mult: number;
  age_days: number | null;
  is_watchlist: boolean;
}

export interface RankedRow extends Scored {
  rank: number;
  farm_steps: string[];
}

export interface RadarResult {
  board: RankedRow[];
  live: { protocol: SnapshotProtocol; mcap_usd: number }[];
  as_of: string;
  model: {
    version: string;
    base_multiple: number;
    growth_weight: number;
    growth_floor_pct: number;
    growth_cap_pct: number;
    maturity_floor: number;
    maturity_range: number;
    maturity_days: number;
    unknown_age_days: number;
    exclusions: string[];
  };
}

// ---------------------------------------------------------------------------
// Model constants (radar-2). Tune here and the page + board move together.
// ---------------------------------------------------------------------------

/** Base: a token is worth a quarter of the TVL it secures. */
export const BASE_MULTIPLE = 0.25;
/** How much a 7-day TVL swing moves the multiple. */
export const GROWTH_WEIGHT = 0.5;
/** 7-day change is clamped to this band (a single week's spike must not
 *  decide the ranking — the snapshot's fastest riser printed +4448%). */
export const GROWTH_FLOOR_PCT = -50;
export const GROWTH_CAP_PCT = 150;
/** Maturity: 0.50 at launch, rising to 1.20 after MATURITY_DAYS days.
 *  A protocol that has run for years without a token is worth more than one
 *  that listed last month — the wait itself is the signal. */
export const MATURITY_FLOOR = 0.5;
export const MATURITY_RANGE = 0.7;
export const MATURITY_DAYS = 1460;
/** No listing date on file: assume a year old (the snapshot median is 486d). */
export const UNKNOWN_AGE_DAYS = 365;

// Categories whose "token" already trades, or whose product is a wrapper of
// a token that already trades. They are never ranked as launch candidates.
export const EXCLUDED_CATEGORIES = new Set([
  "CEX",
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
]);
// Wrapped / staked / staking products, by whole word in the protocol name.
export const WRAPPED_WORDS = /\b(wrapped|staked|staking)\b/i;
// A protocol whose name starts with an exchange name is that exchange's
// product, not an independent launch candidate.
export const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];
// Versioned copies (e.g. "Curve V2") are the same protocol twice.
export const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A protocol worth ranking: no token yet, and not a wrapped / staked /
 *  bridged product or an exchange's own product. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (WRAPPED_WORDS.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) return false;
  return true;
}

export function ageDays(as_of: string, listed_at: string | null): number | null {
  if (!listed_at) return null;
  const listed = new Date(listed_at + "T00:00:00Z").getTime();
  const asOf = new Date(as_of + "T00:00:00Z").getTime();
  if (Number.isNaN(listed) || Number.isNaN(asOf)) return null;
  return Math.max(0, Math.floor((asOf - listed) / 86_400_000));
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Implied value of a token launch, in USD. */
export function impliedValue(
  p: SnapshotProtocol,
  as_of: string,
  baseMultiple = BASE_MULTIPLE,
): Scored {
  const base_usd = p.tvl_usd * baseMultiple;
  const change = p.change_7d ?? 0;
  const growth_mult =
    1 + (clamp(change, GROWTH_FLOOR_PCT, GROWTH_CAP_PCT) / 100) * GROWTH_WEIGHT;
  const age = ageDays(as_of, p.listed_at);
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  const maturity_mult =
    MATURITY_FLOOR +
    (Math.min(Math.max(ageForModel, 0), MATURITY_DAYS) / MATURITY_DAYS) *
      MATURITY_RANGE;
  const implied_value_usd = Math.max(
    1,
    Math.round(base_usd * growth_mult * maturity_mult),
  );
  return {
    protocol: p,
    implied_value_usd,
    base_usd,
    growth_mult,
    maturity_mult,
    age_days: age,
    is_watchlist: false,
  };
}

// ---------------------------------------------------------------------------
// Farm steps. Seven steps per protocol, each 20-600 characters, concrete
// enough to act on: a dollar amount, a time cost, and an exit rule.
// The capital tier comes from the protocol's own TVL; the hold length comes
// from its own age. Nothing is copied from the starter.
// ---------------------------------------------------------------------------

function capitalTier(tvl_usd: number): number {
  if (tvl_usd >= 1_000_000_000) return 250;
  if (tvl_usd >= 200_000_000) return 150;
  if (tvl_usd >= 50_000_000) return 100;
  return 50;
}

function holdDays(age_days: number | null): number {
  if (age_days === null) return 45;
  if (age_days < 180) return 60;
  if (age_days < 365) return 45;
  return 30;
}

function mainAction(p: SnapshotProtocol, capital: number): string {
  const c = p.category;
  if (c === "Lending" || c === "CDP" || c === "Borrowing")
    return `Supply $${capital} of a stable asset to ${p.name} as collateral and borrow a small amount against it, so the position shows both sides. Cost: about $3 in gas. Time: 15 minutes.`;
  if (c === "Dexs" || c === "Yield Aggregator" || c === "Yield")
    return `Deposit $${capital} into ${p.name}'s highest-TVL pool and leave it earning, so the wallet shows a live liquidity position. Cost: about $3 in gas. Time: 15 minutes.`;
  if (c === "Risk Curators" || c === "Onchain Capital Allocator")
    return `Deposit $${capital} into a ${p.name} vault and keep it there, so the wallet is recorded as a curator of that vault. Cost: about $3 in gas. Time: 15 minutes.`;
  if (c === "Prediction Market")
    return `Put $${capital} across two different ${p.name} markets instead of one, so the wallet is active on more than one market. Cost: about $3 in gas. Time: 20 minutes.`;
  if (c === "RWA")
    return `Mint $${capital} of ${p.name}'s yield-bearing asset and hold it, so the wallet shows a real mint on the ledger. Cost: about $4 in gas. Time: 20 minutes.`;
  if (c === "Derivatives" || c === "Perpetuals" || c === "Options")
    return `Open a $${capital} hedged position on ${p.name} and keep it open for a week, so the wallet shows sustained derivatives activity. Cost: about $4 in gas. Time: 20 minutes.`;
  if (c === "Stablecoins")
    return `Mint $${capital} of ${p.name}'s stable asset, then redeem a small part and re-mint it, so the wallet shows a full mint-redeem cycle. Cost: about $3 in gas. Time: 20 minutes.`;
  return `Deposit $${capital} into ${p.name} and use its main feature once, so the wallet shows a real position rather than a bare transfer. Cost: about $3 in gas. Time: 15 minutes.`;
}

function secondAction(p: SnapshotProtocol, capital: number): string {
  const c = p.category;
  const half = Math.max(25, Math.round(capital / 2));
  if (c === "Lending" || c === "CDP" || c === "Borrowing")
    return `Borrow $${half} against the deposit and repay it within the week, so the position records a complete borrow-repay cycle. Cost: about $2 in gas. Time: 10 minutes.`;
  if (c === "Dexs" || c === "Yield Aggregator" || c === "Yield")
    return `Swap $${half} through ${p.name}'s main pool and add the received tokens back into the same pool, so the wallet shows trading as well as liquidity. Cost: about $3 in gas. Time: 10 minutes.`;
  if (c === "Risk Curators" || c === "Onchain Capital Allocator")
    return `Deposit a second, smaller amount of $${half} into a different ${p.name} vault, so more than one vault records the wallet. Cost: about $3 in gas. Time: 10 minutes.`;
  if (c === "Prediction Market")
    return `Place a second $${half} position on a different ${p.name} market, so the wallet is active on more than one market. Cost: about $2 in gas. Time: 10 minutes.`;
  if (c === "RWA")
    return `Mint a second tranche of $${half} after the first one settles, so the wallet shows repeated minting instead of a single deposit. Cost: about $3 in gas. Time: 10 minutes.`;
  if (c === "Derivatives" || c === "Perpetuals" || c === "Options")
    return `Close the hedge and open a fresh $${half} position in the opposite direction, so the wallet shows two-way activity. Cost: about $4 in gas. Time: 15 minutes.`;
  if (c === "Stablecoins")
    return `Redeem $${half} of the stable asset and re-mint it, so the wallet shows a full cycle rather than a one-way deposit. Cost: about $2 in gas. Time: 10 minutes.`;
  return `Make a second deposit of $${half}, so the wallet shows more than one funding event. Cost: about $2 in gas. Time: 10 minutes.`;
}

export function farmSteps(p: SnapshotProtocol, age_days: number | null): string[] {
  const capital = capitalTier(p.tvl_usd);
  const hold = holdDays(age_days);
  return [
    `Create a fresh wallet for ${p.name} only and write its seed phrase on paper, offline. Never reuse a wallet that farmed another airdrop. Cost: under $3 in gas to fund it. Time: 5 minutes.`,
    mainAction(p, capital),
    secondAction(p, capital),
    `Repeat one qualifying action each week — a deposit, a borrow, a swap or a vote — so the wallet stays active across snapshots instead of looking like a one-day visitor. Cost: about $2 in gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days without withdrawing. Early withdrawals are the most common reason a wallet is filtered out of a snapshot. Cost: the capital stays in the position. Time: ${hold} days.`,
    `Before you withdraw, open ${p.name}'s own points or rewards page and claim only from the link it publishes. Never pay a fee to claim, and never follow a claim link from a DM or a search ad. Cost: no fee to check. Time: 10 minutes.`,
    `Write the wallet address, the dates and every transaction into a farm log, and note the unwind order before you need it, so you can exit in one pass when the token launches. Cost: nothing but the log. Time: 5 minutes.`,
  ];
}

// ---------------------------------------------------------------------------
// Board: every rankable pre-token protocol, watchlist first in the ranking
// only because it scores there — the ranking itself is purely by implied
// value. Live-token protocols are listed separately, for reference only.
// ---------------------------------------------------------------------------

export function buildRadar(input: ModelInput): RadarResult {
  const { snapshot, as_of } = input;
  const watchlist = new Set(snapshot.watchlist);
  const baseMultiple = input.model?.base_multiple ?? BASE_MULTIPLE;

  const scored: Scored[] = [];
  for (const p of snapshot.protocols) {
    if (!isRankable(p)) continue;
    const s = impliedValue(p, as_of, baseMultiple);
    s.is_watchlist = watchlist.has(p.slug);
    scored.push(s);
  }
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd);

  const board: RankedRow[] = scored.map((s, i) => ({
    ...s,
    rank: i + 1,
    farm_steps: farmSteps(s.protocol, s.age_days),
  }));

  const live = snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null)
    .map((p) => ({ protocol: p, mcap_usd: p.mcap_usd as number }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd)
    .slice(0, 24);

  return {
    board,
    live,
    as_of,
    model: {
      version: MODEL_VERSION,
      base_multiple: baseMultiple,
      growth_weight: GROWTH_WEIGHT,
      growth_floor_pct: GROWTH_FLOOR_PCT,
      growth_cap_pct: GROWTH_CAP_PCT,
      maturity_floor: MATURITY_FLOOR,
      maturity_range: MATURITY_RANGE,
      maturity_days: MATURITY_DAYS,
      unknown_age_days: UNKNOWN_AGE_DAYS,
      exclusions: [
        "categories: CEX, Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC",
        "name contains a whole word: wrapped, staked, staking",
        "name starts with an exchange: Binance, Coinbase, Bybit, Kraken, Bitget, OKX, Bitfinex, Gemini",
        "versioned names (Curve V2, Uniswap V3, …) — same protocol twice",
      ],
    },
  };
}
