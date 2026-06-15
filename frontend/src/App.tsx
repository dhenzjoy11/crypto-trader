import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AutoConfigPanel from "./components/AutoConfigPanel";
import Chart from "./components/Chart";
import Header from "./components/Header";
import OrderPanel from "./components/OrderPanel";
import PaperTradingPanel from "./components/PaperTradingPanel";
import PortfolioSidebar from "./components/PortfolioSidebar";
import SignalPanel from "./components/SignalPanel";
import SupportResistance from "./components/SupportResistance";
import WatchlistTable, { type WatchlistRow } from "./components/WatchlistTable";
import { useTickerSocket } from "./hooks/useWebSocket";
import { useWatchlistTickers } from "./hooks/useWatchlistTickers";
import { api } from "./services/api";
import type { Analysis, AutoTradeLog, AutoTradeStatus, Candle, Interval, PaperPortfolio, PaperTrade, Portfolio, Product, SRLevel, Ticker } from "./types";

const DEFAULT_PAIR      = "BTC-USD";
const DEFAULT_WATCHLIST = ["BTC-USD", "ETH-USD"];
const LS_PAIR_KEY        = "crypto_trader_pair";
const LS_INTERVAL_KEY    = "crypto_trader_interval";
const LS_WATCHLIST_KEY   = "crypto_trader_watchlist";
const VALID_INTERVALS    = ["1m","5m","15m","1h","6h","1d"] as const;
const CANDLE_REFRESH_MS         = 60_000;
const ANALYSIS_REFRESH_MS       = 60_000;
const TICKER_REFRESH_MS         = 15_000;
const PORTFOLIO_REFRESH_MS      = 60_000;
const WATCHLIST_REFRESH_MS      = 60_000;
const PAPER_PORTFOLIO_REFRESH_MS = 15_000;

type RightTab = "signals" | "sr" | "order" | "paper" | "auto";

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  // Restore last-viewed pair from localStorage so browser refresh keeps the selection
  const [selectedId, setSelectedId] = useState<string>(
    () => localStorage.getItem(LS_PAIR_KEY) ?? DEFAULT_PAIR
  );
  const [ticker, setTicker] = useState<Ticker | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [chartInterval, setChartInterval] = useState<Interval>(() => {
    const s = localStorage.getItem(LS_INTERVAL_KEY) as Interval | null;
    return s && (VALID_INTERVALS as readonly string[]).includes(s) ? s : "1h";
  });
  const [authenticated, setAuthenticated] = useState(false);
  const [paperPortfolio, setPaperPortfolio] = useState<PaperPortfolio | null>(null);
  const [allPaperTrades, setAllPaperTrades] = useState<PaperTrade[]>([]);
  const [rightTab, setRightTab] = useState<RightTab>("signals");
  const [orderSide, setOrderSide] = useState<"buy" | "sell">("buy");
  const [autoStatus, setAutoStatus] = useState<Record<string, AutoTradeStatus>>({});
  const [autoTradeLogs, setAutoTradeLogs] = useState<AutoTradeLog[]>([]);
  const [liveOrderHistory, setLiveOrderHistory] = useState<PaperTrade[]>([]);
  const [loadingCandles, setLoadingCandles] = useState(false);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);

  // Watchlist — persisted list of symbols the user cares about
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try {
      const s = localStorage.getItem(LS_WATCHLIST_KEY);
      const parsed = s ? JSON.parse(s) : null;
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : DEFAULT_WATCHLIST;
    } catch { return DEFAULT_WATCHLIST; }
  });
  // Price + S/R data for every watchlist item (feeds the bottom table)
  const [watchlistData, setWatchlistData] = useState<Record<string, WatchlistRow>>({});

  const candlesTimer          = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const analysisTimer         = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const tickerTimer           = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const portfolioTimer        = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const paperPortfolioTimer   = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const watchlistTimer        = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const autoStatusTimer       = useRef<ReturnType<typeof window.setInterval> | null>(null);
  const prevPriceRef      = useRef<number | null>(null);
  const lastBreachFetchMs = useRef<number>(0);
  // Always holds the pair that is currently selected — used to discard responses
  // from in-flight API calls that started before the most recent pair change.
  const activePairRef = useRef<string>(selectedId);

  const { tick, connected: wsConnected } = useTickerSocket(selectedId);

  // Only use live price if it belongs to the currently selected pair
  const livePrice = tick?.product_id === selectedId ? tick.price : null;

  // Poll tickers for all watchlist items every 5s so the table stays live
  const watchlistTickers = useWatchlistTickers(watchlist);

  // Override the active pair's ticker price with the live WS feed (sub-second updates)
  const mergedTickers = useMemo<Record<string, Ticker>>(() => {
    if (!livePrice || !watchlistTickers[selectedId]) return watchlistTickers;
    return {
      ...watchlistTickers,
      [selectedId]: { ...watchlistTickers[selectedId], price: livePrice },
    };
  }, [watchlistTickers, selectedId, livePrice]);

  // ── Bootstrap ──────────────────────────────────────────────────────────────

  useEffect(() => {
    api.products().then(setProducts).catch(console.error);
    api.authStatus().then((s) => setAuthenticated(s.authenticated)).catch(() => {});
  }, []);

  // ── Candles ────────────────────────────────────────────────────────────────

  const fetchCandles = useCallback(async () => {
    const forPair = selectedId;  // capture at call time
    setLoadingCandles(true);
    try {
      const data = await api.candles(selectedId, chartInterval, 250);
      // Discard if the user switched pairs while this request was in-flight.
      // Without this guard the stale response corrupts isFirstLoad and the
      // wrong pair's candles (+ scale) appear for the newly selected symbol.
      if (activePairRef.current === forPair) setCandles(data);
    } catch (e) {
      console.error("candles:", e);
    } finally {
      if (activePairRef.current === forPair) setLoadingCandles(false);
    }
  }, [selectedId, chartInterval]);

  // ── Ticker ─────────────────────────────────────────────────────────────────

  const fetchTicker = useCallback(async () => {
    const forPair = selectedId;
    try {
      const t = await api.ticker(selectedId);
      if (activePairRef.current === forPair) setTicker(t);
    } catch {}
  }, [selectedId]);

  // ── Analysis ───────────────────────────────────────────────────────────────

  const fetchAnalysis = useCallback(async () => {
    const forPair = selectedId;
    setLoadingAnalysis(true);
    try {
      const a = await api.analysis(selectedId, chartInterval);
      if (activePairRef.current === forPair) setAnalysis(a);
    } catch (e) {
      console.error("analysis:", e);
    } finally {
      if (activePairRef.current === forPair) setLoadingAnalysis(false);
    }
  }, [selectedId, chartInterval]);

  // ── Portfolio ──────────────────────────────────────────────────────────────

  const fetchPortfolio = useCallback(async () => {
    if (!authenticated) return;
    try {
      const p = await api.portfolio();
      setPortfolio(p);
    } catch {}
  }, [authenticated]);

  // ── Paper portfolio + trades (feeds watchlist columns and chart markers) ───

  const fetchPaperPortfolio = useCallback(async () => {
    try {
      const p = await api.paper.portfolio();
      setPaperPortfolio(p);
    } catch {}
  }, []);

  const fetchPaperTrades = useCallback(async () => {
    try {
      const t = await api.paper.trades(500);
      setAllPaperTrades(t);
    } catch {}
  }, []);

  // ── Watchlist data (feeds the bottom table) ────────────────────────────────

  // Fetch price + S/R for every watchlist item that isn't the active chart pair
  // (the active pair is kept in sync via the analysis effect below).
  const fetchWatchlistData = useCallback(async () => {
    const others = watchlist.filter((id) => id !== selectedId);
    const entries = await Promise.all(
      others.map(async (id) => {
        try {
          const anal = await api.analysis(id, "1h");
          return [id, { price: anal.current_price, sr: anal.support_resistance }] as const;
        } catch {
          return [id, { price: null, sr: [] as SRLevel[] }] as const;
        }
      })
    );
    setWatchlistData((prev) => {
      const next = { ...prev };
      for (const [id, row] of entries) next[id] = row;
      return next;
    });
  }, [watchlist, selectedId]);

  // ── Watchlist management ───────────────────────────────────────────────────

  const addToWatchlist = useCallback((id: string) => {
    setWatchlist((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      localStorage.setItem(LS_WATCHLIST_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const removeFromWatchlist = useCallback((id: string) => {
    setWatchlist((prev) => {
      const next = prev.filter((w) => w !== id);
      localStorage.setItem(LS_WATCHLIST_KEY, JSON.stringify(next));
      return next;
    });
    // Remove stale data from the table
    setWatchlistData((prev) => { const n = { ...prev }; delete n[id]; return n; });
  }, []);

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetchCandles();
    fetchTicker();
    fetchAnalysis();

    if (candlesTimer.current)  window.clearInterval(candlesTimer.current);
    if (tickerTimer.current)   window.clearInterval(tickerTimer.current);
    if (analysisTimer.current) window.clearInterval(analysisTimer.current);

    // Periodically pull newly-completed candles so the chart stays live
    candlesTimer.current  = window.setInterval(fetchCandles,  CANDLE_REFRESH_MS);
    tickerTimer.current   = window.setInterval(fetchTicker,   TICKER_REFRESH_MS);
    analysisTimer.current = window.setInterval(fetchAnalysis, ANALYSIS_REFRESH_MS);

    return () => {
      if (candlesTimer.current)  window.clearInterval(candlesTimer.current);
      if (tickerTimer.current)   window.clearInterval(tickerTimer.current);
      if (analysisTimer.current) window.clearInterval(analysisTimer.current);
    };
  }, [fetchCandles, fetchTicker, fetchAnalysis]);

  useEffect(() => {
    fetchPortfolio();
    if (portfolioTimer.current) window.clearInterval(portfolioTimer.current);
    portfolioTimer.current = window.setInterval(fetchPortfolio, PORTFOLIO_REFRESH_MS);
    return () => { if (portfolioTimer.current) window.clearInterval(portfolioTimer.current); };
  }, [fetchPortfolio]);

  useEffect(() => {
    fetchPaperPortfolio();
    fetchPaperTrades();
    if (paperPortfolioTimer.current) window.clearInterval(paperPortfolioTimer.current);
    paperPortfolioTimer.current = window.setInterval(() => {
      fetchPaperPortfolio();
      fetchPaperTrades();
    }, PAPER_PORTFOLIO_REFRESH_MS);
    return () => { if (paperPortfolioTimer.current) window.clearInterval(paperPortfolioTimer.current); };
  }, [fetchPaperPortfolio, fetchPaperTrades]);

  // Fetch watchlist table data and refresh every minute
  useEffect(() => {
    fetchWatchlistData();
    if (watchlistTimer.current) window.clearInterval(watchlistTimer.current);
    watchlistTimer.current = window.setInterval(fetchWatchlistData, WATCHLIST_REFRESH_MS);
    return () => { if (watchlistTimer.current) window.clearInterval(watchlistTimer.current); };
  }, [fetchWatchlistData]);

  // Keep the active chart pair's row in the table current without an extra fetch
  useEffect(() => {
    if (analysis) {
      setWatchlistData((prev) => ({
        ...prev,
        [selectedId]: { price: analysis.current_price, sr: analysis.support_resistance },
      }));
    }
  }, [analysis, selectedId]);

  // Update ticker with live WS price — guard by product_id to prevent stale
  // ticks from a previous pair overwriting the header price during reconnect
  useEffect(() => {
    if (tick && ticker && tick.product_id === selectedId) {
      setTicker((prev) => prev ? { ...prev, price: tick.price, bid: tick.best_bid, ask: tick.best_ask } : prev);
    }
  }, [tick, selectedId]);

  // Breach detection — when price crosses any S/R level, immediately refetch
  // analysis so the levels recalculate around the new price context.
  // 10 s cooldown prevents rapid-fire refetches on choppy price action.
  useEffect(() => {
    if (!livePrice || !analysis?.support_resistance?.length) {
      prevPriceRef.current = livePrice;
      return;
    }

    const prev = prevPriceRef.current;
    prevPriceRef.current = livePrice;
    if (prev === null) return;

    const breached = analysis.support_resistance.some((lvl) =>
      lvl.type === "resistance"
        ? prev < lvl.price && livePrice >= lvl.price   // crossed above resistance
        : prev > lvl.price && livePrice <= lvl.price   // crossed below support
    );

    if (breached && Date.now() - lastBreachFetchMs.current > 10_000) {
      lastBreachFetchMs.current = Date.now();
      fetchAnalysis();
    }
  }, [livePrice, analysis, fetchAnalysis]);

  // Central handler for pair changes — saves to localStorage so the selection
  // survives browser refreshes, and wipes stale data for the previous pair
  const selectPair = useCallback((id: string) => {
    activePairRef.current = id;   // update before any async calls read it
    localStorage.setItem(LS_PAIR_KEY, id);
    setSelectedId(id);
    setAnalysis(null);
    setCandles([]);
    setTicker(null);
    setAutoTradeLogs([]);
    setLiveOrderHistory([]);
  }, []);

  // Called from watchlist table Buy/Sell buttons — select the pair, open order tab,
  // and pre-select the correct side in the order form.
  const handleTrade = useCallback((id: string, side: "buy" | "sell") => {
    if (id !== selectedId) selectPair(id);
    setRightTab("order");
    setOrderSide(side);
  }, [selectedId, selectPair]);

  // ── Auto-trading status polling ────────────────────────────────────────────

  const fetchAutoStatus = useCallback(async () => {
    try {
      const s = await api.autoTrade.status();
      setAutoStatus(s);
    } catch {}
  }, []);

  const fetchAutoTradeLogs = useCallback(async () => {
    try {
      const logs = await api.autoTrade.logs(selectedId);
      setAutoTradeLogs(logs);
    } catch {}
  }, [selectedId]);

  const fetchLiveOrderHistory = useCallback(async () => {
    if (!authenticated) return;
    try {
      const orders = await api.orderHistory(selectedId);
      setLiveOrderHistory(orders.map((o) => ({
        trade_id:     o.order_id,
        product_id:   selectedId,
        side:         o.side as "buy" | "sell",
        qty:          o.qty,
        price:        o.price,
        value:        o.qty * o.price,
        fee:          0,
        realized_pnl: null,
        timestamp:    o.timestamp,
      })));
    } catch {}
  }, [selectedId, authenticated]);

  useEffect(() => {
    fetchAutoStatus();
    fetchAutoTradeLogs();
    fetchLiveOrderHistory();
    if (autoStatusTimer.current) window.clearInterval(autoStatusTimer.current);
    autoStatusTimer.current = window.setInterval(() => {
      fetchAutoStatus();
      fetchAutoTradeLogs();
      fetchLiveOrderHistory();
    }, 10_000);
    return () => { if (autoStatusTimer.current) window.clearInterval(autoStatusTimer.current); };
  }, [fetchAutoStatus, fetchAutoTradeLogs, fetchLiveOrderHistory]);

  const handleAutoToggle = useCallback(async (
    id: string,
    tradeAmount: number,
    maxInvestment: number,
    tp1: number,
    tp2: number,
    entryPrice?: number,
    forceFresh?: boolean,
    mode?: "paper" | "live",
  ) => {
    try {
      if (autoStatus[id]?.active) {
        await api.autoTrade.stop(id);
      } else {
        await api.autoTrade.start(id, tradeAmount, maxInvestment, tp1, tp2, entryPrice, forceFresh, mode);
        setRightTab("auto");
      }
      await fetchAutoStatus();
    } catch (e) {
      console.error("autoToggle:", e);
    }
  }, [autoStatus, fetchAutoStatus]);

  const selectedProduct = products.find((p) => p.id === selectedId);

  const selectedTrades = useMemo(
    () => allPaperTrades.filter((t) => t.product_id === selectedId),
    [allPaperTrades, selectedId]
  );

  // Chart marker sources (merged, deduped by trade_id):
  //   1. Paper trades   — for paper-mode bot actions (already recorded there)
  //   2. Auto-trade logs — for live-mode bot actions (not in paper trading)
  //   3. Live order history — real Coinbase fills (manual + live bot orders)
  //   Live order history may overlap auto-trade logs; dedupe by rounding timestamp to the candle.
  const chartTrades = useMemo<PaperTrade[]>(() => {
    const status = autoStatus[selectedId];
    const fromLogs: PaperTrade[] = (status?.mode === "live" ? autoTradeLogs : [])
      .filter((log) => !log.action.startsWith("HOLD"))
      .map((log) => ({
        trade_id:     `auto-${log.timestamp}`,
        product_id:   selectedId,
        side:         log.action.startsWith("BUY") ? "buy" as const : "sell" as const,
        qty:          0,
        price:        log.price,
        value:        0,
        fee:          0,
        realized_pnl: null,
        timestamp:    log.timestamp,
      }));

    // Dedupe live orders against bot logs: if a log entry already covers the same
    // candle+side, skip the raw Coinbase order to avoid double markers.
    const logTimestamps = new Set(fromLogs.map((t) => Math.floor(t.timestamp / 3600) * 3600));
    const fromHistory = liveOrderHistory.filter(
      (o) => !logTimestamps.has(Math.floor(o.timestamp / 3600) * 3600)
    );

    return [...selectedTrades, ...fromLogs, ...fromHistory];
  }, [selectedTrades, autoTradeLogs, liveOrderHistory, autoStatus, selectedId]);

  return (
    <div className="flex flex-col h-screen bg-bg-primary overflow-hidden">
      {/* Header */}
      <Header
        products={products}
        watchlist={watchlist}
        selectedId={selectedId}
        ticker={ticker}
        livePrice={livePrice}
        wsConnected={wsConnected}
        onSelect={selectPair}
        onAddToWatchlist={addToWatchlist}
        onRemoveFromWatchlist={removeFromWatchlist}
      />

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar — Portfolio */}
        <div className="w-52 shrink-0 border-r border-bg-border overflow-hidden flex flex-col bg-bg-secondary">
          <PortfolioSidebar
            portfolio={portfolio}
            loading={false}
            authenticated={authenticated}
            products={products}
            onSelectPair={selectPair}
          />
        </div>

        {/* Center — Chart + bottom panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Main chart — 70% */}
          <div className="h-[70%] overflow-hidden">
            <Chart
              key={selectedId}
              candles={candles}
              analysis={analysis}
              tick={tick}
              interval={chartInterval}
              trades={chartTrades}
              onIntervalChange={(iv) => {
                localStorage.setItem(LS_INTERVAL_KEY, iv);
                setChartInterval(iv);
                setCandles([]);
                setAnalysis(null);
              }}
              loading={loadingCandles}
            />
          </div>

          {/* Bottom panel — 30% — watchlist table */}
          <div className="h-[30%] border-t border-bg-border bg-bg-secondary flex flex-col overflow-hidden">
            <WatchlistTable
              watchlist={watchlist}
              data={watchlistData}
              products={products}
              selectedId={selectedId}
              tickers={mergedTickers}
              portfolio={portfolio}
              paperPortfolio={paperPortfolio}
              autoStatus={autoStatus}
              onSelect={selectPair}
              onTrade={handleTrade}
              onAutoToggle={handleAutoToggle}
            />
          </div>
        </div>

        {/* Right sidebar — tabs */}
        <div className={`shrink-0 border-l border-bg-border flex flex-col bg-bg-secondary overflow-hidden transition-all ${
          rightTab === "paper" || rightTab === "auto" ? "w-72" : "w-64"
        }`}>
          {/* Tab bar */}
          <div className="flex border-b border-bg-border text-xs font-medium">
            {(
              [
                { key: "signals", label: "Signals" },
                { key: "sr",      label: "S/R"     },
                { key: "order",   label: "Order"   },
                { key: "paper",   label: "Paper"   },
                { key: "auto",    label: "Auto"    },
              ] as { key: RightTab; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setRightTab(key)}
                className={`flex-1 py-2 transition-colors border-b-2 text-[11px] ${
                  rightTab === key
                    ? key === "paper" || key === "auto"
                      ? "text-yellow-crypto border-yellow-crypto"
                      : "text-blue-crypto border-blue-crypto"
                    : "text-gray-500 border-transparent hover:text-gray-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {rightTab === "signals" && (
              <SignalPanel
                analysis={analysis}
                loading={loadingAnalysis}
                onRefresh={fetchAnalysis}
              />
            )}
            {rightTab === "sr" && (
              <SupportResistance
                levels={analysis?.support_resistance ?? []}
                currentPrice={livePrice ?? analysis?.current_price ?? null}
              />
            )}
            {rightTab === "order" && (
              <OrderPanel
                product={selectedProduct}
                ticker={ticker}
                livePrice={livePrice}
                authenticated={authenticated}
                defaultSide={orderSide}
              />
            )}
            {rightTab === "paper" && (
              <PaperTradingPanel
                selectedId={selectedId}
                livePrice={livePrice}
                ticker={ticker}
                onOrderFilled={() => { fetchPaperPortfolio(); fetchPaperTrades(); }}
              />
            )}
            {rightTab === "auto" && (
              <AutoConfigPanel
                autoStatus={autoStatus}
                products={products}
                watchlist={watchlist}
                onRefresh={fetchAutoStatus}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
