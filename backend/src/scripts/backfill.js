
import { adapters } from '../exchanges/index.js';
import { TIMEFRAMES } from '../utils/timeframes.js';
import {
  saveExchangeCandles,
  saveCompositeCandles
} from '../repositories/marketRepository.js';
import { aggregateExchangeCandles } from '../aggregation/candles.js';
import { getPool } from '../db.js';

const arg = process.argv.find(x => x.startsWith('--days='));
const idx = process.argv.indexOf('--days');

const days = Number(
  arg?.split('=')[1] ??
  (idx >= 0 ? process.argv[idx + 1] : 365)
);

if (!Number.isFinite(days) || days < 1 || days > 3650) {
  throw new Error('days must be between 1 and 3650');
}

await getPool();

const end = new Date();
const start = new Date(end.getTime() - days * 86400000);

const timeframeNames = ['1m', '5m', '15m', '1h', '4h', '1d'];

for (const name of timeframeNames) {
  const tf = TIMEFRAMES[name];
  const collected = [];

  for (const adapter of adapters) {
    try {
      const chunkDays =
        name === '1m' ? 3 :
        name === '5m' ? 10 : 45;

      for (let cursor = new Date(start); cursor < end;) {
        const next = new Date(
          Math.min(
            end.getTime(),
            cursor.getTime() + chunkDays * 86400000
          )
        );

        const rows = await adapter.getHistory({
          timeframe: tf,
          from: cursor,
          to: next
        });

        await saveExchangeCandles(
          adapter,
          name,
          rows,
          true
        );

        collected.push(
          ...rows.map(row => ({
            ...row,
            exchange: adapter.code
          }))
        );

        cursor = next;
      }

      console.log(`${adapter.code} ${name}: history imported`);
    } catch (error) {
      console.warn(
        `${adapter.code} ${name}: ${error.message}`
      );
    }
  }

  if (collected.length) {
    const composite = aggregateExchangeCandles(collected);

    await saveCompositeCandles(
      name,
      composite,
      false
    );

    console.log(
      `composite ${name}: ${composite.length} candles`
    );
  }
}

process.exit(0);
