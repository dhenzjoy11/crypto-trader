import {
  ColorType,
  CrosshairMode,
  IChartApi,
  IPriceLine,
  ISeriesApi,
  LineStyle,
  SeriesMarker,
  UTCTimestamp,
  createChart,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { Analysis, Candle, Interval, LiveTick, PaperTrade } from "../types";

interface Props {
  candles: Candle[];
  analysis: Analysis | null;
  tick: LiveTick | null;
  interval: Interval;
  trades?: PaperTrade[];
  onIntervalChange: (i: Interval) => void;
  loading: boolean;
}

const INTERVALS: Interval[] = ["1m", "5m", "15m", "1h", "6h", "1d"];

const INTERVAL_SECONDS: Record<Interval, number> = {
  "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "6h": 21600, "1d": 86400,
};

type LC = UTCTimestamp;

interface LiveCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export default function Chart({ candles, analysis, tick, interval, trades = [], onIntervalChange, loading }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);

  // Overlay line series — created once, data updated via setData
  const ema9Ref  = useRef<ISeriesApi<"Line"> | null>(null);
  const ema21Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const bbURef   = useRef<ISeriesApi<"Line"> | null>(null);
  const bbMRef   = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLRef   = useRef<ISeriesApi<"Line"> | null>(null);

  // Price lines tracked so we can remove them before adding new ones
  const priceLineRefs = useRef<IPriceLine[]>([]);

  // Tracks the running OHLCV of the live (last) candle between data refreshes
  const liveCandleRef = useRef<LiveCandle | null>(null);

  const [showEMA, setShowEMA] = useState<boolean>(() => {
    const s = localStorage.getItem("crypto_trader_show_ema");
    return s === null ? false : s === "true";   // default: off
  });
  const [showBB, setShowBB] = useState<boolean>(() => {
    const s = localStorage.getItem("crypto_trader_show_bb");
    return s === null ? false : s === "true";   // default: off
  });

  // ── 1. Create chart and all series once ───────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0b0b14" },
        textColor: "#9e9e9e",
        fontFamily: "JetBrains Mono, monospace",
        fontSize: 11,
      },
      grid: { vertLines: { color: "#1e1e2e" }, horzLines: { color: "#1e1e2e" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#2a2a42" },
      timeScale: { borderColor: "#2a2a42", timeVisible: true, secondsVisible: false },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });
    chartRef.current = chart;

    candleSeriesRef.current = chart.addCandlestickSeries({
      upColor: "#00c853", downColor: "#ff1744",
      borderUpColor: "#00c853", borderDownColor: "#ff1744",
      wickUpColor: "#00c853", wickDownColor: "#ff1744",
    });

    const volSeries = chart.addHistogramSeries({
      color: "#2979ff30",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    // v4 API: series.priceScale() reaches the series' own overlay scale;
    // chart.priceScale("volume") silently falls back to the right scale, which
    // is the bug that inflates the Y-axis to match SOL's 80k volume units.
    volSeries.priceScale().applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    // Reserve the same bottom margin on the main right scale so candle lows
    // stay visually above the volume bar area.
    chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.02, bottom: 0.15 } });
    volSeriesRef.current = volSeries;

    const lineOpts = { crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false };

    ema9Ref.current  = chart.addLineSeries({ ...lineOpts, color: "#ffeb3b", lineWidth: 1 });
    ema21Ref.current = chart.addLineSeries({ ...lineOpts, color: "#ff9800", lineWidth: 1 });
    ema50Ref.current = chart.addLineSeries({ ...lineOpts, color: "#7c4dff", lineWidth: 1 });
    bbURef.current   = chart.addLineSeries({ ...lineOpts, color: "#2979ff", lineWidth: 1 });
    bbMRef.current   = chart.addLineSeries({ ...lineOpts, color: "#546e7a", lineWidth: 1, lineStyle: LineStyle.Dashed });
    bbLRef.current   = chart.addLineSeries({ ...lineOpts, color: "#2979ff", lineWidth: 1 });

    // ResizeObserver — use rAF to avoid mid-layout measurements
    let rafId = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (containerRef.current && chartRef.current) {
          chartRef.current.applyOptions({
            width: containerRef.current.clientWidth,
            height: containerRef.current.clientHeight,
          });
        }
      });
    });
    ro.observe(containerRef.current);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
      ema9Ref.current = ema21Ref.current = ema50Ref.current = null;
      bbURef.current  = bbMRef.current  = bbLRef.current  = null;
      priceLineRefs.current = [];
      liveCandleRef.current = null;
    };
  }, []);

  // ── 2. Load candle data ───────────────────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current || !volSeriesRef.current) return;

    clearPriceLines();

    if (!candles.length) {
      candleSeriesRef.current.setData([]);
      volSeriesRef.current.setData([]);
      liveCandleRef.current = null;
      return;
    }

    // isFirstLoad: true on the very first data arrival after mount or interval change.
    // Used to decide whether to call fitContent (pair change always remounts via key=,
    // so this catches interval changes where the chart instance is reused).
    const isFirstLoad = liveCandleRef.current === null;

    candleSeriesRef.current.setData(
      candles.map((c) => ({
        time: c.time as LC,
        open: c.open, high: c.high, low: c.low, close: c.close,
      }))
    );

    volSeriesRef.current.setData(
      candles.map((c) => ({
        time: c.time as LC,
        value: c.volume,
        color: c.close >= c.open ? "#00c85330" : "#ff174430",
      }))
    );

    if (isFirstLoad) {
      // Fit time axis and force price scale to re-evaluate the new data range
      chartRef.current?.timeScale().fitContent();
      chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
    }

    // Seed / refresh the live-candle tracker from the latest fetched candle
    const last = candles[candles.length - 1];
    liveCandleRef.current = { time: last.time, open: last.open, high: last.high, low: last.low, close: last.close };
  }, [candles]);

  // ── 3. Update overlay data (setData, not recreate) ────────────────────────
  useEffect(() => {
    if (!analysis?.chart_overlays) {
      // Clear overlays when analysis resets (pair change)
      [ema9Ref, ema21Ref, ema50Ref, bbURef, bbMRef, bbLRef].forEach((r) => r.current?.setData([]));
      return;
    }
    const ov = analysis.chart_overlays;
    const toLC = (pts?: { time: number; value: number }[]) =>
      (pts ?? []).map((p) => ({ time: p.time as LC, value: p.value }));

    ema9Ref.current?.setData(toLC(ov.ema9));
    ema21Ref.current?.setData(toLC(ov.ema21));
    ema50Ref.current?.setData(toLC(ov.ema50));
    bbURef.current?.setData(toLC(ov.bb_upper));
    bbMRef.current?.setData(toLC(ov.bb_middle));
    bbLRef.current?.setData(toLC(ov.bb_lower));
  }, [analysis]);

  // ── 4. Update S/R price lines — max 2R + 2S, ordinal labels ─────────────
  useEffect(() => {
    clearPriceLines();
    if (!analysis?.support_resistance || !candleSeriesRef.current) return;

    const levels = analysis.support_resistance;
    // Backend already sorts resistance ascending (R1=closest) and support descending (S1=closest)
    const resList = levels.filter((l) => l.type === "resistance").slice(0, 2);
    const supList = levels.filter((l) => l.type === "support").slice(0, 2);

    [...resList.map((l, i) => ({ ...l, label: `R${i + 1}` })),
     ...supList.map((l, i) => ({ ...l, label: `S${i + 1}` }))]
      .forEach(({ price, type, label }) => {
        try {
          const pl = candleSeriesRef.current!.createPriceLine({
            price,
            color: type === "resistance" ? "#ff1744cc" : "#00c853cc",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: label,
          });
          priceLineRefs.current.push(pl);
        } catch {}
      });
  }, [analysis]);

  // ── 5. Trade markers — B/S symbols on candles for paper trades ───────────
  useEffect(() => {
    if (!candleSeriesRef.current || !candles.length) return;
    if (!trades.length) {
      candleSeriesRef.current.setMarkers([]);
      return;
    }

    const intervalSec = INTERVAL_SECONDS[interval];

    // v4.2 throws if ANY marker time isn't an existing bar — build an exact
    // set of loaded candle times so we can filter out-of-range trades first.
    const candleTimeSet = new Set(candles.map((c) => c.time));

    const markers: SeriesMarker<UTCTimestamp>[] = [];
    for (const t of trades) {
      const barTime = (Math.floor(t.timestamp / intervalSec) * intervalSec) as UTCTimestamp;
      if (!candleTimeSet.has(barTime as number)) continue;
      const isBuy = t.side === "buy";
      markers.push({
        time:     barTime,
        position: isBuy ? "belowBar" : "aboveBar",
        shape:    isBuy ? "arrowUp"  : "arrowDown",
        color:    isBuy ? "#00c853"  : "#ff1744",
        text:     isBuy ? "B"        : "S",
        size:     1,
      });
    }

    // lightweight-charts requires markers sorted ascending by time
    markers.sort((a, b) => (a.time as number) - (b.time as number));

    try {
      candleSeriesRef.current.setMarkers(markers);
    } catch {}
  }, [trades, candles, interval]);

  // ── 7. Toggle EMA visibility ──────────────────────────────────────────────
  useEffect(() => {
    [ema9Ref, ema21Ref, ema50Ref].forEach((r) =>
      r.current?.applyOptions({ visible: showEMA })
    );
  }, [showEMA]);

  // ── 6. Toggle BB visibility ───────────────────────────────────────────────
  useEffect(() => {
    [bbURef, bbMRef, bbLRef].forEach((r) =>
      r.current?.applyOptions({ visible: showBB })
    );
  }, [showBB]);

  // ── 7. Live tick — accumulate OHLCV; open a new bar when the period rolls ─
  useEffect(() => {
    if (!tick || !candleSeriesRef.current || !liveCandleRef.current) return;

    // Align tick timestamp to the start of the current interval period
    const tickMs = tick.time ? new Date(tick.time).getTime() : Date.now();
    const intervalSec = INTERVAL_SECONDS[interval];
    const barTime = Math.floor(tickMs / 1000 / intervalSec) * intervalSec;

    const prev = liveCandleRef.current;

    let next: LiveCandle;
    if (barTime > prev.time) {
      // New candle period — open a fresh bar
      next = { time: barTime, open: tick.price, high: tick.price, low: tick.price, close: tick.price };
    } else {
      // Same period — extend the running OHLCV
      next = {
        time:  prev.time,
        open:  prev.open,
        high:  Math.max(prev.high, tick.price),
        low:   Math.min(prev.low,  tick.price),
        close: tick.price,
      };
    }

    liveCandleRef.current = next;
    candleSeriesRef.current.update({
      time:  next.time  as LC,
      open:  next.open,
      high:  next.high,
      low:   next.low,
      close: next.close,
    });
  }, [tick, interval]);

  // Helper — removes all tracked price lines
  function clearPriceLines() {
    priceLineRefs.current.forEach((pl) => {
      try { candleSeriesRef.current?.removePriceLine(pl); } catch {}
    });
    priceLineRefs.current = [];
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-secondary border-b border-bg-border text-xs shrink-0">
        <div className="flex gap-1">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              onClick={() => onIntervalChange(iv)}
              className={`px-2 py-0.5 rounded font-medium transition-colors ${
                interval === iv
                  ? "bg-blue-crypto text-white"
                  : "text-gray-400 hover:text-white hover:bg-bg-card"
              }`}
            >
              {iv}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-bg-border mx-1" />

        <label className="flex items-center gap-1 cursor-pointer text-gray-400 hover:text-white select-none">
          <input
            type="checkbox" checked={showEMA} className="w-3 h-3 accent-yellow-400"
            onChange={(e) => {
              setShowEMA(e.target.checked);
              localStorage.setItem("crypto_trader_show_ema", String(e.target.checked));
            }}
          />
          <span>EMA</span>
        </label>
        <label className="flex items-center gap-1 cursor-pointer text-gray-400 hover:text-white select-none">
          <input
            type="checkbox" checked={showBB} className="w-3 h-3 accent-blue-500"
            onChange={(e) => {
              setShowBB(e.target.checked);
              localStorage.setItem("crypto_trader_show_bb", String(e.target.checked));
            }}
          />
          <span>BB</span>
        </label>

        <div className="flex-1" />

        {loading && <span className="text-gray-500 animate-pulse">Loading…</span>}

        {showEMA && (
          <div className="hidden sm:flex items-center gap-3">
            <span style={{ color: "#ffeb3b" }}>EMA 9</span>
            <span style={{ color: "#ff9800" }}>EMA 21</span>
            <span style={{ color: "#7c4dff" }}>EMA 50</span>
          </div>
        )}
        {showBB && <span style={{ color: "#2979ff" }}>BB(20)</span>}
      </div>

      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  );
}
