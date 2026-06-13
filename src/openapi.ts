export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Price Feed Gateway',
    description: 'Cryptocurrency price aggregation proxy. Aggregates prices from Binance, Bitget, API Ninjas, and DexScreener. Supports symbol-based queries and contract address lookups.',
    version: '0.1.0',
  },
  servers: [
    { url: 'https://price-feed.bithub.pro', description: 'Production' },
    { url: 'http://localhost:8787', description: 'Local dev' },
  ],
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        tags: ['System'],
        responses: {
          '200': {
            description: 'Service healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'healthy' },
                    timestamp: { type: 'string', format: 'date-time' },
                    version: { type: 'string', example: '0.1.0' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/price': {
      get: {
        summary: 'Get cryptocurrency price',
        description: 'Query price by trading pair symbol or by token contract address. Supports single exchange or all exchanges.',
        tags: ['Price'],
        parameters: [
          {
            name: 'symbol',
            in: 'query',
            description: 'Trading pair symbol (e.g. BTCUSDT)',
            schema: { type: 'string' },
            example: 'BTCUSDT',
          },
          {
            name: 'base',
            in: 'query',
            description: 'Base currency (e.g. BTC). Requires quote param.',
            schema: { type: 'string' },
            example: 'BTC',
          },
          {
            name: 'quote',
            in: 'query',
            description: 'Quote currency (e.g. USDT). Requires base param.',
            schema: { type: 'string' },
            example: 'USDT',
          },
          {
            name: 'address',
            in: 'query',
            description: 'Token contract address for DexScreener lookup.',
            schema: { type: 'string' },
            example: '0xdac17f958d2ee523a2206206994597c13d831ec7',
          },
          {
            name: 'chain',
            in: 'query',
            description: 'CAIP-2 chain identifier (e.g. eip155:1). Used with address param to filter by chain.',
            schema: { type: 'string' },
            example: 'eip155:1',
          },
          {
            name: 'exchange',
            in: 'query',
            description: 'Exchange name filter. Supported: binance, bitget, apininjas, dexscreener. Omit to return all exchanges.',
            schema: { type: 'string' },
            example: 'binance',
          },
        ],
        responses: {
          '200': {
            description: 'Price data',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      oneOf: [
                        { $ref: '#/components/schemas/Price' },
                        {
                          type: 'array',
                          items: { $ref: '#/components/schemas/Price' },
                        },
                      ],
                    },
                    error: { type: 'string' },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Bad request',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: { type: 'string' },
                  },
                },
              },
            },
          },
          '500': {
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/v1/price/batch': {
      post: {
        summary: 'Batch query prices for multiple tokens',
        description: 'Query prices for multiple tokens in a single request. Supports mixed symbol and address-based queries.',
        tags: ['Price'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tokens'],
                properties: {
                  tokens: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/TokenRequest' },
                    minItems: 1,
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Batch results',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/BatchResultItem' },
                    },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Bad request',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    error: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Price: {
        type: 'object',
        properties: {
          symbol: { type: 'string', example: 'BTCUSDT', description: 'Trading pair symbol' },
          price: { type: 'number', example: 65432.10, description: 'Price in quote currency or USD for address queries' },
          exchange: { type: 'string', example: 'binance', description: 'Exchange name' },
          timestamp: { type: 'integer', example: 1696161600000, description: 'Unix timestamp in milliseconds' },
          cached: { type: 'boolean', example: false, description: 'Whether the price was served from cache' },
          chain: { type: 'string', example: 'eip155:1', description: 'CAIP-2 chain identifier (address queries only)' },
          contractAddress: { type: 'string', example: '0xdac17f958d2ee523a2206206994597c13d831ec7', description: 'Token contract address (address queries only)' },
        },
      },
      TokenRequest: {
        type: 'object',
        description: 'Token query by symbol or contract address. Provide either symbol or address.',
        properties: {
          symbol: { type: 'string', example: 'ETH', description: 'Token symbol (e.g. ETH, BTC)' },
          base: { type: 'string', example: 'BTC', description: 'Base currency (requires quote)' },
          quote: { type: 'string', example: 'USDT', description: 'Quote currency (requires base)' },
          address: { type: 'string', example: '0xdac17f958d2ee523a2206206994597c13d831ec7', description: 'Token contract address' },
          chain: { type: 'string', example: 'eip155:1', description: 'CAIP-2 chain identifier for address queries' },
        },
      },
      BatchResultItem: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { $ref: '#/components/schemas/Price' },
          error: { type: 'string' },
          request: {
            type: 'object',
            properties: {
              symbol: { type: 'string' },
              chain: { type: 'string' },
              address: { type: 'string' },
            },
          },
        },
      },
    },
  },
} as const;
