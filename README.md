# 0x8dxd-inspired Polymarket Bot

An original strategy reconstruction using the [Predictefy prediction market API](https://predictefy.com/en/prediction-market-api), with runnable Node.js 24 code, a local dashboard, public wallet evidence and reproducible tests. The wallet's private source code and original parameters remain unknown.

Short-window Binance momentum plus high-priced Polymarket outcomes. A two-basis-point move over eight to fifteen seconds selects Up or Down. Require a 90-98.5-cent quote, depth and positive conditional winning surplus after reserves. Exit after thirty seconds or a two-percent adverse liquidation mark. This is a momentum hypothesis, not proven latency arbitrage.

## Run locally

No runtime dependencies. Tests, demo, saved capture replay and dashboard work without an API key.

```powershell
git clone https://github.com/Ong-pogs/0x8dxd-inspired-polymarket-bot
cd 0x8dxd-inspired-polymarket-bot
npm test
npm run verify
npm run demo
npm run replay
npm run dashboard
```

Open http://127.0.0.1:8853. For a fresh capture, copy .env.example to .env, set PREDICTEFY_API_KEY privately, then run `npm run scan -- --out runs/my-capture`. No signer, funded account or order-submission route is included.

## Saved result and evidence

The original shared experiment was captured October 23, 2026, 02:46-02:49 UTC, after its source/rules were frozen. This bot has 48 saved snapshots, zero entries and $0 realized local P&L. It declined every entry under the frozen rules. Original wallet responses contain 200 returned trades, cross-checked against saved official transaction hash, token, price and size. The returned pages are not lifetime history.

This standalone packaging was created after that capture. Archived frozen source is retained under data/frozen-source; verification checks its original hashes and confirms this extracted policy reproduces the original ledger exactly. Dedicated controlled win/loss/rejection fixtures exercise the standalone policy. Future captures check the separately packaged rule hashes.

Local ledger: $1,000; up to ten requested shares; 25% displayed-depth participation; 0.1-cent adverse-price reserve; $20 per condition; $100 open acquisition cap. Five-second freshness and two-second book skew. Actual fills determine cost basis and exits; residual shares stay exposed. Settlement requires verified closed condition evidence with exactly one winning token.

The fee reserve is the maximum of the [documented crypto curve](https://docs.polymarket.com/trading/fees) and conservatively interpreted reported-notional reserve. Inspected markets report 1,000 base-fee units. This is a budgeting assumption, not exact venue fee accounting. No rebates. Snapshot fills do not prove actual execution or profitability.

## Predictefy resources

- [API access](https://predictefy.com/en/prediction-market-api)
- [Quickstart](https://docs.predictefy.com/quickstart/)
- [Trader intelligence](https://docs.predictefy.com/reference/trader-intelligence/)
- [Polymarket order books](https://docs.predictefy.com/api/operations/fetchorderbook/)
- [Binance reference ticker](https://docs.predictefy.com/api/operations/feedfetchticker/)
- [Reference candles](https://docs.predictefy.com/api/operations/feedfetchohlcv/)
- [TypeScript SDK](https://docs.predictefy.com/guides/sdk/)
- [Python SDK](https://docs.predictefy.com/guides/python-sdk/)
- [Plans and credits](https://docs.predictefy.com/guides/credits/)

REST is used directly; SDKs are alternative integrations. [Build prompt](build-prompt.txt).

Other projects: [Gabagool22](https://github.com/Ong-pogs/gabagool-inspired-polymarket-bot), [Coinman2](https://github.com/Ong-pogs/coinman2-inspired-polymarket-bot).
