import { Hono } from 'hono';
import { cors } from 'hono/cors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface Price {
  symbol: string;
  price: number;
  exchange: string;
  timestamp: number;  // unix ms
  cached: boolean;
  chain?: string;
  contractAddress?: string;
}

export interface PriceRequest {
  symbol?: string;
  base?: string;
  quote?: string;
  chain?: string;
  address?: string;
  exchange?: string;
}

interface PriceResponse {
  success: boolean;
  data?: Price;
  error?: string;
}

interface MultiPriceResponse {
  success: boolean;
  data: Price[];
  error?: string;
}

// Batch types
interface BatchPriceItem {
  symbol?: string;
  base?: string;
  quote?: string;
  chain?: string;
  address?: string;
}

interface BatchPriceRequestBody {
  tokens: BatchPriceItem[];
}

interface BatchPriceResponseItem {
  success: boolean;
  data?: Price;
  error?: string;
  request: { symbol?: string; chain?: string; address?: string };
}

interface HealthResponse {
  status: string;
  timestamp: string;
  version: string;
}

export interface Env {
  // Exchange base URLs
  BINANCE_BASE_URL: string;
  BITGET_BASE_URL: string;
  APININJAS_BASE_URL: string;
  DEXSCREENER_BASE_URL: string;

  // Enable/disable toggles
  ENABLE_BINANCE: string;
  ENABLE_BITGET: string;
  ENABLE_APININJAS: string;
  ENABLE_DEXSCREENER: string;

  // Cache TTL
  PRICE_CACHE_TTL_CEX: string;
  PRICE_CACHE_TTL_DEX: string;

  // Timeout
  REQUEST_TIMEOUT_SECS: string;

  // Secrets
  APININJAS_API_KEY: string;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------
interface CacheEntry {
  data: unknown;
  expiresAt: number;
}

class PriceCache {
  private cexCache = new Map<string, CacheEntry>();
  private dexCache = new Map<string, CacheEntry>();
  private cexTtl: number;
  private dexTtl: number;

  constructor(cexTtl: number, dexTtl: number) {
    this.cexTtl = cexTtl * 1000;
    this.dexTtl = dexTtl * 1000;
  }

  private makeKey(exchange: string, symbol: string): string {
    return `${exchange}:${symbol}`;
  }

  get(exchange: string, symbol: string): Price | undefined {
    const key = this.makeKey(exchange, symbol);
    const entry = this.cexCache.get(key);
    if (entry && Date.now() < entry.expiresAt) {
      const price = entry.data as Price;
      return { ...price, cached: true };
    }
    return undefined;
  }

  set(exchange: string, symbol: string, price: Price): void {
    const key = this.makeKey(exchange, symbol);
    this.cexCache.set(key, {
      data: { ...price, cached: false },
      expiresAt: Date.now() + this.cexTtl,
    });
  }

  getDexPrices(symbol: string): Price[] | undefined {
    const entry = this.dexCache.get(symbol);
    if (entry && Date.now() < entry.expiresAt) {
      const prices = entry.data as Price[];
      return prices.map(p => ({ ...p, cached: true }));
    }
    return undefined;
  }

  setDexPrices(symbol: string, prices: Price[]): void {
    this.dexCache.set(symbol, {
      data: prices.map(p => ({ ...p, cached: false })),
      expiresAt: Date.now() + this.dexTtl,
    });
  }
}

// ---------------------------------------------------------------------------
// Symbol parsing
// ---------------------------------------------------------------------------
function getParsedSymbol(req: PriceRequest): { symbol: string; base: string; quote: string } | { error: string } {
  if (req.base && req.quote) {
    const base = req.base.toUpperCase();
    const quote = req.quote.toUpperCase();
    return { symbol: `${base}${quote}`, base, quote };
  }
  if (req.symbol) {
    const symbol = req.symbol.toUpperCase();
    // Attempt to auto-parse
    for (const q of ['USDT', 'USDC', 'USD', 'BNB', 'ETH', 'BTC']) {
      if (symbol.endsWith(q)) {
        const base = symbol.slice(0, -q.length);
        if (base.length > 0) {
          return { symbol, base, quote: q };
        }
      }
    }
    return { symbol, base: '', quote: '' };
  }
  return { error: "Either 'symbol' or both 'base' and 'quote' must be provided" };
}

// ---------------------------------------------------------------------------
// DexScreener: symbol auto-parsing (also used by get_price)
// ---------------------------------------------------------------------------
function parseDexSymbol(symbol: string): { base: string; quote: string } | null {
  if (symbol.includes('/')) {
    const parts = symbol.split('/');
    if (parts.length === 2) return { base: parts[0], quote: parts[1] };
    return null;
  }
  const upper = symbol.toUpperCase();
  for (const q of ['USDT', 'USDC', 'BNB', 'ETH']) {
    if (upper.endsWith(q)) {
      const base = upper.slice(0, -q.length);
      if (base.length > 0) return { base, quote: q };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Chain ID helpers (CAIP-2 → DexScreener chainId)
// ---------------------------------------------------------------------------
function caip2ToDexChain(caip2: string): string | null {
  const map: Record<string, string> = {
    'eip155:1': 'ethereum',
    'eip155:56': 'bsc',
    'eip155:137': 'polygon',
    'eip155:43114': 'avalanche',
    'eip155:10': 'optimism',
    'eip155:42161': 'arbitrum',
    'eip155:250': 'fantom',
    'eip155:8453': 'base',
    'eip155:100': 'gnosis',
    'solana:5eykt4UsC9g2kiNkGfzE4v2gM9qzDdLuq8vRKji2iCqg': 'solana',
  };
  return map[caip2.toLowerCase()] || null;
}

// ---------------------------------------------------------------------------
// Exchange helpers
// ---------------------------------------------------------------------------
function parseBaseQuote(symbol: string): { base: string; quote: string } | null {
  const upper = symbol.toUpperCase();
  for (const q of ['USDT', 'USDC', 'USD', 'EUR', 'GBP', 'JPY', 'BTC', 'ETH']) {
    if (upper.endsWith(q)) {
      const base = upper.slice(0, -q.length);
      if (base.length > 0) return { base, quote: q };
    }
  }
  return null;
}

function timeoutSignal(secs: string): AbortSignal {
  return AbortSignal.timeout(parseInt(secs || '10', 10) * 1000);
}

// ---------------------------------------------------------------------------
// Binance
// ---------------------------------------------------------------------------
interface BinanceTicker {
  symbol: string;
  price: string;
}

async function getBinancePrice(env: Env, symbol: string): Promise<Price> {
  const url = `${env.BINANCE_BASE_URL}/api/v3/ticker/price?symbol=${symbol}`;
  const res = await fetch(url, { signal: timeoutSignal(env.REQUEST_TIMEOUT_SECS) });
  if (!res.ok) {
    throw new Error(`Binance API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as BinanceTicker;
  return {
    symbol: data.symbol,
    price: parseFloat(data.price),
    exchange: 'binance',
    timestamp: Date.now(),
    cached: false,
  };
}

// ---------------------------------------------------------------------------
// Bitget
// ---------------------------------------------------------------------------
interface BitgetResponse {
  code: string;
  msg: string;
  data: BitgetTicker[];
}

interface BitgetTicker {
  symbol: string;
  lastPr: string;
}

async function getBitgetPrice(env: Env, symbol: string): Promise<Price> {
  const url = `${env.BITGET_BASE_URL}/api/v2/spot/market/tickers?symbol=${symbol}`;
  const res = await fetch(url, { signal: timeoutSignal(env.REQUEST_TIMEOUT_SECS) });
  if (!res.ok) {
    throw new Error(`Bitget API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as BitgetResponse;
  if (data.code !== '00000') {
    throw new Error(`Bitget API error: ${data.code} - ${data.msg}`);
  }
  const ticker = data.data[0];
  if (!ticker) {
    throw new Error('No ticker data returned from Bitget');
  }
  return {
    symbol: ticker.symbol,
    price: parseFloat(ticker.lastPr),
    exchange: 'bitget',
    timestamp: Date.now(),
    cached: false,
  };
}

// ---------------------------------------------------------------------------
// API Ninjas
// ---------------------------------------------------------------------------
interface ApiNinjasResponse {
  symbol: string;
  price: string;
}

async function getApiNinjasPrice(env: Env, symbol: string): Promise<Price> {
  const parsed = parseBaseQuote(symbol);
  if (!parsed) {
    throw new Error(`Unable to parse symbol '${symbol}'. Expected format like BTCUSDT`);
  }
  const apiSymbol = `${parsed.base}${parsed.quote}`;
  const url = `${env.APININJAS_BASE_URL}/v1/cryptoprice?symbol=${apiSymbol}`;
  const res = await fetch(url, {
    headers: { 'X-Api-Key': env.APININJAS_API_KEY },
    signal: timeoutSignal(env.REQUEST_TIMEOUT_SECS),
  });
  if (!res.ok) {
    throw new Error(`API Ninjas error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as ApiNinjasResponse;
  return {
    symbol: data.symbol,
    price: parseFloat(data.price),
    exchange: 'apininjas',
    timestamp: Date.now(),
    cached: false,
  };
}

// ---------------------------------------------------------------------------
// DexScreener types
// ---------------------------------------------------------------------------
interface DexPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative: string;
  priceUsd: string | null;
  liquidity: { usd: number | null } | null;
}

interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexPair[];
}

// Find all matching pairs, sorted by liquidity desc, deduplicated by dex ID
function findMatchingPairs(pairs: DexPair[], base: string, quote: string): DexPair[] {
  const baseUpper = base.toUpperCase();
  const quoteUpper = quote.toUpperCase();

  let matching = pairs.filter(p =>
    p.baseToken.symbol.toUpperCase() === baseUpper &&
    p.quoteToken.symbol.toUpperCase() === quoteUpper,
  );

  // Sort by liquidity descending
  matching.sort((a, b) => {
    const aLiq = a.liquidity?.usd ?? 0;
    const bLiq = b.liquidity?.usd ?? 0;
    return bLiq - aLiq;
  });

  // Dedup by dex ID (keep highest liquidity = first occurrence after sort)
  const seen = new Set<string>();
  const deduped = matching.filter(p => {
    if (seen.has(p.dexId)) return false;
    seen.add(p.dexId);
    return true;
  });

  if (deduped.length > 1) {
    const dexNames = deduped.map(p => p.dexId).join(', ');
    console.log(`Found ${deduped.length} unique DEXs for ${base}/${quote}: ${dexNames}`);
  }

  return deduped;
}

// ---------------------------------------------------------------------------
// DexScreener: get single price (highest liquidity DEX)
// ---------------------------------------------------------------------------
async function getDexScreenerPrice(env: Env, symbol: string): Promise<Price> {
  const parsed = parseDexSymbol(symbol);
  if (!parsed) {
    throw new Error(`Cannot parse symbol '${symbol}'. Use BASE/QUOTE format`);
  }
  const { base, quote } = parsed;

  const query = `${base}/${quote}`;
  const url = `${env.DEXSCREENER_BASE_URL}/latest/dex/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: timeoutSignal(env.REQUEST_TIMEOUT_SECS) });
  if (!res.ok) {
    throw new Error(`DexScreener API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as DexScreenerResponse;

  const pair = findMatchingPairs(data.pairs, base, quote)[0];
  if (!pair) {
    throw new Error(`No matching pair found for ${base}/${quote} on DexScreener`);
  }

  return {
    symbol: `${pair.baseToken.symbol}${pair.quoteToken.symbol}`,
    price: parseFloat(pair.priceNative),
    exchange: `dexscreener:${pair.dexId}`,
    timestamp: Date.now(),
    cached: false,
  };
}

// ---------------------------------------------------------------------------
// DexScreener: get all DEX prices
// ---------------------------------------------------------------------------
async function getDexScreenerAllPrices(env: Env, symbol: string): Promise<Price[]> {
  const parsed = parseDexSymbol(symbol);
  if (!parsed) {
    throw new Error(`Cannot parse symbol '${symbol}'. Use BASE/QUOTE format`);
  }
  const { base, quote } = parsed;

  const query = `${base}/${quote}`;
  const url = `${env.DEXSCREENER_BASE_URL}/latest/dex/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: timeoutSignal(env.REQUEST_TIMEOUT_SECS) });
  if (!res.ok) {
    throw new Error(`DexScreener API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as DexScreenerResponse;

  const pairs = findMatchingPairs(data.pairs, base, quote);
  if (pairs.length === 0) {
    throw new Error(`No matching pair found for ${base}/${quote} on DexScreener`);
  }

  const timestamp = Date.now();
  return pairs.map(p => ({
    symbol: `${p.baseToken.symbol}${p.quoteToken.symbol}`,
    price: parseFloat(p.priceNative),
    exchange: `dexscreener:${p.dexId}`,
    timestamp,
    cached: false,
  }));
}

// ---------------------------------------------------------------------------
// DexScreener: get price by contract address
// ---------------------------------------------------------------------------
async function getDexScreenerPriceByAddress(env: Env, chain: string, address: string): Promise<Price> {
  const url = `${env.DEXSCREENER_BASE_URL}/latest/dex/tokens/${address}`;
  const res = await fetch(url, { signal: timeoutSignal(env.REQUEST_TIMEOUT_SECS) });
  if (!res.ok) {
    throw new Error(`DexScreener API error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as DexScreenerResponse;

  let pairs = data.pairs;
  if (!pairs || pairs.length === 0) {
    throw new Error(`No pairs found for address ${address}`);
  }

  // Filter by chain if specified (CAIP-2 → DexScreener chainId)
  const addrLower = address.toLowerCase();
  if (chain) {
    const dexChain = caip2ToDexChain(chain);
    if (dexChain) {
      pairs = pairs.filter(p => p.chainId.toLowerCase() === dexChain);
    }
  }

  if (pairs.length === 0) {
    throw new Error(`No pairs found for address ${address} on chain ${chain}`);
  }

  // Find pairs where the searched token is the base token
  let relevantPairs = pairs.filter(p => p.baseToken.address.toLowerCase() === addrLower);

  // If none as base token, use pairs where it's the quote token
  if (relevantPairs.length === 0) {
    relevantPairs = pairs.filter(p => p.quoteToken.address.toLowerCase() === addrLower);
  }

  // Sort by USD liquidity descending
  relevantPairs.sort((a, b) => {
    const aLiq = a.liquidity?.usd ?? 0;
    const bLiq = b.liquidity?.usd ?? 0;
    return bLiq - aLiq;
  });

  // Dedup by dex ID (keep highest liquidity)
  const seen = new Set<string>();
  const deduped = relevantPairs.filter(p => {
    if (seen.has(p.dexId)) return false;
    seen.add(p.dexId);
    return true;
  });

  const best = deduped[0];
  if (!best) {
    throw new Error(`No matching pair found for address ${address}`);
  }

  const isBase = best.baseToken.address.toLowerCase() === addrLower;
  const tokenSymbol = isBase ? best.baseToken.symbol : best.quoteToken.symbol;
  const priceUsd = best.priceUsd ? parseFloat(best.priceUsd) : null;

  return {
    symbol: tokenSymbol,
    price: priceUsd ?? parseFloat(best.priceNative),
    exchange: `dexscreener:${best.dexId}`,
    timestamp: Date.now(),
    cached: false,
    chain,
    contractAddress: address,
  };
}

// ---------------------------------------------------------------------------
// Cache instance (per-Worker isolate)
// ---------------------------------------------------------------------------
let priceCache: PriceCache | undefined;

export function resetCache(): void {
  priceCache = undefined;
}

function getCache(env: Env): PriceCache {
  if (!priceCache) {
    priceCache = new PriceCache(
      parseInt(env.PRICE_CACHE_TTL_CEX || '10', 10),
      parseInt(env.PRICE_CACHE_TTL_DEX || '30', 10),
    );
  }
  return priceCache;
}

// ---------------------------------------------------------------------------
// Exchange list
// ---------------------------------------------------------------------------
interface ExchangeClient {
  name: string;
  enabled: (env: Env) => boolean;
  getPrice: (env: Env, symbol: string) => Promise<Price>;
  getAllPrices: (env: Env, symbol: string) => Promise<Price[]>;
}

const EXCHANGES: ExchangeClient[] = [
  {
    name: 'binance',
    enabled: (env) => env.ENABLE_BINANCE === 'true',
    getPrice: getBinancePrice,
    getAllPrices: async (env, symbol) => [await getBinancePrice(env, symbol)],
  },
  {
    name: 'bitget',
    enabled: (env) => env.ENABLE_BITGET === 'true',
    getPrice: getBitgetPrice,
    getAllPrices: async (env, symbol) => [await getBitgetPrice(env, symbol)],
  },
  {
    name: 'apininjas',
    enabled: (env) => env.ENABLE_APININJAS === 'true',
    getPrice: getApiNinjasPrice,
    getAllPrices: async (env, symbol) => [await getApiNinjasPrice(env, symbol)],
  },
  {
    name: 'dexscreener',
    enabled: (env) => env.ENABLE_DEXSCREENER === 'true',
    getPrice: getDexScreenerPrice,
    getAllPrices: getDexScreenerAllPrices,
  },
];

// ---------------------------------------------------------------------------
// Hono app
// ---------------------------------------------------------------------------
const app = new Hono<{ Bindings: Env }>();

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
  maxAge: 86400,
}));

// Health check — matches price-oracle Rust route
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
  } satisfies HealthResponse);
});

// Price query
// GET /api/v1/price?symbol=BTCUSDT&exchange=binance
// GET /api/v1/price?symbol=BTCUSDT
// GET /api/v1/price?base=BTC&quote=USDT&exchange=binance
// GET /api/v1/price?address=0x...&chain=eip155:1
app.get('/api/v1/price', async (c) => {
  const params = c.req.query() as PriceRequest;

  // Contract address query — uses DexScreener directly
  if (params.address) {
    if (!c.env.ENABLE_DEXSCREENER || c.env.ENABLE_DEXSCREENER !== 'true') {
      return c.json({ success: false, error: 'DexScreener is disabled' } satisfies PriceResponse, 400);
    }
    try {
      const price = await getDexScreenerPriceByAddress(c.env, params.chain || '', params.address);
      return c.json({ success: true, data: price } satisfies PriceResponse);
    } catch (err) {
      return c.json({ success: false, error: (err as Error).message } satisfies PriceResponse, 500);
    }
  }

  // Parse symbol
  const parsed = getParsedSymbol(params);
  if ('error' in parsed) {
    return c.json({ success: false, error: parsed.error } satisfies PriceResponse, 400);
  }
  const { symbol } = parsed;

  const cache = getCache(c.env);

  // Single exchange query
  if (params.exchange) {
    const exchangeName = params.exchange.toLowerCase();

    // Check cache first (CEX path)
    const cached = exchangeName === 'dexscreener'
      ? undefined
      : cache.get(exchangeName, symbol);
    if (cached) {
      return c.json({ success: true, data: cached } satisfies PriceResponse);
    }

    // DexScreener cache check
    if (exchangeName === 'dexscreener') {
      const dexCached = cache.getDexPrices(symbol);
      if (dexCached && dexCached.length > 0) {
        return c.json({ success: true, data: dexCached[0] } satisfies PriceResponse);
      }
    }

    // Find exchange
    const client = EXCHANGES.find(e => e.name === exchangeName);
    if (!client || !client.enabled(c.env)) {
      return c.json({
        success: false,
        error: `Exchange '${exchangeName}' not found`,
      } satisfies PriceResponse, 400);
    }

    try {
      const price = await client.getPrice(c.env, symbol);
      cache.set(exchangeName, symbol, price);
      return c.json({ success: true, data: price } satisfies PriceResponse);
    } catch (err) {
      // Fallback: try stale cache for error case
      if (exchangeName !== 'dexscreener') {
        const stale = cache.get(exchangeName, symbol);
        if (stale) return c.json({ success: true, data: stale } satisfies PriceResponse);
      }
      return c.json({
        success: false,
        error: (err as Error).message,
      } satisfies PriceResponse, 500);
    }
  }

  // All exchanges query
  const prices: Price[] = [];
  const errors: string[] = [];

  for (const client of EXCHANGES) {
    if (!client.enabled(c.env)) continue;

    const exchangeName = client.name;

    // Check cache
    if (exchangeName === 'dexscreener') {
      const dexCached = cache.getDexPrices(symbol);
      if (dexCached) {
        prices.push(...dexCached);
        continue;
      }
    } else {
      const cached = cache.get(exchangeName, symbol);
      if (cached) {
        prices.push(cached);
        continue;
      }
    }

    // API call
    try {
      const allPrices = await client.getAllPrices(c.env, symbol);
      if (exchangeName === 'dexscreener') {
        cache.setDexPrices(symbol, allPrices);
        prices.push(...allPrices);
      } else {
        for (const p of allPrices) {
          cache.set(exchangeName, symbol, p);
          prices.push(p);
        }
      }
    } catch (err) {
      // Fallback to stale cache
      if (exchangeName === 'dexscreener') {
        const dexCached = cache.getDexPrices(symbol);
        if (dexCached) {
          prices.push(...dexCached);
        } else {
          errors.push(`${exchangeName}: ${(err as Error).message}`);
        }
      } else {
        const stale = cache.get(exchangeName, symbol);
        if (stale) {
          prices.push(stale);
        } else {
          errors.push(`${exchangeName}: ${(err as Error).message}`);
        }
      }
    }
  }

  if (prices.length === 0) {
    // Omit `data` when empty — matches Rust's skip_serializing_if = "Vec::is_empty"
    return c.json({ success: false, error: errors.join('; ') }, 500);
  }

  return c.json({
    success: true,
    data: prices,
  } satisfies MultiPriceResponse);
});

// ---------------------------------------------------------------------------
// Batch price query
// POST /api/v1/price/batch
// Body: { tokens: [{ symbol: "ETH" }, { chain: "eip155:1", address: "0x..." }] }
// ---------------------------------------------------------------------------
app.post('/api/v1/price/batch', async (c) => {
  let body: BatchPriceRequestBody;
  try {
    body = await c.req.json<BatchPriceRequestBody>();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }

  if (!body.tokens || !Array.isArray(body.tokens) || body.tokens.length === 0) {
    return c.json({ success: false, error: 'tokens array is required' }, 400);
  }

  const results = await Promise.allSettled(
    body.tokens.map(async (item) => {
      // Address-based: use DexScreener
      if (item.address) {
        if (!c.env.ENABLE_DEXSCREENER || c.env.ENABLE_DEXSCREENER !== 'true') {
          return { success: false as const, error: 'DexScreener is disabled', request: { symbol: item.symbol, chain: item.chain, address: item.address } };
        }
        const price = await getDexScreenerPriceByAddress(c.env, item.chain || '', item.address);
        return { success: true as const, data: price, request: { symbol: item.symbol, chain: item.chain, address: item.address } };
      }

      // Symbol-based: use Binance (fastest CEX)
      const parsed = getParsedSymbol(item);
      if ('error' in parsed) {
        return { success: false as const, error: parsed.error, request: { symbol: item.symbol } };
      }
      const price = await getBinancePrice(c.env, parsed.symbol);
      return { success: true as const, data: price, request: { symbol: price.symbol } };
    }),
  );

  const data: BatchPriceResponseItem[] = results.map((r) => {
    if (r.status === 'fulfilled') return r.value;
    return { success: false, error: (r.reason as Error)?.message || 'Unknown error', request: {} };
  });

  return c.json({ success: true, data });
});

// ---------------------------------------------------------------------------
// Export for Cloudflare Worker
// ---------------------------------------------------------------------------
export default {
  fetch: app.fetch,
};
