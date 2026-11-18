import { config } from '../config.js';

const now = Math.floor(Date.now() / 1000);
const day = 86400;

const ranges = [
  ['last 1 day', now - day, now],
  ['last 3 days', now - 3 * day, now],
  ['30 days ago (3d)', now - 30 * day, now - 27 * day],
  ['90 days ago (3d)', now - 90 * day, now - 87 * day],
  ['200 days ago (3d)', now - 200 * day, now - 197 * day],
  ['Dec 2025 (3d)', Math.floor(Date.parse('2025-12-16') / 1000), Math.floor(Date.parse('2025-12-19') / 1000)]
];

const resolutions = ['1', '15', '60', '1D'];

for (const [label, from, to] of ranges) {
  for (const resolution of resolutions) {
    const url = new URL('https://api.wallex.ir/v1/udf/history');
    url.searchParams.set('symbol', config.wallex.symbol);
    url.searchParams.set('resolution', resolution);
    url.searchParams.set('from', String(from));
    url.searchParams.set('to', String(to));

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); } catch { json = null; }

      const count = json?.t?.length ?? 0;
      const first = count ? new Date(json.t[0] * 1000).toISOString() : '-';
      const last = count ? new Date(json.t[count - 1] * 1000).toISOString() : '-';

      console.log(
        `${label.padEnd(18)} res=${resolution.padEnd(3)} HTTP ${res.status} s=${json?.s ?? text.slice(0, 80)} count=${count} ${first} → ${last}`
      );
    } catch (e) {
      console.log(`${label.padEnd(18)} res=${resolution.padEnd(3)} ERROR ${e.message}`);
    }
  }
}