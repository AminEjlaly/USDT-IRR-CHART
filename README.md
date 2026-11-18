# USDT/RIAL Chart

A Windows-first React + TypeScript / Node.js + SQL Server starter for a multi-exchange USDT/IRR chart.

## Important data notes

- All persisted and displayed prices are **IRR (ریال)**.
- Wallex market `USDTTMN` is commonly quoted in **toman**. The adapter converts it to IRR by multiplying by `10`.
- Nobitex `/v2/trades/USDTIRT` is treated as **rial**; its UDF history endpoint is converted from **toman** to rial by multiplying by `10`.
- Nobitex public endpoints are called server-side. If Nobitex blocks the machine's IP (HTTP 403), keep it disabled or run the backend from an allowed network.
- A weighted multi-exchange "composite candle" is not mathematically equivalent to averaging OHLC values. This starter builds a composite from exchange candle midpoints/typical prices, while preserving per-source OHLC. Review `aggregation/candles.js` before using for trading decisions.
- Historical coverage depends on each exchange's API limits and retention. The backfill command imports what each provider returns; it cannot invent unavailable history.

## Requirements

- Windows 10/11
- Node.js 20 LTS or newer
- SQL Server 2019+ (Express is fine)
- SQL Server Management Studio (optional)

## 1) Create database

Open `database/schema.sql` in SSMS and execute it against your SQL Server instance.

## 2) Configure backend

```powershell
cd backend
Copy-Item .env.example .env
notepad .env
npm install
npm run dev
```

Set `SQL_SERVER`, `SQL_DATABASE`, and authentication values in `.env`. If Nobitex responds with HTTP 403, set `NOBITEX_ENABLED=false` until the backend is hosted on an allowed network.
For Windows integrated authentication, set `SQL_TRUSTED_CONNECTION=true`; the Windows account running Node must have access to the database.

## 3) Configure frontend

In another PowerShell window:

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Open the Vite URL (normally http://localhost:5173).

## 4) Backfill historical candles

After the backend is running:

```powershell
cd backend
npm run backfill -- --days 365
```

The Wallex UDF history API supports historical OHLC with `symbol`, `resolution`, `from`, and `to`. API retention and maximum range may vary. The script requests history in chunks.

## 5) Start production mode

```powershell
cd frontend
npm run build
```

Serve `frontend/dist` from a static web server and run the backend as a Windows service (NSSM or Task Scheduler). Put both behind HTTPS in production.

## API endpoints

- `GET /api/health`
- `GET /api/market/summary`
- `GET /api/candles?timeframe=1m&limit=500`
- `GET /api/exchanges`
- WebSocket event `market:update`

## Initial scope

Included:
- SQL Server schema and repository
- Wallex historical UDF candle importer
- Provider adapter interface
- Wallex recent-trade polling
- Nobitex public trades + UDF history adapter (can return HTTP 403 when the server IP is restricted)
- Candle aggregation and outlier guard
- REST + Socket.IO
- React dark chart using Lightweight Charts
- timeframe selection and source status panel

Not included yet:
- user accounts/authentication
- execution/trading/order placement
- guaranteed tick-by-tick complete history
- deployment hardening, monitoring, backups

Never expose exchange API secrets in the frontend. This project only uses public market data.
