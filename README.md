# Token Launch Radar

[![token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/winah1308-hub/token-radar/rank.svg)](https://make.fun/c/token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/winah1308-hub/token-radar/reward.svg)](https://make.fun/c/token-radar-01)

Which pre-token protocol is worth farming next — and what exactly do you do about it?

This entry reads a frozen DefiLlama snapshot of 758 protocols (as of 2026-11-14), ranks **all 191 rankable pre-token protocols** (all 40 of the watchlist — including b14g and Saturn, ranked and flagged WRAPPED — plus 151 early finds below the $50M floor) by an implied token value, and gives every one a concrete six-step farm plan with costs and times. The dashboard is a static page — sortable board, filters, a detail view per protocol, a live-token comparison view, and a full explanation of the model.

## What the radar does

- **Board** — 191 rows, ranks 1–191, implied values non-increasing with rank. Every one of the 40 watchlist slugs is covered, including b14g and Saturn, which are ranked and flagged WRAPPED: they are wrapped/restaked products of tokens that already trade, so they are not fresh launches, and the flag says so on the board and in the detail view. Non-watchlist wrapped, staked and bridged products of tokens that already trade are left out of the ranking — their underlying token already trades, so they are not fresh launches — as are exchanges and versioned pools. That keeps the Stablecoin Wrapper, Cross Chain Bridge, Anchor BTC and Decentralized BTC categories out except for the watchlist's own Saturn, and the restaking protocol b14g is ranked on its own (the Restaking category itself stays, since a genuine restaking protocol can launch its own token).
- **Detail view** — click any row: the model breakdown (base multiple, growth and maturity multipliers, age), the six farm steps, a note comparing the protocol with the live-token market, and a Flagged line on wrapped watchlist rows.
- **Live tokens view** — the top 24 protocols whose token already trades, with their real market caps and market-cap/TVL multiples. They are the comparison set, never mixed into the ranked board.
- **Filters** — text search, category, chain, watchlist-only / early-only, minimum TVL; every column sorts.

## The model

The implied value is fitted from the snapshot's own figures, never from a hand-kept list of names:

```
implied = 10^(a + b × log10(TVL) + categoryAdj) × growthMult × maturityMult
```

- **Fit.** Least-squares regression of log10(market cap) on log10(TVL) over the live-token protocols in the same snapshot: **a = 3.7591, b = 0.4217**, fitted on **89** protocols (positive market cap, positive TVL, wrapped, bridged, staked and exchange products excluded — including the Stablecoin Wrapper, Cross Chain Bridge, Anchor BTC and Decentralized BTC categories and the b14g slug — their recorded market caps are not protocol tokens priced against their TVL). The median live market-cap/TVL multiple is **×0.2227**. A slope below 1 means larger protocols trade at a smaller multiple of TVL — the snapshot's own data says so, so the model says so too.
- **Category adjustment.** Categories with at least five live members get a shrunken median-residual adjustment, capped at ±0.30 in log10 (at most a factor of two). Smaller categories get none.
- **Growth.** The 7-day TVL change, clamped to −50%…+100% and weighted at 0.45. Missing 7-day change counts as 0%.
- **Maturity.** Age is the snapshot date minus the listing date; unknown age is neutral. Multiplier runs 0.80 (brand new) to 1.00 (three years or older).

### Validation — stated honestly

Leave-one-out over the 89 live-token protocols: refit the whole model without each protocol, predict it, and compare with its real market cap.

- Median prediction error: **a factor of ×3.1272** (median log10 error 0.4952, mean 0.6757)
- Only **34.8%** of predictions land within a factor of two of the real market cap

The market is noisy. This model is a ranking aid — it orders protocols by the snapshot's own figures. It does not forecast a price, an issuance, or a date, and the dashboard says so on every detail view. A protocol "records no token" in the snapshot; that is the record, not proof it has none.

## Farm plans

Six steps per protocol, each stating its cost and time, derived from the protocol's own record:

1. a fresh wallet, funded with a little more than the position size;
2. the main qualifying action for its category (supply, provide liquidity, bridge, stake, …) with capital set by its TVL tier ($25–$200) and gas priced by its main chain;
3. a second, different qualifying action for the same category;
4. a hold of 30–60 days, longer for younger protocols;
5. the honest check — the protocol records no token, and the implied value is this entry's own claim, not a prediction of issuance;
6. a farm log and a planned exit.

## How to run

Node 22.18 or later, standard library only — nothing to install.

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Or with flags: `node main.ts --input <snapshot.json|dir> --output <dir>` (defaults: input `/input`, output `/output` or `$MAKEFUN_OUTPUT_DIR`).

The program writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory, and self-checks the board against the gate rules (coverage of every watchlist slug, ranks 1–191, non-increasing implied values, farm-step lengths) before writing anything — it exits non-zero with a clear message on failure. Two runs write byte-identical outputs: nothing here reads the clock, the network, or a random source.

## Layout

```
main.ts                  entry point: read snapshot, build board, write outputs
lib/model.ts             the fitted model, board builder, farm plans, data.js writer
vendor/makefun-board.ts  make.fun's dossier library, copied verbatim from the kit
dashboard/               index.html + app.css + app.js (22,607 bytes total, no network)
screenshots/             1-board.png, 2-detail.png, 3-filtered.png
```

## License

MIT — see [LICENSE](LICENSE).
