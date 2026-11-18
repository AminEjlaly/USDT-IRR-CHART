
import { useEffect, useMemo, useRef } from 'react';
import {
  createChart,
  ColorType,
  CrosshairMode,
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

const priceFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0
});

const baseOptions = {
  layout: {
    background: { type: ColorType.Solid, color: '#101722' },
    textColor: '#aab6c5',
    fontFamily: 'Tahoma, sans-serif',
    attributionLogo: false
  },
  grid: {
    vertLines: { color: '#1c2837' },
    horzLines: { color: '#1c2837' }
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: {
      color: '#75869b',
      width: 1 as const,
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
    minimumWidth: 105
  },
  localization: {
    locale: 'en-US',
    priceFormatter: (price: number) => priceFormatter.format(price)
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
};

export default function MarketChart({ data }: { data: Candle[] }) {
  const priceHost = useRef<HTMLDivElement>(null);
  const volumeHost = useRef<HTMLDivElement>(null);

  const priceChart = useRef<IChartApi | null>(null);
  const volumeChart = useRef<IChartApi | null>(null);

  const candleSeries = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeries = useRef<ISeriesApi<'Histogram'> | null>(null);

  const syncing = useRef(false);
  const fitted = useRef(false);

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

  // ساخت نمودارها
  useEffect(() => {
    if (!priceHost.current || !volumeHost.current) return;

    const price = createChart(priceHost.current, {
      ...baseOptions,
      width: priceHost.current.clientWidth,
      height: 390,
      timeScale: {
        visible: false,
        borderVisible: false,
        rightOffset: 8,
        barSpacing: 9,
        minBarSpacing: 2,
        timeVisible: true,
        secondsVisible: false
      }
    });

    const volume = createChart(volumeHost.current, {
      ...baseOptions,
      width: volumeHost.current.clientWidth,
      height: 125,
      rightPriceScale: {
        visible: false,
        borderVisible: false
      },
      timeScale: {
        visible: true,
        borderColor: '#29384b',
        rightOffset: 8,
        barSpacing: 9,
        minBarSpacing: 2,
        timeVisible: true,
        secondsVisible: false
      }
    });

    const candles = price.addSeries(CandlestickSeries, {
      upColor: '#18b995',
      downColor: '#e05260',
      borderUpColor: '#18b995',
      borderDownColor: '#e05260',
      wickUpColor: '#18b995',
      wickDownColor: '#e05260',
      priceFormat: {
        type: 'custom',
        minMove: 1,
        formatter: (price: number) => priceFormatter.format(price)
      },
      lastValueVisible: true,
      priceLineVisible: true
    });

    const volumes = volume.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
      base: 0
    });

    volumes.priceScale().applyOptions({
      scaleMargins: {
        top: 0.08,
        bottom: 0
      }
    });

    priceChart.current = price;
    volumeChart.current = volume;
    candleSeries.current = candles;
    volumeSeries.current = volumes;

    // هماهنگ کردن محدوده زمانی دو نمودار
    const syncPrice = () => {
      if (syncing.current) return;

      const range = price.timeScale().getVisibleLogicalRange();
      if (!range) return;

      syncing.current = true;
      volume.timeScale().setVisibleLogicalRange(range);
      syncing.current = false;
    };

    const syncVolume = () => {
      if (syncing.current) return;

      const range = volume.timeScale().getVisibleLogicalRange();
      if (!range) return;

      syncing.current = true;
      price.timeScale().setVisibleLogicalRange(range);
      syncing.current = false;
    };

    price.timeScale().subscribeVisibleLogicalRangeChange(syncPrice);
    volume.timeScale().subscribeVisibleLogicalRangeChange(syncVolume);

    const observer = new ResizeObserver(() => {
      if (priceHost.current) {
        price.applyOptions({
          width: priceHost.current.clientWidth
        });
      }

      if (volumeHost.current) {
        volume.applyOptions({
          width: volumeHost.current.clientWidth
        });
      }
    });

    observer.observe(priceHost.current);
    observer.observe(volumeHost.current);

    return () => {
      observer.disconnect();

      price.timeScale().unsubscribeVisibleLogicalRangeChange(syncPrice);
      volume.timeScale().unsubscribeVisibleLogicalRangeChange(syncVolume);

      price.remove();
      volume.remove();

      priceChart.current = null;
      volumeChart.current = null;
      candleSeries.current = null;
      volumeSeries.current = null;

      fitted.current = false;
    };
  }, []);

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
      priceChart.current?.timeScale().fitContent();
      fitted.current = true;
    }
  }, [sorted]);

  return (
    <div className="market-chart">
      <div className="chart-price" ref={priceHost} />
      <div className="chart-volume">
        <div className="volume-label">حجم معاملات</div>
        <div className="chart-volume-host" ref={volumeHost} />
      </div>
    </div>
  );
}
