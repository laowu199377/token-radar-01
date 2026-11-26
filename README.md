# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/laowu199377/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/laowu199377/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![DefiLlama](https://img.shields.io/badge/data-DefiLlama-0e1a2b)](https://defillama.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Pre-token protocols, ranked by what a token launch would be worth.

## What this is

A token launch radar built from a sealed DefiLlama snapshot (758 protocols,
as of 2026-11-14). It scores every pre-token protocol with one model and
ranks them by implied value, so a farmer can see where a launch would pay
most — and what to do there.

## The model (radar-2)

```
implied value = TVL × 0.25 × growth × maturity
```

- **Base — TVL × 0.25.** A token is worth a quarter of the TVL it secures.
- **Growth — 7-day change**, clamped to −50%…+150% and weighted ×0.5. A
  week's spike never decides the ranking (the snapshot's fastest riser
  printed +4448%).
- **Maturity — no-token duration**, 0.50 at listing rising to 1.20 after four
  years. A protocol that has run for years without a token is worth more
  than one that listed last month; the wait itself is the signal.

Everything comes from the snapshot's own figures: TVL, 7-day change and
listing date. No protocol name is hardcoded into the ranking.

## What never gets ranked

Wrapped, staked and bridged products (WBTC, Binance staked ETH, USDT0…)
and exchange products are left off this board: their token already trades,
so they are not launch candidates. They appear under “Already trading”
instead, with the market's own value (market cap) rather than a model's.

## The board

- **198 rows** — the 40-protocol watchlist, plus every other rankable
  pre-token protocol in the snapshot. All 40 watchlist protocols land in
  the top 68.
- **Top launch: Steakhouse Financial, $517.8M implied** (Sentora Curator
  $484.9M, Gauntlet $308.4M, Veda $300.9M, USDD $206.4M).
- **Total implied value: $3.79B** across the board.
- Every row carries a **7-step farm plan** (fresh wallet, main action,
  second action, weekly activity, hold length, safe claiming, exit log),
  each step with a dollar amount and a time cost.

## How to run it

```sh
# Node 22, standard library only
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

`main.ts` reads the sealed snapshot, writes `board.json`, `data.js`,
`dashboard/` (the static page), `screenshots/` and `dossier.json` into the
output directory. The dashboard is a static page — no framework, no
network — and reads `data.js`.

## Files

| File | What it is |
| --- | --- |
| `main.ts` | Entrypoint: snapshot → board → dashboard → dossier |
| `lib/model.ts` | The radar-2 model, board builder and farm-plan generator |
| `vendor/makefun-board.ts` | make.fun's dossier library (vendored, unchanged) |
| `dashboard/` | The static page (`index.html`, `app.css`, `app.js`) |
| `screenshots/` | Board, detail and filtered views of the dashboard |

## License

MIT. See [LICENSE](LICENSE).
