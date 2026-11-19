// Radar-2: the token launch radar's scoring model and farm-plan generator.
//
// Everything here is computed only from the sealed DefiLlama snapshot
// (input/snapshot.json). No network, no external data, no special-casing by
// protocol name, no randomness. The same snapshot always gives the same board.
//
// THE MODEL (one transparent formula, stated on the dashboard):
//
//   implied = TVL x 0.17 x chainF x momF x catF x matF
//
//   0.17   base multiple. The median market-cap-to-TVL ratio of the 144
//          live-token protocols in this very snapshot is 0.169, so a
//          protocol's token is anchored at 17 cents of market cap per
//          dollar of TVL. The mean (4.48) is skewed by a few outliers,
//          so the median is the honest anchor.
//   chainF chain-breadth factor. 1 + 0.08 x (min(chains, 6) - 1), at most
//          1.40. Each extra chain is more launch surface: more users to
//          airdrop to, more venues to list on. Past six chains the extra
//          surface flattens, so the factor caps there.
//   momF   7-day momentum factor. 1 + 0.006 x clamp(change_7d, -50, +100),
//          so +100% growth gives 1.60 and -50% gives 0.70. A protocol
//          whose TVL is growing fast is closer to launch-ready than one
//          bleeding TVL. Null change (4 protocols) counts as 0%.
//   catF   category multiple. The live median mcap/TVL of the protocol's
//          own category, divided by the overall live median 0.169, clamped
//          to [0.50, 2.00]. Categories whose live tokens command more per
//          TVL dollar are worth more per TVL dollar. A category with
//          fewer than 3 live protocols has no trustworthy median and
//          takes 1.00. Dexs (0.342) lands near 2.00; Yield (0.121)
//          lands near 0.72. The multiples are computed from the snapshot
//          at run time, never hardcoded.
//   matF   maturity factor. 0.70 + 0.30 x min(age_days, 1460) / 1460.
//          A protocol that has run for years with no token has survived
//          cycles and built the user base a launch needs; a two-week-old
//          protocol has not. Unknown listed date counts as 365 days.
//
// ELIGIBILITY: a protocol joins the board when it records no token
// (mcap, gecko_id and symbol all null), its name ends in no version
// marker (a V2 of a protocol whose token already trades is not a fresh
// launch), and its category is not CEX, Bridge, Canonical Bridge, Liquid
// Staking, Liquid Restaking or Restaked BTC (wrapped, staked or bridged
// products of tokens that already trade). The whole watchlist passes
// these tests; the board adds the early pre-token protocols below the
// floor that pass them too, ranked by implied value.

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

export interface ModelBreakdown {
  base: number;
  chainF: number;
  momF: number;
  catF: number;
  matF: number;
  ageDays: number | null;
  catMedian: number | null;
}

export interface BoardRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: null;
  listed_at: string | null;
  rank: number;
  implied_value_usd: number;
  watchlist: boolean;
  breakdown: ModelBreakdown;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number;
  ratio: number;
}

export const AS_OF = '2026-11-14';
export const BASE_MULTIPLE = 0.17;
export const CHAIN_STEP = 0.08;
export const CHAIN_CAP_COUNT = 6;
export const MOM_RATE = 0.006;
export const MOM_MIN = -50;
export const MOM_MAX = 100;
export const MAT_BASE = 0.7;
export const MAT_SPAN_DAYS = 1460;
export const UNKNOWN_AGE_DAYS = 365;
export const CAT_MIN_LIVE = 3;
export const CAT_CLAMP_LO = 0.5;
export const CAT_CLAMP_HI = 2.0;
export const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isEligible(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (VERSION_MARKER.test(p.name)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  return true;
}

export function ageDays(p: SnapshotProtocol, asOf: string): number | null {
  if (!p.listed_at) return null;
  const [y, m, d] = p.listed_at.split('-').map(Number);
  const listed = Date.UTC(y, m - 1, d);
  const [ay, am, ad] = asOf.split('-').map(Number);
  const ref = Date.UTC(ay, am - 1, ad);
  const days = Math.floor((ref - listed) / 86400000);
  return days < 0 ? 0 : days;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return 0;
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** Live-token median mcap/TVL per category, from the snapshot itself. */
export function liveCategoryMedians(
  protocols: SnapshotProtocol[],
): Map<string, { median: number; n: number }> {
  const byCat = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0 || p.category === null) continue;
    const arr = byCat.get(p.category) ?? [];
    arr.push(p.mcap_usd / p.tvl_usd);
    byCat.set(p.category, arr);
  }
  const out = new Map<string, { median: number; n: number }>();
  for (const [cat, ratios] of byCat) out.set(cat, { median: median(ratios), n: ratios.length });
  return out;
}

export function liveMedianRatio(protocols: SnapshotProtocol[]): number {
  const ratios = protocols
    .filter((p) => p.mcap_usd !== null && p.tvl_usd > 0)
    .map((p) => p.mcap_usd! / p.tvl_usd);
  return median(ratios);
}

export function categoryMultiple(
  category: string | null,
  medians: Map<string, { median: number; n: number }>,
  overallMedian: number,
): { multiple: number; catMedian: number | null } {
  if (category === null) return { multiple: 1, catMedian: null };
  const entry = medians.get(category);
  if (!entry || entry.n < CAT_MIN_LIVE) return { multiple: 1, catMedian: entry?.median ?? null };
  const raw = entry.median / overallMedian;
  const multiple = Math.min(CAT_CLAMP_HI, Math.max(CAT_CLAMP_LO, raw));
  return { multiple, catMedian: entry.median };
}

export function score(
  p: SnapshotProtocol,
  medians: Map<string, { median: number; n: number }>,
  overallMedian: number,
  asOf: string,
): { implied: number; breakdown: ModelBreakdown } {
  const base = p.tvl_usd * BASE_MULTIPLE;
  const chainCount = Math.min(p.chains.length, CHAIN_CAP_COUNT);
  const chainF = 1 + CHAIN_STEP * (chainCount - 1);
  const ch = p.change_7d === null ? 0 : Math.min(MOM_MAX, Math.max(MOM_MIN, p.change_7d));
  const momF = 1 + MOM_RATE * ch;
  const { multiple: catF, catMedian } = categoryMultiple(p.category, medians, overallMedian);
  const age = ageDays(p, asOf);
  const effAge = age === null ? UNKNOWN_AGE_DAYS : age;
  const matF = MAT_BASE + (1 - MAT_BASE) * (Math.min(effAge, MAT_SPAN_DAYS) / MAT_SPAN_DAYS);
  const implied = Math.round(base * chainF * momF * catF * matF);
  return {
    implied: Math.max(1, implied),
    breakdown: { base: Math.round(base), chainF, momF, catF, matF, ageDays: age, catMedian },
  };
}

// ---------------------------------------------------------------- farm plans

function money(n: number): string {
  return '$' + n.toLocaleString('en-US');
}

function capitalTier(tvl: number): number {
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

function holdDays(age: number | null): number {
  const a = age === null ? UNKNOWN_AGE_DAYS : age;
  if (a >= 730) return 60;
  if (a >= 365) return 45;
  return 30;
}

function chainList(chains: string[]): string {
  return chains.slice(0, 3).join(', ');
}

/** The protocol's main product, in one concrete action, by category. */
function coreAction(p: SnapshotProtocol, amount: number): string {
  const n = p.name;
  const c = chainList(p.chains);
  const cat = p.category ?? '';
  switch (cat) {
    case 'Dexs':
      return `Swap ${money(amount)} of ETH for USDC through ${n} on ${c}, in two trades a week apart so both land as separate on-chain activity.`;
    case 'Lending':
      return `Supply ${money(amount)} of USDC to ${n} on ${c} as collateral, then borrow ${money(Math.round(amount * 0.4))} of ETH against it and repay the loan after a week.`;
    case 'Yield':
      return `Deposit ${money(amount)} into ${n}'s highest-TVL vault on ${c} and leave it earning for at least two weeks without withdrawing.`;
    case 'Yield Aggregator':
      return `Deposit ${money(amount)} into ${n}'s auto-compounding vault on ${c} and let it harvest and re-stake for at least two weeks.`;
    case 'Derivatives':
    case 'Options':
    case 'Options Vault':
      return `Open a ${money(amount)} long position with 2x leverage on ${n} on ${c}, set a stop-loss 10% below entry, and close it within two weeks.`;
    case 'RWA':
      return `Buy ${money(amount)} of tokenised real-world assets through ${n} on ${c} and hold the receipt token in the same wallet for the full farming window.`;
    case 'CDP':
    case 'CDP Manager':
      return `Lock ${money(amount)} of ETH as collateral in ${n} on ${c}, mint ${money(Math.round(amount * 0.5))} of its stablecoin, and keep the position above a 200% collateral ratio.`;
    case 'Liquid Restaking':
    case 'Restaking':
      return `Restake ${money(amount)} of ETH through ${n} on ${c} and hold the liquid restaking token in your wallet for the full farming window.`;
    case 'Leveraged Farming':
      return `Open a ${money(amount)} leveraged farming position on ${n} on ${c} at 2x leverage, and close it before the health factor drops under 1.5.`;
    case 'Risk Curators':
      return `Deposit ${money(amount)} into a ${n} curated vault on ${c} and keep the position open for at least 30 days so the curator's allocation history records you.`;
    case 'Onchain Capital Allocator':
      return `Allocate ${money(amount)} through ${n} on ${c} into its top allocation strategy and leave it deployed for at least 30 days.`;
    case 'Prediction Market':
      return `Place ${money(amount)} across three different markets on ${n} on ${c}, backing the outcome you genuinely believe, and hold the positions to resolution.`;
    case 'Perps':
    case 'Basis Trading':
      return `Open a ${money(amount)} perpetual position on ${n} on ${c} with 3x leverage or less, and close it after funding has been paid at least twice.`;
    case 'Insurance':
      return `Buy ${money(amount)} of cover on ${n} on ${c} for a protocol you already use, and keep the policy active for at least 30 days.`;
    case 'Launchpad':
      return `Stake ${money(amount)} of the launchpad's accepted asset on ${n} on ${c} to qualify for allocations, and join at least one sale while staked.`;
    case 'Payments':
      return `Route ${money(amount)} of real payments through ${n} on ${c} over two weeks, keeping the same wallet for every transaction.`;
    case 'Decentralized AI':
    case 'AI Agents':
      return `Run ${money(amount)} of inference or agent tasks through ${n} on ${c} and pay the fees from the same wallet you will claim any airdrop with.`;
    default:
      return `Use ${n}'s main product on ${c} with ${money(amount)}, in at least two separate transactions a week apart, so the activity reads as real usage.`;
  }
}

function secondAction(p: SnapshotProtocol, amount: number): string {
  const n = p.name;
  const c = chainList(p.chains);
  const cat = p.category ?? '';
  if (cat === 'Dexs' || cat === 'Yield' || cat === 'Yield Aggregator') {
    return `Provide ${money(Math.round(amount * 0.6))} of liquidity to ${n}'s deepest pool on ${c} and keep it in range for at least 14 days.`;
  }
  if (cat === 'Lending' || cat === 'CDP' || cat === 'CDP Manager') {
    return `Repay half the borrowed amount on ${n} after a week, then borrow again for a smaller ${money(Math.round(amount * 0.2))} to show repeat usage.`;
  }
  return `Repeat the core interaction on ${n} on a second chain (${p.chains[1] ?? c}) with ${money(Math.round(amount * 0.5))}, so the activity spans more than one chain.`;
}

/** Six concrete farm steps for one protocol, each 20-600 chars. */
export function farmSteps(p: SnapshotProtocol, asOf: string): string[] {
  const amount = capitalTier(p.tvl_usd);
  const age = ageDays(p, asOf);
  const days = holdDays(age);
  const main = p.chains[0] ?? 'Ethereum';
  const steps = [
    `Read ${p.name}'s docs and confirm it records no token yet: check its site, its docs and its socials for any token announcement before you spend anything.`,
    `Set up a fresh wallet for farming only, fund it with ${money(amount + 25)} on ${main} (${money(amount)} to use, ${money(25)} kept back for gas), and never mix it with your main holdings.`,
    coreAction(p, amount),
    secondAction(p, amount),
    `Hold every position for at least ${days} days and touch the protocol at least once a week: weekly activity over ${days} days is what airdrop snapshots usually reward, not one big day.`,
    `Keep a record of every transaction hash, screenshot your positions, and watch ${p.name}'s announcements daily; if a token is announced, claim only through the protocol's own site, never a link from a DM.`,
  ];
  for (const s of steps) {
    if (s.length < 20 || s.length > 600) {
      throw new Error(`farm step out of bounds (${s.length} chars) for ${p.slug}: ${s}`);
    }
  }
  return steps;
}

/** The board: all eligible watchlist protocols plus the top early ones by implied value. */
export function buildBoard(snapshot: Snapshot, boardSize = 200): { rows: BoardRow[]; live: LiveRow[]; overallMedian: number; medians: Map<string, { median: number; n: number }> } {
  const overallMedian = liveMedianRatio(snapshot.protocols);
  const medians = liveCategoryMedians(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const eligible = snapshot.protocols.filter(isEligible);
  const scored = eligible.map((p) => {
    const { implied, breakdown } = score(p, medians, overallMedian, snapshot.as_of);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const watchRows = scored.filter((s) => watchlist.has(s.p.slug));
  const earlyRows = scored.filter((s) => !watchlist.has(s.p.slug));
  const take = Math.max(0, boardSize - watchRows.length);
  const chosen = [...watchRows, ...earlyRows.slice(0, take)];
  chosen.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const rows: BoardRow[] = chosen.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category ?? 'Uncategorised',
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: null,
    listed_at: s.p.listed_at,
    rank: i + 1,
    implied_value_usd: s.implied,
    watchlist: watchlist.has(s.p.slug),
    breakdown: s.breakdown,
    farm_steps: farmSteps(s.p, snapshot.as_of),
  }));
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Uncategorised',
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd!,
      ratio: p.mcap_usd! / p.tvl_usd,
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd)
    .slice(0, 24);
  return { rows, live, overallMedian, medians };
}
