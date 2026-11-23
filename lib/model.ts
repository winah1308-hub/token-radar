// Token Launch Radar — value model, board builder, farm plans.
//
// The model is fitted from the snapshot itself, never from a hand-kept list
// of names. It learns how the market values live-token protocols and then
// asks: if this pre-token protocol's record stayed exactly as it is, what
// would a token be worth on the same terms?
//
//   1. Fit: on the live-token protocols (a positive market cap recorded and
//      a positive TVL, exchange tokens left out — an exchange's token is
//      not a protocol token), regress log10(market cap) on log10(TVL).
//      Wrapped, bridged and staked products are left out of the fit too,
//      including stablecoin wrappers, cross-chain bridges and BTC
//      anchors (a wrapped stablecoin's market cap is the stablecoin,
//      a BTC anchor's is BTC), plus the restaking slug b14g on its own:
//      their recorded market cap is not a protocol token priced against
//      their TVL (a bridge's TVL is other chains' assets, a liquid-staking
//      token's market cap is the staked asset, not the protocol), so
//      learning from them would price the board on the wrong terms —
//      the old fit's Canonical Bridge adjustment sat at its +0.30 cap on
//      the back of those entries, which is also why bridges topped the
//      board. Leaving them out costs nothing in validation: the
//      leave-one-out median error is unchanged within noise.
//      A slope below 1 means big protocols trade at a smaller multiple of
//      TVL than small ones; the snapshot's own data says so, so the model
//      says so too. Each category with at least five live members gets a
//      shrunken median-residual adjustment (capped at +/-0.30 in log10),
//      so e.g. a lending protocol is not priced like a bridge.
//   2. Growth: the protocol's 7-day TVL change, clamped to [-50, +100]%
//      and weighted at 0.45, so a fast-growing protocol scores higher and
//      a shrinking one scores lower, without one wild week dominating.
//   3. Maturity: how long the protocol has run with no token recorded.
//      age = as_of - listed_at; unknown age is neutral (half the range).
//      Multiplier runs 0.80 (brand new) to 1.00 (three years or older).
//
//   implied = 10^(a + b*log10(TVL) + categoryAdj) x growthMult x maturityMult
//
// Validation: leave-one-out over the live-token set — refit the whole
// model without each protocol, predict it, and record the median absolute
// log10 error. It is large (the market is noisy); the dashboard and the
// README state it plainly. The board is a ranking aid, not a price
// forecast, and it never predicts whether or when a token is issued.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface LiveFit {
  /** Intercept of log10(mcap) = a + b * log10(tvl). */
  intercept: number;
  /** Slope of the same regression. */
  slope: number;
  /** Per-category shrunken median-residual adjustments, in log10. */
  category_adjustment: Record<string, number>;
  /** Live protocols the fit used (positive mcap, positive TVL, not an exchange token and not a wrapped, bridged or staked product). */
  live_count: number;
  /** Median mcap/TVL among the fitted live set. */
  median_multiple: number;
}

export interface Validation {
  live_count: number;
  /** Median |log10(predicted / actual)| over leave-one-out predictions. */
  median_log10_error: number;
  /** The same error as a factor: the median prediction is off by this much. */
  median_factor_error: number;
  /** Mean |log10 error|, for the record. */
  mean_log10_error: number;
  /** Share of leave-one-out predictions within a factor of 2. */
  within_factor_2: number;
}

export interface ModelBreakdown {
  base_multiple: number;
  category_adjustment: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  /** A wrapped, bridged, staked or exchange product of a token that already trades — ranked only because it is on the watchlist, and flagged WRAPPED on the dashboard. */
  wrapped: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  /** True when the row is a wrapped, bridged, staked or exchange product of a token that already trades — ranked only because it is on the watchlist, and flagged WRAPPED on the dashboard. */
  wrapped: boolean;
  watchlist: boolean;
  model: ModelBreakdown;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  /** The live protocol's own mcap/TVL multiple, for comparison. */
  multiple: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fit: LiveFit;
  validation: Validation;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'radar-fit-3';
export const LIVE_ROWS = 24;

const DAY_MS = 86_400_000;
const GROWTH_FLOOR = -50;
const GROWTH_CAP = 100;
const GROWTH_WEIGHT = 0.45;
const MATURITY_DAYS = 1095;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  if (s.length === 0) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Whole days from `listedAt` to `asOf`; null when the listing date is unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol records a token when any of the three token fields is set. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Wrapped, bridged, staked or exchange products: a wrapped or bridged
 * version of an asset that already trades, a liquid-staking or restaking
 * receipt, or a product of a centralised exchange. Such a product can
 * never launch a fresh token, so it is not a launch candidate — and its
 * recorded market cap is not a protocol token priced against its TVL,
 * so it is not a learning example either. That is why wrapped products
 * are left out of the fit and out of the early rows. Watchlist slugs are
 * the exception: a watchlist slug is always ranked, wrapped or not, and
 * the board flags it WRAPPED instead of dropping it — the flag, not the
 * absence, carries the warning. The rule is category, name
 * and exchange-name based, with one slug exception: the categories
 * whose whole product is a wrap/bridge/stake (including stablecoin
 * wrappers, cross-chain bridges and BTC anchors — a wrapped stablecoin
 * is USDC that already trades, a BTC anchor is BTC that already
 * trades), any name carrying wrapped, staked or staking (which also
 * catches restaking), any name that starts with an exchange's name,
 * and the slug b14g on its own. b14g is a restaking protocol whose
 * whole product is restaked BTC, but the Restaking category as such
 * is not excluded: a genuine restaking protocol can launch its own
 * token, so only that one slug is cut.
 */
const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'Stablecoin Wrapper',
  'Anchor BTC',
  'Decentralized BTC',
  'CEX',
]);
const EXCLUDED_SLUGS = new Set(['b14g']);
const WRAPPED_NAME = /wrapped|staked|staking/i;
const EXCHANGE_NAMES = [
  'Binance', 'Coinbase', 'Kraken', 'OKX', 'Bybit', 'Bitget', 'Gemini',
  'Bitstamp', 'Huobi', 'KuCoin', 'Gate', 'Bitfinex', 'Bithumb', 'Upbit',
  'Deribit', 'Bitrue', 'Poloniex', 'MEXC', 'BingX', 'HTX', 'OKCoin',
  'Crypto.com', 'Robinhood',
];
const EXCHANGE_NAME = new RegExp(`^(${EXCHANGE_NAMES.join('|').replace(/\./g, '\\.')})[\\s\\-.]`, 'i');

export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (EXCLUDED_SLUGS.has(p.slug)) return true;
  if (WRAPPED_CATEGORIES.has(p.category ?? '')) return true;
  if (WRAPPED_NAME.test(p.name)) return true;
  return EXCHANGE_NAME.test(p.name);
}

/** Rankable: records no token, is not a wrapped/bridged/staked/exchange product, and is not a versioned pool of another protocol. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p) && !VERSIONED.test(p.name);
}

/** Live-token protocols the fit may learn from: a real market cap, a real TVL, and a real protocol token — not an exchange token and not a wrapped, bridged or staked product. */
function fittable(p: SnapshotProtocol): boolean {
  return (
    p.mcap_usd !== null &&
    p.mcap_usd > 0 &&
    p.tvl_usd > 0 &&
    !isWrappedProduct(p)
  );
}

/**
 * Ordinary least squares of log10(mcap) on log10(tvl), plus per-category
 * median-residual adjustments. Categories with fewer than five members get
 * no adjustment (too little evidence); larger ones are shrunk toward zero
 * by n / (n + 5) and capped at +/-0.30 log10, so no single category can
 * drag a protocol's value by more than a factor of two.
 */
export function fitLiveModel(protocols: SnapshotProtocol[]): LiveFit {
  const live = protocols.filter(fittable);
  const xs = live.map((p) => Math.log10(p.tvl_usd));
  const ys = live.map((p) => Math.log10(p.mcap_usd!));
  const n = live.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const byCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Uncategorised';
    const resid = Math.log10(p.mcap_usd!) - (intercept + slope * Math.log10(p.tvl_usd));
    const arr = byCategory.get(key) ?? [];
    arr.push(resid);
    byCategory.set(key, arr);
  }
  const category_adjustment: Record<string, number> = {};
  for (const [key, residuals] of byCategory) {
    if (residuals.length < 5) continue;
    const shrunk = median(residuals) * (residuals.length / (residuals.length + 5));
    category_adjustment[key] = round4(Math.max(-0.3, Math.min(0.3, shrunk)));
  }
  const multiples = live.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  return {
    intercept: round4(intercept),
    slope: round4(slope),
    category_adjustment,
    live_count: n,
    median_multiple: round4(median(multiples)),
  };
}

/** The fitted base value (before growth and maturity) for one protocol. */
function baseValue(p: SnapshotProtocol, fit: LiveFit): { base: number; multiple: number; categoryAdj: number } {
  const categoryAdj = fit.category_adjustment[p.category ?? 'Uncategorised'] ?? 0;
  const logBase = fit.intercept + fit.slope * Math.log10(p.tvl_usd) + categoryAdj;
  const base = Math.pow(10, logBase);
  return { base, multiple: base / p.tvl_usd, categoryAdj };
}

/** The full implied value and its breakdown for one protocol. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  fit: LiveFit,
): { implied: number; breakdown: ModelBreakdown } {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const ageFrac = age === null ? 0.5 : Math.min(age, MATURITY_DAYS) / MATURITY_DAYS;
  const maturityMult = 0.8 + 0.2 * ageFrac;
  const { base, multiple, categoryAdj } = baseValue(p, fit);
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return {
    implied,
    breakdown: {
      base_multiple: round4(multiple),
      category_adjustment: categoryAdj,
      growth_pct: round4(growthPct),
      growth_multiplier: round4(growthMult),
      maturity_multiplier: round4(maturityMult),
      age_days: age,
    },
  };
}

/**
 * Leave-one-out validation on the live set: refit without each protocol,
 * predict it with the same growth and maturity rules, and measure the
 * error in log10 space (a factor error, which is how token values move).
 */
export function validateLiveModel(protocols: SnapshotProtocol[], asOf: string): Validation {
  const live = protocols.filter(fittable);
  const errors: number[] = [];
  for (let i = 0; i < live.length; i++) {
    const train = live.filter((_, j) => j !== i);
    const fit = fitLiveModel(train);
    const target = live[i]!;
    const { implied } = impliedValue(target, asOf, fit);
    errors.push(Math.abs(Math.log10(implied / target.mcap_usd!)));
  }
  const sorted = [...errors].sort((a, b) => a - b);
  const med = median(sorted);
  const mean = errors.reduce((s, v) => s + v, 0) / errors.length;
  const within2 = errors.filter((e) => e <= Math.log10(2)).length / errors.length;
  return {
    live_count: live.length,
    median_log10_error: round4(med),
    median_factor_error: round4(Math.pow(10, med)),
    mean_log10_error: round4(mean),
    within_factor_2: round4(within2),
  };
}

// ---------------------------------------------------------------- farm plans

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Typical gas for one transaction on a chain, in dollars, from the chain's own fee character. */
function gasUsd(chain: string): string {
  const cheap = new Set([
    'Solana', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'BSC', 'BNB Chain',
    'Sui', 'Aptos', 'Sonic', 'Linea', 'Scroll', 'Blast', 'Mode', 'Mantle',
    'Unichain', 'Sei', 'Near', 'Avalanche', 'Fantom', 'Celo', 'Gnosis',
  ]);
  if (chain === 'Ethereum') return 'about $8 to $25 of gas';
  if (cheap.has(chain)) return 'under $1 of gas';
  return 'about $1 to $4 of gas';
}

/** Capital for one farm position, from the protocol's own TVL tier. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 10_000_000) return 50;
  return 25;
}

/** Hold days, from the protocol's age: younger protocols get a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function lowerCategory(p: SnapshotProtocol): string {
  return (p.category ?? '').toLowerCase();
}

/** The main qualifying action, from the protocol's category. */
function mainAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = lowerCategory(p);
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('borrow'))
    return `Supply $${capital} of USDC as collateral to ${name} on ${chain} and leave the position open so it shows up in activity snapshots.`;
  if (c.includes('dex') || c.includes('swap') || c.includes('amm'))
    return `Provide $${capital} of liquidity to ${name}'s main trading pool on ${chain} and keep the position open instead of withdrawing the same day.`;
  if (c.includes('bridge') || c.includes('cross chain'))
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside the protocol's own app rather than bridging straight back.`;
  if (c.includes('stak') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and hold the receipt token it issues.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options'))
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position, then leave the margin in place.`;
  if (c.includes('prediction'))
    return `Fund your account with $${capital} on ${name} and take one position in an active market, then leave the balance working.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('vault'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares instead of exiting after the first week.`;
  if (c.includes('rwa') || c.includes('real world'))
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the same wallet for the full farming window.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and keep it in the protocol rather than moving it out.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full farming window.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('index'))
    return `Allocate $${capital} into a ${name} vault on ${chain} and keep the allocation in place across rebalances.`;
  if (c.includes('launchpad'))
    return `Commit $${capital} to an active sale or staking pool on ${name} on ${chain} and keep the stake through the sale window.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open so the wallet builds a history with the protocol.`;
}

/** A second, different qualifying action, so the plan is not one deposit repeated. */
function secondAction(p: SnapshotProtocol, chain: string): string {
  const c = lowerCategory(p);
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('borrow'))
    return `Borrow a small amount — about a tenth of your deposit — against the collateral, repay most of it a week later, and keep the loan history on the wallet.`;
  if (c.includes('dex') || c.includes('swap') || c.includes('amm'))
    return `Swap a small amount through ${name} on ${chain} once a week, in both directions over the month, so the wallet shows trading as well as liquidity.`;
  if (c.includes('bridge') || c.includes('cross chain'))
    return `Bridge a second, smaller amount to a different supported chain through ${name} and leave it there for a week before moving anything back.`;
  if (c.includes('stak') || c.includes('restak'))
    return `Claim the staking rewards once they accrue and restake them through ${name} instead of sending them to an exchange.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options'))
    return `Close the first position, wait a day, and open a second small position in the opposite direction so the wallet shows repeated use.`;
  if (c.includes('prediction'))
    return `Take a second position in a different market on ${name} and let both positions settle instead of cashing out early.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('vault'))
    return `Claim the vault's yield once it accrues and compound it back into the same vault on ${chain}.`;
  if (c.includes('rwa') || c.includes('real world'))
    return `Check the asset's yield distribution on ${name} and, when a distribution lands, reinvest it rather than withdrawing it.`;
  if (c.includes('stable'))
    return `Use the minted stable asset in one of ${name}'s partner pools on ${chain}, then return it to the protocol.`;
  if (c.includes('insurance'))
    return `File a test claim only if a real covered event happens; otherwise renew or extend the cover before it lapses.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('index'))
    return `Rebalance once when the vault offers a new allocation, moving a small share into the new strategy.`;
  if (c.includes('launchpad'))
    return `Vote in the next community or allocation vote on ${name} if one opens, and keep the stake through the vote.`;
  return `Do one more on-chain action with the protocol — a swap, a vote or a second deposit — so the wallet shows more than a single transaction.`;
}

function clampStep(s: string): string {
  let out = s.replace(/\s+/g, ' ').trim();
  if (out.length > 600) out = `${out.slice(0, 597)}...`;
  if (out.length < 20) out = `${out} Keep the wallet and the transaction history for the record.`;
  return out;
}

/**
 * Six farm steps, each with a cost and a time, derived from the protocol's
 * own record (category, chains, TVL, age). No step names a protocol that
 * is not the row itself, and no step promises an airdrop: the honest line
 * is that the protocol records no token, which is the snapshot's record,
 * not proof it has none, and the implied value is this entry's own claim,
 * not a prediction that a token will be issued.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasUsd(chain);
  const chainsNote = p.chains.length > 1 ? ` It also runs on ${p.chains.slice(1, 3).join(' and ')}. ` : ' ';
  const steps = [
    `Set up a fresh wallet that holds only the funds you plan to farm, write its seed phrase on paper and keep it offline, then fund it with $${capital + 10} on ${chain}.${chainsNote}Cost: ${gas} for the first transaction. Time: 10 minutes.`,
    `${mainAction(p, capital, chain)} Cost: $${capital} of capital and ${gas} per transaction. Time: 15 minutes to set up.`,
    `${secondAction(p, chain)} Cost: about $${Math.max(5, Math.round(capital / 10))} of capital and ${gas}. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days, checking it once a week, so the activity is counted in more than one snapshot instead of looking like a single-day deposit. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `This protocol records no token in the snapshot — that is the record, not proof it has none — and the implied value of $${implied.toLocaleString('en-US')} is this entry's own claim, not a prediction that a token will be issued. Check the protocol's own points or rewards page before you act. Cost: nothing to check. Time: 10 minutes.`,
    `Write the wallet address, the dates and every transaction hash in a farm log, then plan the exit before you need it: unstake or withdraw in one transaction and keep the log for tax and for the next farm. Cost: ${gas} to unwind. Time: 10 minutes.`,
  ];
  return steps.map(clampStep);
}

// ---------------------------------------------------------------- board

/** The live-token comparison set, by market cap, for the dashboard's Live view — the same set the fit learned from, so no wrapped, bridged or staked product appears here either. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && !isWrappedProduct(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** All rankable pre-token protocols, scored and ranked 1..N by implied value. Watchlist slugs are always ranked: the wrapped/bridged/staked/versioned exclusion applies to early rows only, so a watchlist slug that is such a product (e.g. b14g, Saturn) is ranked and flagged WRAPPED instead of dropped. */
export function buildBoard(snapshot: Snapshot, fit: LiveFit): BoardRow[] {
  const watchlist = new Set(snapshot.watchlist);
  const chosen = snapshot.protocols.filter((p) => watchlist.has(p.slug) || isRankable(p));
  const scored = chosen.map((p) => {
    const { implied, breakdown } = impliedValue(p, snapshot.as_of, fit);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const age = ageDays(snapshot.as_of, s.p.listed_at);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      wrapped: isWrappedProduct(s.p),
      age_days: age,
      implied_value_usd: s.implied,
      model: s.breakdown,
      farm_steps: farmSteps(s.p, age, s.implied),
    };
  });
}

/** Everything the dashboard needs, built from the snapshot in one pass. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fit = fitLiveModel(snapshot.protocols);
  const validation = validateLiveModel(snapshot.protocols, snapshot.as_of);
  const board = buildBoard(snapshot, fit);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    fit,
    validation,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      wrapped: r.wrapped,
      watchlist: watchlist.has(r.slug),
      model: r.model,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. Every watchlist slug must be covered — watchlist slugs are always ranked, so there is no wrapped exception and a missing slug is a failure. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const len = s.trim().length;
      if (len < 20 || len > 600) return `${r.slug} has a farm step of ${len} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** The dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
