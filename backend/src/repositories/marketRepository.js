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

// کندل‌های ۱ دقیقه‌ای صرافی‌ها را برای هر دقیقه ترکیب می‌کند.
function buildMinuteComposite(rows) {
  const byTime = new Map();

  for (const row of rows) {
    const key = new Date(row.CandleTime).getTime();

    if (!byTime.has(key)) byTime.set(key, []);

    byTime.get(key).push({
      exchange: row.ExchangeCode,
      open: Number(row.Open),
      high: Number(row.High),
      low: Number(row.Low),
      close: Number(row.Close),
      volume: Number(row.Volume) || 0
    });
  }

  return [...byTime.entries()].map(([time, sources]) => ({
    time: new Date(time),
    open: median(sources.map(x => x.open)),
    high: Math.max(...sources.map(x => x.high)),
    low: Math.min(...sources.map(x => x.low)),
    close: median(sources.map(x => x.close)),
    volume: sources.reduce((sum, x) => sum + x.volume, 0),
    sourceCount: new Set(sources.map(x => x.exchange)).size,
    partial: false
  }));
}

// کندل‌های ۱ دقیقه‌ای (مرتب‌شده صعودی) را به تایم‌فریم بزرگ‌تر تبدیل می‌کند.
function aggregateTo(candles, seconds) {
  const out = [];
  let cur = null;

  for (const c of candles) {
    const bucket =
      Math.floor(c.time.getTime() / 1000 / seconds) * seconds * 1000;

    if (!cur || cur.bucket !== bucket) {
      cur = {
        bucket,
        time: new Date(bucket),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        sourceCount: c.sourceCount,
        partial: c.partial
      };

      out.push(cur);
      continue;
    }

    cur.high = Math.max(cur.high, c.high);
    cur.low = Math.min(cur.low, c.low);
    cur.close = c.close;
    cur.volume += c.volume;
    cur.sourceCount = Math.max(cur.sourceCount, c.sourceCount);
    cur.partial = cur.partial || c.partial;
  }

  return out;
}

// همیشه از کندل‌های ۱ دقیقه‌ای می‌سازد.
// since (ثانیه یونیکس): فقط از ابتدای کندلِ آن زمان به بعد را برمی‌گرداند (برای رفرش سریع).
export async function getCandles(timeframe, limit = 500, since = null) {
  const tf = TIMEFRAMES[timeframe];

  if (!tf) {
    throw new Error(`Invalid timeframe: ${timeframe}`);
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 500, 1), 5000);
  const minutesPerCandle = tf.seconds / 60;
  const rawLimit = Math.min(safeLimit * minutesPerCandle * 2, 400000);

  const sinceSec = Number(since);
  const useSince = Number.isFinite(sinceSec) && sinceSec > 0;

  const pool = await getPool();

  const exchangeReq = pool.request().input('tf', sql.VarChar(10), '1m');
  const marketReq = pool.request().input('tf', sql.VarChar(10), '1m');

  let exchangeQuery;
  let marketQuery;

  if (useSince) {
    const from = floorTime(new Date(sinceSec * 1000), tf.seconds);

    exchangeReq.input('from', sql.DateTime2(0), from);
    marketReq.input('from', sql.DateTime2(0), from);

    exchangeQuery = `
      SELECT e.Code AS ExchangeCode, c.CandleTime,
             c.[Open], c.High, c.Low, c.[Close], c.Volume
      FROM dbo.ExchangeCandles c
      INNER JOIN dbo.Exchanges e ON e.ExchangeId = c.ExchangeId
      WHERE c.Timeframe = @tf AND c.CandleTime >= @from
      ORDER BY c.CandleTime ASC;
    `;

    marketQuery = `
      SELECT CandleTime, [Open], High, Low, [Close],
             Volume, SourceCount, IsPartial
      FROM dbo.MarketCandles
      WHERE Timeframe = @tf AND CandleTime >= @from
      ORDER BY CandleTime ASC;
    `;
  } else {
    exchangeReq.input('rawLimit', sql.Int, rawLimit);
    marketReq.input('rawLimit', sql.Int, rawLimit);

    exchangeQuery = `
      SELECT TOP (@rawLimit)
        e.Code AS ExchangeCode, c.CandleTime,
        c.[Open], c.High, c.Low, c.[Close], c.Volume
      FROM dbo.ExchangeCandles c
      INNER JOIN dbo.Exchanges e ON e.ExchangeId = c.ExchangeId
      WHERE c.Timeframe = @tf
      ORDER BY c.CandleTime DESC;
    `;

    marketQuery = `
      SELECT TOP (@rawLimit)
        CandleTime, [Open], High, Low, [Close],
        Volume, SourceCount, IsPartial
      FROM dbo.MarketCandles
      WHERE Timeframe = @tf
      ORDER BY CandleTime DESC;
    `;
  }

  const [exchangeResult, marketResult] = await Promise.all([
    exchangeReq.query(exchangeQuery),
    marketReq.query(marketQuery)
  ]);

  // اگر خواندن در انتها قطع شده، اولین کندل بزرگ ناقص است و حذف می‌شود.
  const truncated =
    !useSince && exchangeResult.recordset.length >= rawLimit;

  const merged = new Map();

  for (const candle of buildMinuteComposite(exchangeResult.recordset)) {
    merged.set(candle.time.getTime(), candle);
  }

  // داده زنده (Collector) برای همان دقیقه اولویت دارد.
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

  const minutes = [...merged.values()].sort((a, b) => a.time - b.time);

  let result = aggregateTo(minutes, tf.seconds);

  if (truncated && result.length > 1) {
    result = result.slice(1);
  }

  return result
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