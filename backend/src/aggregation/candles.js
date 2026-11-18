
import { floorTime } from '../utils/timeframes.js';

export function buildTradeCandles(trades, seconds) {
  const map = new Map();

  const orderedTrades = [...trades].sort(
    (a, b) => new Date(a.time) - new Date(b.time)
  );

  for (const trade of orderedTrades) {
    const time = new Date(trade.time);

    if (
      Number.isNaN(time.getTime()) ||
      !Number.isFinite(Number(trade.price)) ||
      !Number.isFinite(Number(trade.quantity)) ||
      Number(trade.price) <= 0 ||
      Number(trade.quantity) <= 0
    ) {
      continue;
    }

    const bucket = floorTime(time, seconds);
    const key = bucket.toISOString();

    let candle = map.get(key);

    if (!candle) {
      candle = {
        time: bucket,
        open: Number(trade.price),
        high: Number(trade.price),
        low: Number(trade.price),
        close: Number(trade.price),
        volume: 0,
        sources: new Set(),
        lastTime: time
      };
    }

    candle.high = Math.max(candle.high, Number(trade.price));
    candle.low = Math.min(candle.low, Number(trade.price));

    if (time >= candle.lastTime) {
      candle.close = Number(trade.price);
      candle.lastTime = time;
    }

    candle.volume += Number(trade.quantity);

    if (trade.exchange) {
      candle.sources.add(trade.exchange);
    }

    map.set(key, candle);
  }

  return [...map.values()].map(candle => ({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    sourceCount: candle.sources.size
  }));
}

export function aggregateExchangeCandles(sourceCandles) {
  const byTime = new Map();

  for (const item of sourceCandles) {
    const time = new Date(item.time);

    if (
      Number.isNaN(time.getTime()) ||
      !Number.isFinite(Number(item.open)) ||
      !Number.isFinite(Number(item.high)) ||
      !Number.isFinite(Number(item.low)) ||
      !Number.isFinite(Number(item.close))
    ) {
      continue;
    }

    const key = time.toISOString();

    if (!byTime.has(key)) {
      byTime.set(key, []);
    }

    byTime.get(key).push(item);
  }

  const median = values => {
    const sorted = values
      .filter(Number.isFinite)
      .sort((a, b) => a - b);

    if (!sorted.length) return 0;

    const middle = Math.floor(sorted.length / 2);

    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  };

  return [...byTime.entries()]
    .map(([key, rows]) => {
      const exchanges = new Set(
        rows.map(row => row.exchange).filter(Boolean)
      );

      return {
        time: new Date(key),
        open: median(rows.map(row => Number(row.open))),
        high: Math.max(...rows.map(row => Number(row.high))),
        low: Math.min(...rows.map(row => Number(row.low))),
        close: median(rows.map(row => Number(row.close))),
        volume: rows.reduce(
          (sum, row) => sum + (Number(row.volume) || 0),
          0
        ),
        sourceCount: exchanges.size || rows.length
      };
    })
    .sort((a, b) => a.time - b.time);
}
