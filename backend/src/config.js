import 'dotenv/config';

const bool = (v, fallback = false) => v == null ? fallback : String(v).toLowerCase() === 'true';

export const config = {
  port: Number(process.env.PORT || 4000),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 12000),
  sql: {
    server: process.env.SQL_SERVER || 'localhost',
    database: process.env.SQL_DATABASE || 'UsdtRialChart',
    user: process.env.SQL_USER || undefined,
    password: process.env.SQL_PASSWORD || undefined,
    trusted: bool(process.env.SQL_TRUSTED_CONNECTION, true),
    encrypt: bool(process.env.SQL_ENCRYPT, false)
  },
  wallex: {
    enabled: bool(process.env.WALLEX_ENABLED, true),
    symbol: process.env.WALLEX_SYMBOL || 'USDTTMN',
    multiplier: Number(process.env.WALLEX_PRICE_MULTIPLIER || 10)
  },
  nobitex: {
    enabled: bool(process.env.NOBITEX_ENABLED, false),
    symbol: process.env.NOBITEX_SYMBOL || 'USDTIRT',
    multiplier: Number(process.env.NOBITEX_PRICE_MULTIPLIER || 1),
    tradesUrl: process.env.NOBITEX_TRADES_URL || '',
    historyUrl: process.env.NOBITEX_HISTORY_URL || ''
  }
};
