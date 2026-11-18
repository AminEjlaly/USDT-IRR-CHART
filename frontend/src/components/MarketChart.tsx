import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
  PriceScaleMode,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp
} from 'lightweight-charts';

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  sourceCount?: number;
  partial?: boolean;
};

type ScaleKind = 'normal' | 'log' | 'percent';

const priceFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0
});

const percentFormatter = (v: number) => `${v.toFixed(2)}%`;

const CHART_HEIGHT = 520;

const modeMap: Record<ScaleKind, PriceScaleMode> = {
  normal: PriceScaleMode.Normal,
  log: PriceScaleMode.Logarithmic,
  percent: PriceScaleMode.Percentage
};

const toolbarStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  right: 118,
  zIndex: 3,
  display: 'flex',
  gap: 4,
  direction: 'ltr'
};

const legendStyle: React.CSSProperties = {
  position: 'absolute',
  top: 8,
  left: 12,
  zIndex: 3,
  display: 'flex',
  gap: 12,
  flexWrap: 'wrap',
  fontSize: 11,
  direction: 'ltr',
  pointerEvents: 'none',
  color: '#aab6c5'
};

function toolButton(active: boolean): React.CSSProperties {
  return {
    background: active ? '#173c3a' : 'rgba(24,36,51,0.85)',
    color: active ? '#53d4b0' : '#aab6c5',
    border: `1px solid ${active ? '#23685c' : '#29384b'}`,
    borderRadius: 6,
    padding: '3px 9px',
    fontSize: 11,
    cursor: 'pointer',
    fontFamily: 'inherit'
  };
}

export default function MarketChart({ data }: { data: Candle[] }) {
  const host = useRef<HTMLDivElement>(null);

  const chartRef = useRef<IChartApi | null>(null);
  const candleSeries = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeries = useRef<ISeriesApi<'Histogram'> | null>(null);

  const fitted = useRef(false);

  const [scaleKind, setScaleKind] = useState<ScaleKind>('normal');
  const [hover, setHover] = useState<Candle | null>(null);

  const sorted = useMemo(() => {
    const map = new Map<number, Candle>();

    for (const x of data) {
      if (
        !Number.isFinite(x.time) ||
        !Number.isFinite(x.open) ||
        !Number.isFinite(x.high) ||
        !Number.isFinite(x.low) ||
        !Number.isFinite(x.close) ||
        !Number.isFinite(x.volume) ||
        x.time <= 0 ||
        x.open <= 0 ||
        x.high <= 0 ||
        x.low <= 0 ||
        x.close <= 0 ||
        x.volume < 0 ||
        x.high < Math.max(x.open, x.close, x.low) ||
        x.low > Math.min(x.open, x.close)
      ) continue;

      map.set(x.time, x);
    }

    return [...map.values()].sort((a, b) => a.time - b.time);
  }, [data]);

  // نگه‌داشتن آخرین داده برای استفاده در کراس‌هیر
  const sortedRef = useRef<Candle[]>([]);
  sortedRef.current = sorted;

  // ساخت نمودار (قیمت + حجم روی یک نمودار، مثل TradingView)
  useEffect(() => {
    if (!host.current) return;

    const chart = createChart(host.current, {
      width: host.current.clientWidth,
      height: CHART_HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: '#101722' },
        textColor: '#aab6c5',
        fontFamily: 'Tahoma, sans-serif',
        attributionLogo: false
      },
      grid: {
        vertLines: { color: '#162130' },
        horzLines: { color: '#162130' }
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: '#75869b',
          width: 1,
          style: 2,
          labelBackgroundColor: '#34445a'
        },
        horzLine: {
          color: '#75869b',
          labelBackgroundColor: '#34445a'
        }
      },
      rightPriceScale: {
        borderColor: '#29384b',
        minimumWidth: 105,
        // کندل‌ها بالاتر از حجم قرار می‌گیرند
        scaleMargins: { top: 0.08, bottom: 0.25 }
      },
      timeScale: {
        borderColor: '#29384b',
        rightOffset: 8,
        barSpacing: 9,
        minBarSpacing: 2,
        timeVisible: true,
        secondsVisible: false
      },
      localization: {
        locale: 'en-US',
        priceFormatter: (price: number) => priceFormatter.format(price),
        percentageFormatter: percentFormatter
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true
      }
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: '#18b995',
      downColor: '#e05260',
      borderUpColor: '#18b995',
      borderDownColor: '#e05260',
      wickUpColor: '#18b995',
      wickDownColor: '#e05260',
      priceFormat: {
        type: 'custom',
        minMove: 1,
        formatter: (p: number) => priceFormatter.format(p)
      },
      lastValueVisible: true,
      priceLineVisible: true
    });

    // حجم: هیستوگرام روی مقیاس جداگانه (overlay) در ۲۰٪ پایین نمودار
    const volumes = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false,
      base: 0
    });

    volumes.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 }
    });

    chartRef.current = chart;
    candleSeries.current = candles;
    volumeSeries.current = volumes;

    // لجند OHLC هنگام حرکت ماوس
    const onMove = (param: any) => {
      const bar = param?.seriesData?.get(candles);

      if (!param?.time || !bar) {
        setHover(null);
        return;
      }

      const found = sortedRef.current.find(c => c.time === Number(param.time));
      setHover(found ?? null);
    };

    chart.subscribeCrosshairMove(onMove);

    const observer = new ResizeObserver(() => {
      if (host.current) {
        chart.applyOptions({ width: host.current.clientWidth });
      }
    });

    observer.observe(host.current);

    return () => {
      observer.disconnect();
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();

      chartRef.current = null;
      candleSeries.current = null;
      volumeSeries.current = null;

      fitted.current = false;
    };
  }, []);

  // تغییر حالت مقیاس قیمت (عادی / لگاریتمی / درصدی)
  useEffect(() => {
    chartRef.current?.priceScale('right').applyOptions({
      mode: modeMap[scaleKind],
      autoScale: true
    });
  }, [scaleKind]);

  // بروزرسانی اطلاعات
  useEffect(() => {
    if (!candleSeries.current || !volumeSeries.current) return;

    candleSeries.current.setData(
      sorted.map(x => ({
        time: x.time as UTCTimestamp,
        open: x.open,
        high: x.high,
        low: x.low,
        close: x.close
      }))
    );

    volumeSeries.current.setData(
      sorted.map(x => ({
        time: x.time as UTCTimestamp,
        value: x.volume,
        color: x.close >= x.open
          ? 'rgba(24,185,149,0.48)'
          : 'rgba(224,82,96,0.48)'
      }))
    );

    // فقط بار اول نمودار را روی تمام تاریخچه تنظیم کن
    if (sorted.length && !fitted.current) {
      chartRef.current?.timeScale().fitContent();
      fitted.current = true;
    }
  }, [sorted]);

  const fit = () => {
    chartRef.current?.priceScale('right').applyOptions({ autoScale: true });
    chartRef.current?.timeScale().fitContent();
  };

  const shown = hover ?? sorted[sorted.length - 1] ?? null;
  const up = shown ? shown.close >= shown.open : true;
  const changePct = shown && shown.open
    ? ((shown.close - shown.open) / shown.open) * 100
    : null;
  const color = up ? '#18b995' : '#e05260';

  return (
    <div
      className="market-chart"
      style={{ position: 'relative', direction: 'ltr' }}
    >
      {shown && (
        <div style={legendStyle}>
          <span>O <b style={{ color }}>{priceFormatter.format(shown.open)}</b></span>
          <span>H <b style={{ color }}>{priceFormatter.format(shown.high)}</b></span>
          <span>L <b style={{ color }}>{priceFormatter.format(shown.low)}</b></span>
          <span>C <b style={{ color }}>{priceFormatter.format(shown.close)}</b></span>
          {changePct != null && (
            <b style={{ color }}>
              {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
            </b>
          )}
          <span>Vol <b style={{ color: '#aab6c5' }}>{priceFormatter.format(shown.volume)}</b></span>
        </div>
      )}

      <div style={toolbarStyle}>
        <button
          type="button"
          style={toolButton(scaleKind === 'log')}
          onClick={() => setScaleKind(k => (k === 'log' ? 'normal' : 'log'))}
          title="مقیاس لگاریتمی"
        >
          Log
        </button>
        <button
          type="button"
          style={toolButton(scaleKind === 'percent')}
          onClick={() => setScaleKind(k => (k === 'percent' ? 'normal' : 'percent'))}
          title="مقیاس درصدی"
        >
          %
        </button>
        <button
          type="button"
          style={toolButton(false)}
          onClick={fit}
          title="نمایش کل تاریخچه و اتواسکیل"
        >
          Fit
        </button>
      </div>

      <div ref={host} style={{ width: '100%', height: CHART_HEIGHT }} />
    </div>
  );
}