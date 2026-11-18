import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Activity, Wifi, WifiOff, RefreshCw } from 'lucide-react';
import MarketChart, { type Candle } from './components/MarketChart';

const API = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const timeframes = ['1d','4h','1h','30m','15m','5m','1m'];
const REFRESH_MS = 5000;

type Exchange = { Code: string; DisplayName: string; IsEnabled: boolean; LastSuccessAt: string | null; LastError: string | null };

export default function App() {
  const [timeframe, setTimeframe] = useState('1m');
  const [candles, setCandles] = useState<Candle[]>([]);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const candlesRef = useRef<Candle[]>([]);
  candlesRef.current = candles;

  async function load() {
    setLoading(true);
    try {
      const [c, e] = await Promise.all([
        fetch(`${API}/api/candles?timeframe=${timeframe}&limit=1000`).then(r => { if (!r.ok) throw new Error('دریافت کندل ناموفق بود'); return r.json(); }),
        fetch(`${API}/api/exchanges`).then(r => r.ok ? r.json() : [])
      ]);
      setCandles(c.data || []);
      setExchanges(e || []);
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'خطای نامشخص'); }
    finally { setLoading(false); }
  }

  useEffect(() => { setCandles([]); load(); }, [timeframe]);

  // رفرش خودکار هر ۵ ثانیه: فقط کندل‌های آخر را می‌گیرد و با لیست فعلی ادغام می‌کند
  useEffect(() => {
    let stopped = false;
    let busy = false;

    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        const lastTime = candlesRef.current[candlesRef.current.length - 1]?.time
          ?? Math.floor(Date.now() / 1000) - 86400;
        const r = await fetch(`${API}/api/candles?timeframe=${timeframe}&since=${lastTime}`);
        if (!r.ok) return;
        const json = await r.json();
        const updates = json.data as Candle[] | undefined;
        if (stopped || !updates?.length) return;
        setCandles(old => {
          const map = new Map(old.map(x => [x.time, x]));
          for (const x of updates) map.set(x.time, x);
          return [...map.values()].sort((a, b) => a.time - b.time).slice(-1500);
        });
        setError('');
      } catch { /* رفرش بعدی دوباره تلاش می‌کند */ }
      finally { busy = false; }
    };

    const id = setInterval(tick, REFRESH_MS);
    return () => { stopped = true; clearInterval(id); };
  }, [timeframe]);

  // سوکت فقط برای نمایش وضعیت اتصال
  useEffect(() => {
    const socket = io(API, { transports: ['websocket','polling'] });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    return () => { socket.disconnect(); };
  }, []);

  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const change = useMemo(() => last && previous?.close ? ((last.close - previous.close) / previous.close) * 100 : null, [last, previous]);
  const format = (n?: number) => n == null ? '—' : new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(n);

  return <main className="shell">
    <header className="topbar">
      <div className="brand"><div className="brand-icon"><Activity size={22}/></div><div><b>USDT / RIAL</b><small>AGGREGATED MARKET CHART</small></div></div>
      <div className={`connection ${connected ? 'online' : ''}`}>{connected ? <Wifi size={16}/> : <WifiOff size={16}/>} {connected ? 'اتصال زنده' : 'در انتظار اتصال'}</div>
    </header>

    <section className="market-head">
      <div><span className="muted">تتر / ریال</span><h1>{format(last?.close)} <small>IRR</small></h1>
        <span className={change == null ? 'muted' : change >= 0 ? 'positive' : 'negative'}>{change == null ? 'تغییر نامشخص' : `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`}</span>
      </div>
      <div className="market-meta"><span>قیمت بر حسب ریال</span><span>منابع فعال: {exchanges.filter(x => x.IsEnabled).length}</span><button onClick={load} title="بروزرسانی"><RefreshCw size={16}/></button></div>
    </section>

    <section className="panel">
      <div className="panel-title"><div><b>نمودار قیمت</b><small>کندل تجمیعی بازار</small></div>
        <div className="timeframes">{timeframes.map(t => <button key={t} className={timeframe===t?'selected':''} onClick={() => setTimeframe(t)}>{t}</button>)}</div>
      </div>
      {error && <div className="warning">{error} — وضعیت SQL Server و فایل .env را بررسی کن.</div>}
      {loading && <div className="loading">در حال دریافت اطلاعات...</div>}
      <MarketChart key={timeframe} data={candles}/>
      {!candles.length && !loading && <div className="empty">هنوز کندلی ثبت نشده است. ابتدا بک‌فیل یا دریافت داده زنده را اجرا کن.</div>}
    </section>

    <section className="panel source-panel">
      <div className="panel-title"><div><b>وضعیت منابع داده</b><small>سلامت اتصال و آخرین دریافت</small></div></div>
      <div className="source-grid">{exchanges.map(x => <div className="source" key={x.Code}>
        <div><b>{x.DisplayName}</b><small>{x.Code.toUpperCase()}</small></div>
        <span className={x.LastError ? 'negative' : x.LastSuccessAt ? 'positive' : 'muted'}>{x.LastError ? 'خطا' : x.LastSuccessAt ? 'فعال' : 'بدون داده'}</span>
        {x.LastError && <small className="source-error">{x.LastError}</small>}
      </div>)}</div>
    </section>
    <footer>داده‌ها برای تحلیل هستند؛ قبل از استفاده معاملاتی، اختلاف منابع و واحد قیمت را کنترل کن.</footer>
  </main>;
}