# Price Feed Gateway

基于 Cloudflare Workers 的加密货币价格聚合网关服务（TypeScript/Hono 版）。

原 Rust/Axum 版本：[price-oracle-gateway](https://github.com/deng/price-oracle-gateway.git)

## 功能特性

- 📊 支持多个交易所/数据源价格查询
  - Binance（支持数千种加密货币交易对）
  - Bitget（全球领先的加密货币交易所）
  - API Ninjas（支持主流加密货币价格）
  - DexScreener（DEX 聚合器，支持多链 DEX 价格查询）
- 🔄 智能多 DEX 支持
  - 自动检测交易对在多个 DEX 的存在
  - 基于流动性自动选择最优 DEX
  - 透明日志记录所有可用 DEX
- ⚡ 智能缓存机制
  - 10 秒 TTL 价格缓存（中心化交易所）
  - 30 秒 TTL 价格缓存（DexScreener）
  - API 失败时降级到过期缓存
  - 缓存状态透明标识
- 🌐 全球边缘节点部署（Cloudflare Workers）
- 🏥 健康检查端点

## 快速开始

### 前置要求

- Node.js 18+
- npm
- Cloudflare 账户（用于部署）

### 安装

```bash
npm install
```

### 本地开发

```bash
# 创建环境变量文件
cp .env.example .env

# 启动开发服务器（默认 :8787）
npm run dev
```

Secrets 放在 `.dev.vars` 文件中：
```
APININJAS_API_KEY=your-api-key
```

### 部署

```bash
# 设置生产环境 secrets
npx wrangler secret put APININJAS_API_KEY

# 部署
npm run deploy
```

## API 文档

### 健康检查

```
GET /health
```

**响应：**
```json
{
  "status": "healthy",
  "timestamp": "2025-10-01T10:00:00.000Z",
  "version": "0.1.0"
}
```

### 获取价格

支持两种查询方式：

#### 方式 1：使用交易对符号

```
GET /api/v1/price?symbol=BTCUSDT&exchange=binance
```

**参数：**
- `symbol`（必需）：交易对符号，例如 `BTCUSDT`
- `exchange`（可选）：交易所名称，支持 `binance`、`bitget`、`apininjas`、`dexscreener`

#### 方式 2：使用基础货币和报价货币

```
GET /api/v1/price?base=BTC&quote=USDT&exchange=binance
```

**参数：**
- `base`（必需）：基础货币符号，例如 `BTC`
- `quote`（必需）：报价货币符号，例如 `USDT`
- `exchange`（可选）：交易所名称

**注意：** 必须提供 `symbol` 或同时提供 `base` 和 `quote`。如果两者都提供，优先使用 `base` 和 `quote`。

#### 单交易所响应

```json
{
  "success": true,
  "data": {
    "symbol": "BTCUSDT",
    "price": 43250.50,
    "exchange": "binance",
    "timestamp": 1696161600000,
    "cached": false
  }
}
```

#### 全部交易所响应

```json
{
  "success": true,
  "data": [
    {
      "symbol": "BTCUSDT",
      "price": 43250.50,
      "exchange": "binance",
      "timestamp": 1696161600000,
      "cached": false
    },
    {
      "symbol": "BTCUSDT",
      "price": 43248.20,
      "exchange": "bitget",
      "timestamp": 1696161600000,
      "cached": false
    }
  ]
}
```

## 配置

通过 `wrangler.toml` 和 `wrangler secret` 配置：

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `BINANCE_BASE_URL` | string | `https://api.binance.com` | Binance API 地址 |
| `BITGET_BASE_URL` | string | `https://api.bitget.com` | Bitget API 地址 |
| `APININJAS_BASE_URL` | string | `https://api.api-ninjas.com` | API Ninjas 地址 |
| `DEXSCREENER_BASE_URL` | string | `https://api.dexscreener.com` | DexScreener 地址 |
| `ENABLE_BINANCE` | bool | `true` | 启用 Binance |
| `ENABLE_BITGET` | bool | `true` | 启用 Bitget |
| `ENABLE_APININJAS` | bool | `true` | 启用 API Ninjas |
| `ENABLE_DEXSCREENER` | bool | `true` | 启用 DexScreener |
| `PRICE_CACHE_TTL_CEX` | number | `10` | CEX 缓存 TTL（秒） |
| `PRICE_CACHE_TTL_DEX` | number | `30` | DexScreener 缓存 TTL（秒） |
| `REQUEST_TIMEOUT_SECS` | number | `10` | API 请求超时（秒） |
| `APININJAS_API_KEY` | string | (secret) | API Ninjas API Key |

## 命令

```bash
npm run dev          # 本地开发
npm run deploy       # 部署到 Cloudflare
npm test             # 运行测试（26 个测试）
npm run typecheck    # 类型检查
npm run test:watch   # 监听模式测试
```

## 项目结构

```
price-feed/
├── src/
│   └── index.ts         # Hono app + 所有业务逻辑
├── test/
│   └── price.test.ts    # Vitest 测试
├── wrangler.toml        # Cloudflare Workers 配置
├── CLAUDE.md
└── package.json
```

## 数据源

### Binance
- 支持数千种加密货币交易对
- API：`https://api.binance.com/api/v3/ticker/price`
- 无需 API Key

### Bitget
- 全球领先的加密货币衍生品交易所
- API：`https://api.bitget.com/api/v2/spot/market/tickers`
- 无需 API Key

### API Ninjas
- 支持主流加密货币价格查询
- API：`https://api.api-ninjas.com/v1/cryptoprice`
- **需要 API Key**（从 https://api-ninjas.com 获取）

### DexScreener
- DEX 聚合器，支持多链去中心化交易所价格
- 按 USD 流动性自动选择最优 DEX
- 支持 Ethereum、BSC、Polygon、Arbitrum 等多条链
- 无需 API Key

## 许可证

MIT
