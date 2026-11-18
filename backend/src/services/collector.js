import { adapters } from '../exchanges/index.js';
import { config } from '../config.js';
import { saveTrades, setExchangeStatus, getTicksSince, saveCompositeCandles } from '../repositories/marketRepository.js';
import { buildTradeCandles, aggregateExchangeCandles } from '../aggregation/candles.js';
import { TIMEFRAMES, floorTime } from '../utils/timeframes.js';

let running = false;
export async function collectOnce(io) {
  if (running) return;
  running = true;
  try {
    for (const adapter of adapters) {
      try {
        const trades = await adapter.getRecentTrades();
        await saveTrades(adapter, trades);
        await setExchangeStatus(adapter.code, null);
      } catch (e) {
        await setExchangeStatus(adapter.code, String(e.message).slice(0, 950)).catch(() => {});
        console.error(`[${adapter.code}]`, e.message);
      }
    }

    // فقط کندل ۱ دقیقه‌ای ذخیره می‌شود؛ بقیه تایم‌فریم‌ها از روی آن ساخته می‌شوند.
    const snapshots = {};
    const tf = TIMEFRAMES['1m'];

    // کندل در حال تشکیل را از تمام تیک‌های ذخیره‌شده از ابتدای آن بازسازی می‌کنیم.
    const candleStart = floorTime(new Date(), tf.seconds);
    const ticks = await getTicksSince(candleStart);
    const byExchange = new Map();
    for (const tick of ticks) {
      if (!byExchange.has(tick.exchange)) byExchange.set(tick.exchange, []);
      byExchange.get(tick.exchange).push(tick);
    }
    const perExchangeCandles = [];
    for (const rows of byExchange.values()) {
      perExchangeCandles.push(...buildTradeCandles(rows, tf.seconds));
    }
    const composite = aggregateExchangeCandles(perExchangeCandles);
    if (composite.length) {
      await saveCompositeCandles('1m', composite, true);
      snapshots['1m'] = composite.map(c => ({
        time: Math.floor(c.time.getTime() / 1000),
        open: c.open, high: c.high, low: c.low, close: c.close,
        volume: c.volume, sourceCount: c.sourceCount
      }));
    }
    if (Object.keys(snapshots).length) io.emit('market:update', { candles: snapshots, updatedAt: new Date().toISOString() });
  } finally { running = false; }
}

export function startCollector(io) {
  collectOnce(io).catch(console.error);
  setInterval(() => collectOnce(io).catch(console.error), config.pollIntervalMs);
}