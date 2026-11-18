import { ExchangeAdapter } from './base.js';

const API = 'https://api.wallex.ir';

export class WallexAdapter extends ExchangeAdapter {
  constructor(settings) {
    super('wallex', 'والکس', settings.multiplier);
    this.symbol = settings.symbol;
  }

  async getRecentTrades() {
    const url = new URL('/v1/trades', API);
    url.searchParams.set('symbol', this.symbol);
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`Wallex trades HTTP ${res.status}`);
    const json = await res.json();
    const rows = json?.result?.latestTrades ?? [];
    return rows.map(t => ({
      exchange: this.code,
      externalId: `${t.timestamp}|${t.price}|${t.quantity}|${t.isBuyOrder ? 'B' : 'S'}`,
      time: new Date(t.timestamp),
      price: this.normalizePrice(t.price),
      quantity: Number(t.quantity),
      side: t.isBuyOrder ? 'buy' : 'sell'
    })).filter(t => Number.isFinite(t.quantity) && t.quantity > 0 && !Number.isNaN(t.time.getTime()));
  }

  async getHistory({ timeframe, from, to }) {
    const url = new URL('/v1/udf/history', API);
    url.searchParams.set('symbol', this.symbol);
    url.searchParams.set('resolution', timeframe.wallex);
    url.searchParams.set('from', String(Math.floor(from.getTime() / 1000)));
    url.searchParams.set('to', String(Math.floor(to.getTime() / 1000)));
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`Wallex history HTTP ${res.status}`);
    const json = await res.json();
    if (json.s !== 'ok') return [];
    return (json.t || []).map((t, i) => ({
      time: new Date(t * 1000),
      open: this.normalizePrice(json.o[i]),
      high: this.normalizePrice(json.h[i]),
      low: this.normalizePrice(json.l[i]),
      close: this.normalizePrice(json.c[i]),
      volume: Number(json.v?.[i] ?? 0)
    }));
  }
}
