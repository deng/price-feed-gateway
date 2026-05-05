# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start local Wrangler dev server on :8787
npm run deploy    # Deploy to Cloudflare Workers (uses dotenv for CLOUDFLARE_API_TOKEN)
npm test          # Run all tests via Vitest (no network needed)
npm run typecheck # Type-check with tsc --noEmit
npm run test:watch# Watch mode for tests
```

## Architecture

**Single-file Cloudflare Worker** (`src/index.ts`) that aggregates cryptocurrency prices from multiple exchanges. This is a TypeScript/Hono port of the original Rust/Axum `price-oracle` service, redesigned for wrangler deployment.

### Data flow

```
Client → Gateway (Hono) → Binance / Bitget / API Ninjas / DexScreener
                    ↑
              env vars: API URLs, enable/disable toggles, API keys
```

### Exchange architecture

Each exchange is a `ExchangeClient` entry in the `EXCHANGES` array with:
- `name` — string identifier ("binance", "bitget", "apininjas", "dexscreener")
- `enabled(env)` — runtime toggle from env vars
- `getPrice(env, symbol)` — single price
- `getAllPrices(env, symbol)` — all prices (default = wraps getPrice; DexScreener overrides for multi-DEX)

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/health` | Health check |
| GET | `/api/v1/price?symbol=BTCUSDT&exchange=binance` | Single exchange price |
| GET | `/api/v1/price?symbol=BTCUSDT` | All exchanges price |
| GET | `/api/v1/price?base=BTC&quote=USDT&exchange=binance` | Alt query format |

### Caching

In-memory Map-based cache (per-Worker isolate, not shared):
- **CEX cache** (10s TTL): Binance, Bitget, API Ninjas — keyed by `{exchange}:{symbol}`
- **Dex cache** (30s TTL): DexScreener — keyed by `{symbol}`, stores all DEX prices as a batch
- On API failure, falls back to stale cache
- `cached` boolean flag set to `true` when serving from cache

### DexScreener multi-DEX

`findMatchingPairs()` filters pairs by token symbols, sorts by USD liquidity descending, deduplicates by DEX ID (keeps highest liquidity DEX). Returns all DEX prices for transparency.

### Configuration

Set via `wrangler.toml` (non-secret) or `wrangler secret put` (sensitive):
- `BINANCE_BASE_URL`, `BITGET_BASE_URL`, `APININJAS_BASE_URL`, `DEXSCREENER_BASE_URL`
- `ENABLE_BINANCE`, `ENABLE_BITGET`, `ENABLE_APININJAS`, `ENABLE_DEXSCREENER` — "true"/"false"
- `PRICE_CACHE_TTL_CEX` (default 10), `PRICE_CACHE_TTL_DEX` (default 30)
- `APININJAS_API_KEY` — required for API Ninjas, set as secret
