
import { createHash } from 'node:crypto';
import { getPool, sql } from '../db.js';
import { TIMEFRAMES, floorTime } from '../utils/timeframes.js';

export async function ensureExchange(adapter) {
  const pool = await getPool();

  const result = await pool.request()
    .input('code', sql.NVarChar(30), adapter.code)
    .input('name', sql.NVarChar(80), adapter.displayName)
    .query(`
      MERGE dbo.Exchanges AS t
      USING (SELECT @code Code) s ON t.Code = s.Code
      WHEN MATCHED THEN
        UPDATE SET DisplayName = @name
      WHEN NOT MATCHED THEN
        INSERT (Code, DisplayName)
        VALUES (@code, @name);

      SELECT ExchangeId
      FROM dbo.Exchanges
      WHERE Code = @code;
    `);

  return result.recordset[0].ExchangeId;
}

// Nobitex ممکن است برای معاملات شناسه نداشته باشد.
// در این حالت یک شناسه پایدار از مشخصات معامله می‌سازیم.
function getTradeExternalId(trade) {
  if (trade.externalId !== null && trade.externalId !== undefined &&
      String(trade.externalId).trim() !== '') {
    return String(trade.externalId);
  }

  const raw = [
    trade.time instanceof Date ? trade.time.getTime() : new Date(trade.time).getTime(),
    Number(trade.price),
    Number(trade.quantity),
    String(trade.side || '').toLowerCase()
  ].join('|');

  return `fallback-${createHash('sha256').update(raw).digest('hex')}`;
}

export async function saveTrades(adapter, trades) {
  if (!trades?.length) return;

  const exchangeId = await ensureExchange(adapter);
  const pool = await getPool();
  const tx = new sql.Transaction(pool);

  await tx.begin();

  try {
    for (const trade of trades) {
      if (
        !trade.time ||
        Number.isNaN(new Date(trade.time).getTime()) ||
        !Number.isFinite(Number(trade.price)) ||
        Number(trade.price) <= 0 ||
        !Number.isFinite(Number(trade.quantity)) ||
        Number(trade.quantity) <= 0
      ) {
        continue;
      }

      const externalId = getTradeExternalId(trade);

      const req = new sql.Request(tx);

      req.input('exchangeId', sql.Int, exchangeId)
        .input('externalId', sql.NVarChar(120), externalId)
        .input('time', sql.DateTime2(3), new Date(trade.time))
        .input('price', sql.Decimal(28, 8), trade.price)
        .input('quantity', sql.Decimal(28, 12), trade.quantity)
        .input('side', sql.VarChar(10), trade.side || null);

      await req.query(`
        INSERT INTO dbo.ExchangeTicks
          (ExchangeId, ExternalTradeId, TradeTime, PriceRial, Quantity, Side)
        SELECT
          @exchangeId, @externalId, @time, @price, @quantity, @side
        WHERE NOT EXISTS (
          SELECT 1
          FROM dbo.ExchangeTicks
          WHERE ExchangeId = @exchangeId
            AND ExternalTradeId = @externalId
        );
      `);
    }

    await tx.commit();
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function saveExchangeCandles(
  adapter,
  timeframeName,
  candles,
  historical = false
) {
  if (!candles?.length) return;

  const exchangeId = await ensureExchange(adapter);
  const pool = await getPool();

  for (const candle of candles) {
    await pool.request()
      .input('exchangeId', sql.Int, exchangeId)
      .input('tf', sql.VarChar(10), timeframeName)
      .input('time', sql.DateTime2(0), candle.time)
      .input('o', sql.Decimal(28, 8), candle.open)
      .input('h', sql.Decimal(28, 8), candle.high)
      .input('l', sql.Decimal(28, 8), candle.low)
      .input('c', sql.Decimal(28, 8), candle.close)
      .input('v', sql.Decimal(28, 8), candle.volume || 0)
      .input('historical', sql.Bit, historical)
      .query(`
        MERGE dbo.ExchangeCandles AS t
        USING (
          SELECT
            @exchangeId ExchangeId,
            @tf Timeframe,
            @time CandleTime
        ) s
        ON t.ExchangeId = s.ExchangeId
          AND t.Timeframe = s.Timeframe
          AND t.CandleTime = s.CandleTime

        WHEN MATCHED THEN
          UPDATE SET
            [Open] = @o,
            High = @h,
            Low = @l,
            [Close] = @c,
            Volume = @v,
            IsHistorical = @historical,
            ReceivedAt = SYSUTCDATETIME()

        WHEN NOT MATCHED THEN
          INSERT (
            ExchangeId, Timeframe, CandleTime,
            [Open], High, Low, [Close], Volume, IsHistorical
          )
          VALUES (
            @exchangeId, @tf, @time,
            @o, @h, @l, @c, @v, @historical
          );
      `);
  }
}

export async function saveCompositeCandles(
  timeframeName,
  candles,
  partial = false
) {
  if (!candles?.length) return;

  const pool = await getPool();

  for (const candle of candles) {
    await pool.request()
      .input('tf', sql.VarChar(10), timeframeName)
      .input('time', sql.DateTime2(0), candle.time)
      .input('o', sql.Decimal(28, 8), candle.open)
      .input('h', sql.Decimal(28, 8), candle.high)
      .input('l', sql.Decimal(28, 8), candle.low)
      .input('c', sql.Decimal(28, 8), candle.close)
      .input('v', sql.Decimal(28, 8), candle.volume || 0)
      .input('sources', sql.Int, candle.sourceCount || 0)
      .input('partial', sql.Bit, partial)
      .query(`
        MERGE dbo.MarketCandles AS t
        USING (
          SELECT @tf Timeframe, @time CandleTime
        ) s
        ON t.Timeframe = s.Timeframe
          AND t.CandleTime = s.CandleTime

        WHEN MATCHED THEN
          UPDATE SET
            [Open] = @o,
            High = @h,
            Low = @l,
            [Close] = @c,
            Volume = @v,
            SourceCount = @sources,
            IsPartial = @partial,
            UpdatedAt = SYSUTCDATETIME()

        WHEN NOT MATCHED THEN
          INSERT (
            Timeframe, CandleTime, [Open], High, Low,
            [Close], Volume, SourceCount, IsPartial
          )
          VALUES (
            @tf, @time, @o, @h, @l,
            @c, @v, @sources, @partial
          );
      `);
  }
}

function median(values) {
  const sorted = values
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  if (!sorted.length) return 0;

  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

// ابتدا کندل‌های هر صرافی را در تایم‌فریم مقصد هم‌تراز می‌کند.
// سپس کندل‌های صرافی‌ها را برای هر زمان ترکیب می‌کند.
function buildHistoricalComposite(rows, seconds) {
  const perExchange = new Map();

  for (const row of rows) {
    const time = new Date(row.CandleTime);
    const bucket = floorTime(time, seconds);
    const key = `${row.ExchangeCode}|${bucket.getTime()}`;

    let candle = perExchange.get(key);

    if (!candle) {
      candle = {
        exchange: row.ExchangeCode,
        time: bucket,
        firstTime: time,
        lastTime: time,
        open: Number(row.Open),
        high: Number(row.High),
        low: Number(row.Low),
        close: Number(row.Close),
        volume: Number(row.Volume) || 0
      };

      perExchange.set(key, candle);
      continue;
    }

    candle.high = Math.max(candle.high, Number(row.High));
    candle.low = Math.min(candle.low, Number(row.Low));
    candle.volume += Number(row.Volume) || 0;

    if (time < candle.firstTime) {
      candle.firstTime = time;
      candle.open = Number(row.Open);
    }

    if (time >= candle.lastTime) {
      candle.lastTime = time;
      candle.close = Number(row.Close);
    }
  }

  const byTime = new Map();

  for (const candle of perExchange.values()) {
    const key = candle.time.getTime();

    if (!byTime.has(key)) byTime.set(key, []);
    byTime.get(key).push(candle);
  }

  return [...byTime.entries()].map(([time, sources]) => ({
    time: new Date(Number(time)),
    open: median(sources.map(x => x.open)),
    high: Math.max(...sources.map(x => x.high)),
    low: Math.min(...sources.map(x => x.low)),
    close: median(sources.map(x => x.close)),
    volume: sources.reduce((sum, x) => sum + x.volume, 0),
    sourceCount: new Set(sources.map(x => x.exchange)).size,
    partial: false
  })).sort((a, b) => a.time - b.time);
}

export async function getCandles(timeframe, limit = 500) {
  const tf = TIMEFRAMES[timeframe];

  if (!tf) {
    throw new Error(`Invalid timeframe: ${timeframe}`);
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 5000);

  const pool = await getPool();

  // در صورت وجود داده‌های ریزتر با برچسب تایم‌فریم بزرگ‌تر،
  // رکوردهای بیشتری می‌خوانیم تا بعد از هم‌ترازسازی تاریخچه ناقص نشود.
  const rawLimit = Math.min(safeLimit * 40, 250000);

  const exchangeResult = await pool.request()
    .input('tf', sql.VarChar(10), timeframe)
    .input('rawLimit', sql.Int, rawLimit)
    .query(`
      SELECT TOP (@rawLimit)
        e.Code AS ExchangeCode,
        c.CandleTime,
        c.[Open],
        c.High,
        c.Low,
        c.[Close],
        c.Volume
      FROM dbo.ExchangeCandles c
      INNER JOIN dbo.Exchanges e
        ON e.ExchangeId = c.ExchangeId
      WHERE c.Timeframe = @tf
      ORDER BY c.CandleTime DESC;
    `);

  const historical = buildHistoricalComposite(
    exchangeResult.recordset,
    tf.seconds
  );

  // کندل‌های زنده و تجمیع‌شده از MarketCandles خوانده می‌شوند.
  const marketResult = await pool.request()
    .input('tf', sql.VarChar(10), timeframe)
    .input('limit', sql.Int, safeLimit)
    .query(`
      SELECT TOP (@limit)
        CandleTime,
        [Open],
        High,
        Low,
        [Close],
        Volume,
        SourceCount,
        IsPartial
      FROM dbo.MarketCandles
      WHERE Timeframe = @tf
      ORDER BY CandleTime DESC;
    `);

  const merged = new Map();

  for (const candle of historical) {
    merged.set(candle.time.getTime(), candle);
  }

  // داده MarketCandles برای زمان یکسان اولویت دارد؛
  // چون این جدول توسط Collector به‌روزرسانی می‌شود.
  for (const row of marketResult.recordset) {
    const time = new Date(row.CandleTime);

    merged.set(time.getTime(), {
      time,
      open: Number(row.Open),
      high: Number(row.High),
      low: Number(row.Low),
      close: Number(row.Close),
      volume: Number(row.Volume) || 0,
      sourceCount: Number(row.SourceCount) || 0,
      partial: Boolean(row.IsPartial)
    });
  }

  return [...merged.values()]
    .sort((a, b) => a.time - b.time)
    .slice(-safeLimit)
    .map(candle => ({
      time: Math.floor(candle.time.getTime() / 1000),
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      sourceCount: candle.sourceCount,
      partial: candle.partial
    }));
}

export async function getExchangeStatus() {
  const pool = await getPool();

  const result = await pool.request().query(`
    SELECT
      Code,
      DisplayName,
      IsEnabled,
      LastSuccessAt,
      LastError
    FROM dbo.Exchanges
    ORDER BY Code;
  `);

  return result.recordset;
}

export async function setExchangeStatus(code, error = null) {
  const pool = await getPool();

  await pool.request()
    .input('code', sql.NVarChar(30), code)
    .input('error', sql.NVarChar(1000), error)
    .query(`
      UPDATE dbo.Exchanges
      SET
        LastSuccessAt = CASE
          WHEN @error IS NULL THEN SYSUTCDATETIME()
          ELSE LastSuccessAt
        END,
        LastError = @error
      WHERE Code = @code;
    `);
}

export async function getTicksSince(from) {
  const pool = await getPool();

  const result = await pool.request()
    .input('from', sql.DateTime2(3), from)
    .query(`
      SELECT
        e.Code AS ExchangeCode,
        t.TradeTime,
        t.PriceRial,
        t.Quantity,
        t.Side
      FROM dbo.ExchangeTicks t
      INNER JOIN dbo.Exchanges e
        ON e.ExchangeId = t.ExchangeId
      WHERE t.TradeTime >= @from
      ORDER BY t.TradeTime ASC;
    `);

  return result.recordset.map(row => ({
    exchange: row.ExchangeCode,
    time: new Date(row.TradeTime),
    price: Number(row.PriceRial),
    quantity: Number(row.Quantity),
    side: row.Side
  }));
}
