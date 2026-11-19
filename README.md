# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Amusu781/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Amusu781/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar — every pre-token protocol in the sealed DefiLlama snapshot, ranked by what its token would be worth if the protocol's record stayed as it is, with a six-step farm plan for each one. The board covers all 40 watchlist protocols plus the 160 highest-implied early protocols below the $50M floor. Model: implied = TVL × 0.17 × chain factor × momentum factor × category multiple × maturity factor — the 0.17 is the median market-cap-to-TVL ratio of the snapshot's 144 live-token protocols, and the category multiples are computed from the snapshot itself. No network, no external data, fully deterministic.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Reads the snapshot, writes `board.json` (200 ranked rows), `data.js` (the dashboard's dataset), copies `dashboard/` and `screenshots/` into the output directory, and writes `dossier.json`. Open `out/dashboard/index.html` in a browser to use the radar: sortable and filterable board, per-protocol detail with the model breakdown and farm plan, a live-token view, and the model explained in full.

---

<sub>Entered on [make.fun](https://make.fun/?ref=8a2dzbnc&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
