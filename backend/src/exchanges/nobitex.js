
import { ExchangeAdapter } from './base.js';

const API = 'https://apiv2.nobitex.ir';

export class NobitexAdapter extends ExchangeAdapter {
  constructor(settings) {
    // قیمت معاملات USDTIRT بر حسب ریال است.
    super('nobitex', 'نوبیتکس', 1);

    this.symbol = settings.symbol || 'USDTIRT';
    this.historyMultiplier = 10;
  }

  async getRecentTrades() {
    const url = new URL(`/v2/trades/${this.symbol}`, API);

    const res = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'USDT-RIAL-Chart/1.0'
      },
      signal: AbortSignal.timeout(12000)
    });

    if (!res.ok) {
      throw new Error(`Nobitex trades HTTP ${res.status}`);
    }

    const json = await res.json();

    if (json.status !== 'ok') {
      throw new Error('Nobitex returned invalid trades response');
    }

    const rows = json.trades || [];

    return rows.map(t => {
      const price = this.normalizePrice(t.price);
      const quantity = Number(t.volume);
      const time = new Date(Number(t.time));

      return {
        exchange: this.code,
        externalId: null,
        time,
        price,
        quantity,
        side: String(t.type || '').toLowerCase()
      };
    }).filter(t =>
      Number.isFinite(t.price) &&
      t.price > 0 &&
      Number.isFinite(t.quantity) &&
      t.quantity > 0 &&
      !Number.isNaN(t.time.getTime())
    );
  }

  async getHistory({ timeframe, from, to }) {
    const url = new URL('/market/udf/history', API);

    url.searchParams.set('symbol', this.symbol);
    url.searchParams.set('resolution', timeframe.wallex);
    url.searchParams.set(
      'from',
      String(Math.floor(from.getTime() / 1000))
    );
    url.searchParams.set(
      'to',
      String(Math.floor(to.getTime() / 1000))
    );

    const res = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'USDT-RIAL-Chart/1.0'
      },
      signal: AbortSignal.timeout(20000)
    });

    if (res.status === 403) {
      throw new Error(
        'Nobitex historical candles blocked by IP (HTTP 403). Live trades are available.'
      );
    }

    if (!res.ok) {
      throw new Error(`Nobitex history HTTP ${res.status}`);
    }

    const json = await res.json();

    if (json.s !== 'ok') return [];

    return (json.t || []).map((t, i) => ({
      time: new Date(t * 1000),
      open: Number(json.o[i]) * this.historyMultiplier,
      high: Number(json.h[i]) * this.historyMultiplier,
      low: Number(json.l[i]) * this.historyMultiplier,
      close: Number(json.c[i]) * this.historyMultiplier,
      volume: Number(json.v?.[i] ?? 0)
    }));
  }
}
