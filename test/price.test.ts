import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
async function createApp() {
  const mod = await import('../src/index');
  return mod.default;
}

async function resetCache() {
  const mod = await import('../src/index');
  mod.resetCache?.();
}

const mockEnv = {
  BINANCE_BASE_URL: 'https://api.binance.com',
  BITGET_BASE_URL: 'https://api.bitget.com',
  APININJAS_BASE_URL: 'https://api.api-ninjas.com',
  DEXSCREENER_BASE_URL: 'https://api.dexscreener.com',
  ENABLE_BINANCE: 'true',
  ENABLE_BITGET: 'true',
  ENABLE_APININJAS: 'true',
  ENABLE_DEXSCREENER: 'true',
  PRICE_CACHE_TTL_CEX: '10',
  PRICE_CACHE_TTL_DEX: '30',
  REQUEST_TIMEOUT_SECS: '10',
  APININJAS_API_KEY: 'test-key',
};

function mockRequest(method: string, url: string): Request {
  return new Request(url, { method });
}

// Extract URL string from fetch arguments (handles Request, URL, string)
function getUrlString(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof Request) return input.url;
  if (input instanceof URL) return input.href;
  return String(input);
}

function binanceMockResponse(symbol = 'BTCUSDT', price = '65432.10') {
  return new Response(JSON.stringify({ symbol, price }), { status: 200 });
}

function bitgetMockResponse(symbol = 'BTCUSDT', price = '65430.50') {
  return new Response(JSON.stringify({
    code: '00000',
    msg: '',
    data: [{ symbol, lastPr: price }],
  }), { status: 200 });
}

function apininjasMockResponse(symbol = 'BTCUSD', price = '65432.10') {
  return new Response(JSON.stringify({ symbol, price }), { status: 200 });
}

function dexscreenerMockResponse() {
  return new Response(JSON.stringify({
    schemaVersion: '1.0',
    pairs: [{
      chainId: 'bsc',
      dexId: 'pancakeswap',
      url: 'https://example.com',
      pairAddress: '0x123',
      baseToken: { address: '0xabc', name: 'Bitcoin', symbol: 'BTC' },
      quoteToken: { address: '0xdef', name: 'Tether', symbol: 'USDT' },
      priceNative: '65432.10',
      priceUsd: '65432.10',
      liquidity: { usd: 10000000 },
    }],
  }), { status: 200 });
}

// Route mock responses by URL pattern
function multiExchangeMock() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
    const url = getUrlString(input);
    if (url.includes('binance')) return binanceMockResponse();
    if (url.includes('bitget')) return bitgetMockResponse();
    if (url.includes('ninjas')) return apininjasMockResponse();
    if (url.includes('dexscreener')) return dexscreenerMockResponse();
    return new Response('Not found', { status: 404 });
  });
}

function dexscreenerMultiDexMock() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
    const url = getUrlString(input);
    if (url.includes('binance')) return binanceMockResponse();
    if (url.includes('bitget')) return bitgetMockResponse();
    if (url.includes('ninjas')) return apininjasMockResponse();
    if (url.includes('dexscreener')) {
      return new Response(JSON.stringify({
        schemaVersion: '1.0',
        pairs: [
          {
            chainId: 'bsc',
            dexId: 'pancakeswap',
            url: 'https://example.com',
            pairAddress: '0x1',
            baseToken: { address: '0xa', name: 'Aster', symbol: 'ASTER' },
            quoteToken: { address: '0xb', name: 'USDT', symbol: 'USDT' },
            priceNative: '1.61',
            priceUsd: '1.61',
            liquidity: { usd: 100000 },
          },
          {
            chainId: 'bsc',
            dexId: 'biswap',
            url: 'https://example.com',
            pairAddress: '0x2',
            baseToken: { address: '0xa', name: 'Aster', symbol: 'ASTER' },
            quoteToken: { address: '0xb', name: 'USDT', symbol: 'USDT' },
            priceNative: '1.60',
            priceUsd: '1.60',
            liquidity: { usd: 50000 },
          },
        ],
      }), { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  });
}

// ---------------------------------------------------------------------------
// Global: reset cache before each test
// ---------------------------------------------------------------------------
beforeEach(async () => {
  await resetCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
describe('GET /health', () => {
  it('should return healthy status', async () => {
    const app = await createApp();
    const res = await app.fetch(mockRequest('GET', 'http://localhost/health'), mockEnv);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.timestamp).toBeDefined();
    expect(body.version).toBe('0.1.0');
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------
describe('GET /api/v1/price - input validation', () => {
  it('should return 400 if neither symbol nor base/quote provided', async () => {
    const app = await createApp();
    const res = await app.fetch(mockRequest('GET', 'http://localhost/api/v1/price'), mockEnv);
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('symbol');
  });

  it('should return 400 for unknown exchange', async () => {
    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT&exchange=unknownx'),
      mockEnv,
    );
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toContain('unknownx');
  });
});

// ---------------------------------------------------------------------------
// Single exchange: Binance
// ---------------------------------------------------------------------------
describe('GET /api/v1/price - single exchange (Binance)', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(binanceMockResponse());
  });

  it('should fetch price from Binance', async () => {
    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT&exchange=binance'),
      mockEnv,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.symbol).toBe('BTCUSDT');
    expect(body.data.price).toBe(65432.10);
    expect(body.data.exchange).toBe('binance');
    expect(body.data.timestamp).toBeDefined();
    expect(body.data.cached).toBe(false);
  });

  it('should use base/quote format', async () => {
    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?base=BTC&quote=USDT&exchange=binance'),
      mockEnv,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.symbol).toBe('BTCUSDT');
  });

  it('should return cached response on second request', async () => {
    const app = await createApp();
    // First request populates cache
    await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT&exchange=binance'),
      mockEnv,
    );
    vi.restoreAllMocks();

    // Second request — should use cache, not call API
    const res2 = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT&exchange=binance'),
      mockEnv,
    );
    expect(res2.status).toBe(200);
    const body: any = await res2.json();
    expect(body.data.cached).toBe(true);
  });

  it('should return stale cache on API error', async () => {
    const app = await createApp();
    // First request populates cache
    await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT&exchange=binance'),
      mockEnv,
    );
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT&exchange=binance'),
      mockEnv,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.cached).toBe(true);
  });

  it('should fail on API error without cache', async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT&exchange=binance'),
      mockEnv,
    );
    expect(res.status).toBe(500);
    const body: any = await res.json();
    expect(body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Single exchange: Bitget
// ---------------------------------------------------------------------------
describe('GET /api/v1/price - single exchange (Bitget)', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(bitgetMockResponse());
  });

  it('should fetch price from Bitget', async () => {
    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT&exchange=bitget'),
      mockEnv,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.symbol).toBe('BTCUSDT');
    expect(body.data.price).toBe(65430.50);
    expect(body.data.exchange).toBe('bitget');
  });

  it('should handle Bitget API with non-00000 code', async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: '40001', msg: 'Invalid param', data: [] }), { status: 200 }),
    );

    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT&exchange=bitget'),
      mockEnv,
    );
    expect(res.status).toBe(500);
    const body: any = await res.json();
    expect(body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Single exchange: API Ninjas
// ---------------------------------------------------------------------------
describe('GET /api/v1/price - single exchange (API Ninjas)', () => {
  it('should include X-Api-Key header in API Ninjas requests', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> | undefined;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown, opts?: unknown) => {
      capturedUrl = getUrlString(input);
      capturedHeaders = (opts as RequestInit)?.headers as Record<string, string>;
      return apininjasMockResponse();
    });

    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT&exchange=apininjas'),
      mockEnv,
    );

    expect(res.status).toBe(200);
    expect(capturedUrl).toContain('api-ninjas.com');
    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders!['X-Api-Key'] || capturedHeaders!['x-api-key']).toBe('test-key');
  });

  it('should fetch price from API Ninjas', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(apininjasMockResponse());
    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT&exchange=apininjas'),
      mockEnv,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.exchange).toBe('apininjas');
  });

  it('should fail on unsupported symbol format', async () => {
    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=XXX&exchange=apininjas'),
      mockEnv,
    );
    expect(res.status).toBe(500);
    const body: any = await res.json();
    expect(body.error).toContain('Unable to parse symbol');
  });
});

// ---------------------------------------------------------------------------
// Single exchange: DexScreener
// ---------------------------------------------------------------------------
describe('GET /api/v1/price - single exchange (DexScreener)', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(dexscreenerMockResponse());
  });

  it('should fetch price from DexScreener', async () => {
    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT&exchange=dexscreener'),
      mockEnv,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.exchange).toContain('dexscreener:');
    expect(body.data.cached).toBe(false);
  });

  it('should handle BASE/QUOTE format', async () => {
    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTC/USDT&exchange=dexscreener'),
      mockEnv,
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// All exchanges (no exchange param)
// ---------------------------------------------------------------------------
describe('GET /api/v1/price - all exchanges', () => {
  beforeEach(() => {
    multiExchangeMock();
  });

  it('should return prices from all enabled exchanges', async () => {
    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT'),
      mockEnv,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(4);

    const exchanges = body.data.map((p: any) => p.exchange);
    expect(exchanges).toContain('binance');
    expect(exchanges).toContain('bitget');
    expect(exchanges).toContain('apininjas');
    expect(exchanges.some((e: string) => e.startsWith('dexscreener:'))).toBe(true);
  });

  it('should respect exchange enable/disable flags', async () => {
    const disabledEnv = { ...mockEnv, ENABLE_BITGET: 'false', ENABLE_APININJAS: 'false' };
    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT'),
      disabledEnv,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const exchanges = body.data.map((p: any) => p.exchange);
    expect(exchanges).not.toContain('bitget');
    expect(exchanges).not.toContain('apininjas');
    expect(exchanges).toContain('binance');
  });

  it('should fall back to cache when API fails', async () => {
    const app = await createApp();
    // First request populates cache
    await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT'),
      mockEnv,
    );

    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('API unavailable'));

    const res2 = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT'),
      mockEnv,
    );
    expect(res2.status).toBe(200);
    const body: any = await res2.json();
    expect(body.success).toBe(true);
    for (const price of body.data) {
      expect(price.cached).toBe(true);
    }
  });

  it('should return 500 if all exchanges fail and no cache', async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('All APIs down'));

    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT'),
      mockEnv,
    );
    expect(res.status).toBe(500);
    const body: any = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
  });

  it('should handle all exchanges disabled', async () => {
    const disabledEnv = {
      ...mockEnv,
      ENABLE_BINANCE: 'false',
      ENABLE_BITGET: 'false',
      ENABLE_APININJAS: 'false',
      ENABLE_DEXSCREENER: 'false',
    };
    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT'),
      disabledEnv,
    );
    expect(res.status).toBe(500);
    const body: any = await res.json();
    expect(body.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DexScreener multi-DEX
// ---------------------------------------------------------------------------
describe('DexScreener - multi-DEX support', () => {
  beforeEach(() => {
    dexscreenerMultiDexMock();
  });

  it('should return multiple DEX prices', async () => {
    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=ASTERUSDT'),
      mockEnv,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    const dexPrices = body.data.filter((p: any) => p.exchange.startsWith('dexscreener:'));
    expect(dexPrices.length).toBe(2);
    expect(dexPrices.map((p: any) => p.exchange).sort()).toEqual([
      'dexscreener:biswap',
      'dexscreener:pancakeswap',
    ]);
  });

  it('should dedup DEX IDs and keep highest liquidity', async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
      const url = getUrlString(input);
      if (url.includes('binance')) return binanceMockResponse();
      if (url.includes('bitget')) return bitgetMockResponse();
      if (url.includes('ninjas')) return apininjasMockResponse();
      if (url.includes('dexscreener')) {
        return new Response(JSON.stringify({
          schemaVersion: '1.0',
          pairs: [
            {
              chainId: 'bsc',
              dexId: 'pancakeswap',
              url: 'https://example.com',
              pairAddress: '0x1',
              baseToken: { address: '0xa', name: 'Aster', symbol: 'ASTER' },
              quoteToken: { address: '0xb', name: 'USDT', symbol: 'USDT' },
              priceNative: '1.60',
              priceUsd: '1.60',
              liquidity: { usd: 50000 },
            },
            {
              chainId: 'bsc',
              dexId: 'pancakeswap',
              url: 'https://example.com',
              pairAddress: '0x2',
              baseToken: { address: '0xa', name: 'Aster', symbol: 'ASTER' },
              quoteToken: { address: '0xb', name: 'USDT', symbol: 'USDT' },
              priceNative: '1.62',
              priceUsd: '1.62',
              liquidity: { usd: 100000 },
            },
          ],
        }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });

    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=ASTERUSDT'),
      mockEnv,
    );
    const body: any = await res.json();
    const dexPrices = body.data.filter((p: any) => p.exchange.startsWith('dexscreener:'));
    expect(dexPrices.length).toBe(1);
    expect(dexPrices[0].exchange).toBe('dexscreener:pancakeswap');
  });
});

// ---------------------------------------------------------------------------
// DexScreener token address mock
// ---------------------------------------------------------------------------
function dexscreenerTokenAddressMock() {
  const addrLower = '0xdac17f958d2ee523a2206206994597c13d831ec7';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: unknown) => {
    const url = getUrlString(input);
    if (url.includes('dexscreener') && url.includes('/tokens/')) {
      return new Response(JSON.stringify({
        schemaVersion: '1.0',
        pairs: [
          {
            chainId: 'ethereum',
            dexId: 'uniswap',
            url: 'https://example.com',
            pairAddress: '0xpair1',
            baseToken: { address: addrLower, name: 'Tether USD', symbol: 'USDT' },
            quoteToken: { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', name: 'Wrapped Ether', symbol: 'WETH' },
            priceNative: '0.0005',
            priceUsd: '1.00',
            liquidity: { usd: 50000000 },
          },
          {
            chainId: 'bsc',
            dexId: 'pancakeswap',
            url: 'https://example.com',
            pairAddress: '0xpair2',
            baseToken: { address: '0x55d398326f99059ff775485246999027b3197955', name: 'Tether USD', symbol: 'USDT' },
            quoteToken: { address: addrLower, name: 'Tether USD', symbol: 'USDT' },
            priceNative: '1',
            priceUsd: '1.00',
            liquidity: { usd: 100000000 },
          },
          {
            chainId: 'bsc',
            dexId: 'pancakeswap',
            url: 'https://example.com',
            pairAddress: '0xpair3',
            baseToken: { address: addrLower, name: 'Tether USD', symbol: 'USDT' },
            quoteToken: { address: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', name: 'Wrapped BNB', symbol: 'WBNB' },
            priceNative: '0.002',
            priceUsd: '1.00',
            liquidity: { usd: 80000000 },
          },
        ],
      }), { status: 200 });
    }
    if (url.includes('binance')) return binanceMockResponse();
    if (url.includes('bitget')) return bitgetMockResponse();
    if (url.includes('ninjas')) return apininjasMockResponse();
    if (url.includes('dexscreener')) return dexscreenerMockResponse();
    return new Response('Not found', { status: 404 });
  });
}

// ---------------------------------------------------------------------------
// Address-based queries (GET)
// ---------------------------------------------------------------------------
describe('GET /api/v1/price - address query', () => {
  beforeEach(() => {
    dexscreenerTokenAddressMock();
  });

  it('should return price for a token address', async () => {
    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?address=0xdac17f958d2ee523a2206206994597c13d831ec7'),
      mockEnv,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.contractAddress).toBe('0xdac17f958d2ee523a2206206994597c13d831ec7');
    expect(body.data.price).toBe(1.00);
    expect(body.data.exchange).toContain('dexscreener:');
  });

  it('should filter by chain', async () => {
    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?chain=eip155:1&address=0xdac17f958d2ee523a2206206994597c13d831ec7'),
      mockEnv,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.chain).toBe('eip155:1');
    expect(body.data.exchange).toContain('uniswap');
  });

  it('should return 400 when DexScreener is disabled', async () => {
    const disabledEnv = { ...mockEnv, ENABLE_DEXSCREENER: 'false' };
    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?address=0xdac17f958d2ee523a2206206994597c13d831ec7'),
      disabledEnv,
    );
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toContain('disabled');
  });
});

// ---------------------------------------------------------------------------
// Batch price query (POST)
// ---------------------------------------------------------------------------
describe('POST /api/v1/price/batch', () => {
  beforeEach(() => {
    dexscreenerTokenAddressMock();
  });

  it('should return prices for multiple tokens', async () => {
    const app = await createApp();
    const res = await app.fetch(
      new Request('http://localhost/api/v1/price/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokens: [
            { symbol: 'BTC' },
            { chain: 'eip155:1', address: '0xdac17f958d2ee523a2206206994597c13d831ec7' },
          ],
        }),
      }),
      mockEnv,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(2);

    // Symbol-based result (from Binance)
    const symbolResult = body.data[0];
    expect(symbolResult.success).toBe(true);
    expect(symbolResult.data.price).toBeDefined();

    // Address-based result (from DexScreener)
    const addressResult = body.data[1];
    expect(addressResult.success).toBe(true);
    expect(addressResult.data.contractAddress).toBe('0xdac17f958d2ee523a2206206994597c13d831ec7');
    expect(addressResult.data.price).toBe(1.00);
  });

  it('should return 400 for empty tokens array', async () => {
    const app = await createApp();
    const res = await app.fetch(
      new Request('http://localhost/api/v1/price/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokens: [] }),
      }),
      mockEnv,
    );
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toContain('tokens array is required');
  });

  it('should return 400 for invalid JSON', async () => {
    const app = await createApp();
    const res = await app.fetch(
      new Request('http://localhost/api/v1/price/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
      mockEnv,
    );
    expect(res.status).toBe(400);
  });

  it('should handle address query errors gracefully', async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'));

    const app = await createApp();
    const res = await app.fetch(
      new Request('http://localhost/api/v1/price/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tokens: [
            { symbol: 'ETH' },
            { chain: 'eip155:1', address: '0x1234567890123456789012345678901234567890' },
          ],
        }),
      }),
      mockEnv,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    // Symbol-based should fail (network error)
    // Address-based should also fail
    expect(body.data.length).toBe(2);
    expect(body.data.some((r: any) => r.success === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
describe('CORS headers', () => {
  it('should include CORS headers in responses', async () => {
    const app = await createApp();
    const res = await app.fetch(mockRequest('GET', 'http://localhost/health'), mockEnv);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('should respond to OPTIONS preflight', async () => {
    const app = await createApp();
    const res = await app.fetch(
      new Request('http://localhost/api/v1/price', { method: 'OPTIONS' }),
      mockEnv,
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-max-age')).toBe('86400');
  });
});

// ---------------------------------------------------------------------------
// Single exchange error edge cases
// ---------------------------------------------------------------------------
describe('Single exchange error handling', () => {
  it('should return 500 when Binance returns non-200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Rate limited', { status: 429 }),
    );
    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT&exchange=binance'),
      mockEnv,
    );
    expect(res.status).toBe(500);
    const body: any = await res.json();
    expect(body.error).toContain('429');
  });

  it('should return 400 when exchange is disabled', async () => {
    const disabledEnv = { ...mockEnv, ENABLE_BINANCE: 'false' };
    const app = await createApp();
    const res = await app.fetch(
      mockRequest('GET', 'http://localhost/api/v1/price?symbol=BTCUSDT&exchange=binance'),
      disabledEnv,
    );
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toContain('not found');
  });
});
