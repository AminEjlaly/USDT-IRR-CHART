import { adapters } from '../exchanges/index.js';
import { saveExchangeCandles } from '../repositories/marketRepository.js';
import { getPool } from '../db.js';

const arg = process.argv.find(x => x.startsWith('--days='));
const idx = process.argv.indexOf('--days');

const days = Number(
  arg?.split('=')[1] ??
  (idx >= 0 ? process.argv[idx + 1] : 30)
);

if (!Number.isFinite(days) || days < 1 || days > 3650) {
  throw new Error('days must be between 1 and 3650');
}

await getPool();

const end = new Date();
const start = new Date(end.getTime() - days * 86400000);

// Wallex برای resolution=1 تاریخچه نمی‌دهد (فقط ۱ روز اخیر)،
// ولی resolution=15 کندل‌های ۱ دقیقه‌ای برمی‌گرداند. تایم‌فریم‌های بزرگ‌تر موقع خواندن ساخته می‌شوند.
const historyTimeframe = { wallex: '15' };
const chunkDays = 3;

for (const adapter of adapters) {
  let total = 0;

  try {
    for (let cursor = new Date(start); cursor < end;) {
      const next = new Date(
        Math.min(end.getTime(), cursor.getTime() + chunkDays * 86400000)
      );

      const rows = await adapter.getHistory({
        timeframe: historyTimeframe,
        from: cursor,
        to: next
      });

      // فقط کندل‌هایی که واقعاً ۱ دقیقه‌ای هستند (زمان روی مرز دقیقه)
      const minuteRows = rows.filter(
        r => r.time.getTime() % 60000 === 0
      );

      await saveExchangeCandles(adapter, '1m', minuteRows, true);

      total += minuteRows.length;

      console.log(
        `${adapter.code} ${cursor.toISOString().slice(0, 10)} → ` +
        `${next.toISOString().slice(0, 10)}: ${minuteRows.length} candles`
      );

      cursor = next;
    }

    console.log(`${adapter.code} 1m: ${total} candles imported`);
  } catch (error) {
    console.warn(`${adapter.code} 1m: ${error.message}`);
  }
}

process.exit(0);