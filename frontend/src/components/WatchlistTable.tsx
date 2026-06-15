import { useEffect, useRef, useState } from "react";
import type { AutoTradeStatus, PaperPortfolio, Portfolio, Product, SRLevel, Ticker } from "../types";

export interface WatchlistRow {
  price: number | null;
  sr: SRLevel[];
}

interface Props {
  watchlist: string[];
  data: Record<string, WatchlistRow>;
  products: Product[];
  selectedId: string;
  tickers: Record<string, Ticker>;
  portfolio: Portfolio | null;
  paperPortfolio: PaperPortfolio | null;
  autoStatus: Record<string, AutoTradeStatus>;
  onSelect: (id: string) => void;
  onTrade: (id: string, side: "buy" | "sell") => void;
  onAutoToggle: (id: string, tradeAmount: number, maxInvestment: number, tp1: number, tp2: number, entryPrice?: number, forceFresh?: boolean, mode?: "paper" | "live") => void;
}

function fmt(price: number | null, forceDp?: number): string {
  if (price === null) return "—";
  const dp = forceDp ?? (price < 1 ? 6 : price < 100 ? 4 : 2);
  return "$" + price.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtQty(qty: number, symbol: string): string {
  if (qty === 0) return "—";
  const digits = qty >= 1 ? 4 : 8;
  return qty.toLocaleString("en-US", { maximumFractionDigits: digits }) + " " + symbol;
}

function fmtPnl(val: number): string {
  const sign = val >= 0 ? "+" : "−";
  return sign + "$" + Math.abs(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Maps strategy action values to short human-readable labels
const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  BUY_INITIAL:        { label: "BUY",       color: "text-green-crypto"  },
  BUY_ADD_SUPPORT:    { label: "+BUY S",    color: "text-green-crypto"  },
  BUY_ADD_BREAKOUT:   { label: "+BUY B",    color: "text-blue-crypto"   },
  SELL_TP1:           { label: "TP1 50%",   color: "text-green-crypto"  },
  SELL_TP2:           { label: "TP2 ALL",   color: "text-green-crypto"  },
  SELL_TAKE_PROFIT:   { label: "TAKE PROF", color: "text-green-crypto"  }, // backwards compat
  SELL_STOP:          { label: "STOP",      color: "text-red-crypto"    },
  SELL_TRAILING_STOP: { label: "TRAIL",     color: "text-yellow-crypto" },
  HOLD:               { label: "HOLD",      color: "text-gray-500"      },
};

// ── Auto-trade config popup ───────────────────────────────────────────────────

interface AutoConfigPopupProps {
  id: string;
  anchorEl: HTMLElement;
  pausedStatus: AutoTradeStatus | null;
  onConfirm: (tradeAmount: number, maxInvestment: number, tp1: number, tp2: number, entryPrice?: number, forceFresh?: boolean, mode?: "paper" | "live") => void;
  onCancel: () => void;
}

function AutoConfigPopup({ id, anchorEl, pausedStatus, onConfirm, onCancel }: AutoConfigPopupProps) {
  const isPaused = !!pausedStatus;

  const [mode,         setMode]         = useState<"resume" | "fresh">(isPaused ? "resume" : "fresh");
  const [tradeMode,    setTradeMode]    = useState<"paper" | "live">(pausedStatus?.mode ?? "paper");
  const [amount,       setAmount]       = useState(String(pausedStatus?.trade_amount_usd ?? 100));
  const [maxInvest,    setMaxInvest]    = useState(String(pausedStatus?.max_investment_usd ?? 500));
  const [tp1,          setTp1]          = useState(String(((pausedStatus?.take_profit_pct_1 ?? 0.05) * 100).toFixed(1)));
  const [tp2,          setTp2]          = useState(String(((pausedStatus?.take_profit_pct_2 ?? 0.20) * 100).toFixed(1)));
  const [entryPrice,   setEntryPrice]   = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const rect = anchorEl.getBoundingClientRect();
  const POPUP_HEIGHT = 360;
  const spaceBelow = window.innerHeight - rect.bottom - 6;
  const openUpward = spaceBelow < POPUP_HEIGHT && rect.top > POPUP_HEIGHT;
  const topPos = openUpward ? rect.top - POPUP_HEIGHT : rect.bottom + 6;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) &&
          !anchorEl.contains(e.target as Node)) {
        onCancel();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [anchorEl, onCancel]);

  const sym = id.split("-")[0];

  function handleConfirm() {
    const ep = entryPrice ? parseFloat(entryPrice) : undefined;
    const fresh = mode === "fresh";
    onConfirm(
      parseFloat(amount)    || 100,
      parseFloat(maxInvest) || 500,
      (parseFloat(tp1) || 5)  / 100,
      (parseFloat(tp2) || 20) / 100,
      ep,
      fresh,
      tradeMode,
    );
  }

  const inputCls = "w-full bg-bg-primary border border-bg-border text-white num rounded px-2 py-1 outline-none focus:border-yellow-crypto text-xs";

  return (
    <div
      ref={ref}
      style={{ position: "fixed", top: topPos, left: Math.max(8, rect.left - 96), zIndex: 200 }}
      className="bg-bg-card border border-bg-border rounded-lg shadow-2xl p-3 w-64 text-xs"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold text-white">
          {mode === "resume" ? "Resume" : "Start"} <span className="text-yellow-crypto">{sym}</span>
        </span>
        {isPaused && (
          <div className="flex gap-1 text-[10px]">
            <button
              onClick={() => setMode("resume")}
              className={`px-1.5 py-0.5 rounded transition-colors ${mode === "resume" ? "bg-yellow-crypto/20 text-yellow-crypto border border-yellow-crypto/40" : "text-gray-500 hover:text-gray-300"}`}
            >Resume</button>
            <button
              onClick={() => setMode("fresh")}
              className={`px-1.5 py-0.5 rounded transition-colors ${mode === "fresh" ? "bg-red-crypto/20 text-red-crypto border border-red-crypto/40" : "text-gray-500 hover:text-gray-300"}`}
            >Fresh</button>
          </div>
        )}
      </div>

      {/* Paused notice */}
      {isPaused && mode === "resume" && (
        <div className="bg-yellow-crypto/10 border border-yellow-crypto/25 rounded px-2 py-1.5 mb-2.5 text-[10px] text-yellow-crypto leading-relaxed">
          {pausedStatus.in_position
            ? `Paused with open position · entry ${pausedStatus.entry_price != null ? "$" + pausedStatus.entry_price.toFixed(4) : "—"}`
            : "Paused · no open position"}
          <br />
          <span className="text-gray-500">Bot will continue from where it left off.</span>
        </div>
      )}
      {isPaused && mode === "fresh" && (
        <div className="bg-red-crypto/10 border border-red-crypto/25 rounded px-2 py-1.5 mb-2.5 text-[10px] text-red-crypto leading-relaxed">
          Paused state will be discarded. A new bot starts fresh.
        </div>
      )}

      {/* Config fields */}
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-gray-500 mb-0.5">Trade Amt (USD)</label>
            <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
              className={inputCls} autoFocus onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }} />
          </div>
          <div>
            <label className="block text-gray-500 mb-0.5">Max Invest (USD)</label>
            <input type="number" value={maxInvest} onChange={(e) => setMaxInvest(e.target.value)}
              className={inputCls} onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-gray-500 mb-0.5">TP1 50% (%)</label>
            <input type="number" value={tp1} onChange={(e) => setTp1(e.target.value)}
              className={inputCls} onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }} />
          </div>
          <div>
            <label className="block text-gray-500 mb-0.5">TP2 all (%)</label>
            <input type="number" value={tp2} onChange={(e) => setTp2(e.target.value)}
              className={inputCls} onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }} />
          </div>
        </div>

        {/* Entry price — only for fresh start */}
        {mode === "fresh" && (
          <div>
            <label className="block text-gray-500 mb-0.5">Entry Price (optional)</label>
            <input
              type="number" value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)}
              placeholder="Leave blank → buy at next candle"
              className={inputCls + " placeholder:text-gray-700"}
              onKeyDown={(e) => { if (e.key === "Enter") handleConfirm(); }}
            />
          </div>
        )}
      </div>

      {/* Paper / Live toggle */}
      <div className="mt-3 flex rounded overflow-hidden border border-bg-border text-[10px] font-semibold">
        <button
          onClick={() => setTradeMode("paper")}
          className={`flex-1 py-1 transition-colors ${tradeMode === "paper" ? "bg-blue-500/20 text-blue-400" : "text-gray-500 hover:text-gray-300"}`}
        >
          Paper
        </button>
        <button
          onClick={() => setTradeMode("live")}
          className={`flex-1 py-1 transition-colors ${tradeMode === "live" ? "bg-green-crypto/20 text-green-crypto" : "text-gray-500 hover:text-gray-300"}`}
        >
          Live
        </button>
      </div>
      {tradeMode === "live" && (
        <p className="text-[10px] text-orange-400 mt-1 leading-relaxed">
          ⚠ Live mode places real orders on Coinbase.
        </p>
      )}

      <div className="flex gap-1.5 mt-2">
        <button
          onClick={handleConfirm}
          className={`flex-1 py-1 font-semibold rounded hover:brightness-110 transition-colors text-xs ${
            tradeMode === "live"
              ? "bg-green-crypto text-bg-primary"
              : "bg-yellow-crypto text-bg-primary"
          }`}
        >
          {mode === "resume" ? "Resume" : entryPrice ? "Start at $" + entryPrice : "Start"}
        </button>
        <button
          onClick={onCancel}
          className="flex-1 py-1 border border-bg-border text-gray-500 hover:text-white rounded transition-colors text-xs"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function WatchlistTable({
  watchlist, data, products, selectedId, tickers, portfolio, paperPortfolio,
  autoStatus, onSelect, onTrade, onAutoToggle,
}: Props) {
  // Track which row's "Auto" config popup is open and the anchor button element
  const [autoConfig, setAutoConfig] = useState<{ id: string; anchor: HTMLElement } | null>(null);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-1.5 border-b border-bg-border shrink-0 flex items-center gap-3">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Watchlist</span>
        <span className="text-[10px] text-gray-600">live · 5s</span>
        {Object.values(autoStatus).some((s) => s.active) && (
          <span className="flex items-center gap-1 text-[10px] text-yellow-crypto">
            <span className="w-1.5 h-1.5 rounded-full bg-yellow-crypto animate-pulse inline-block" />
            {Object.values(autoStatus).filter((s) => s.active).length} auto
          </span>
        )}
        {Object.values(autoStatus).some((s) => s.paused) && (
          <span className="text-[10px] text-amber-400">
            {Object.values(autoStatus).filter((s) => s.paused).length} paused
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse min-w-[1060px]">
          <thead className="sticky top-0 bg-bg-secondary z-10">
            <tr className="border-b border-bg-border">
              <th className="px-3 py-1.5 text-left font-medium text-gray-500 w-[100px]">Symbol</th>
              <th className="px-2 py-1.5 text-right font-medium text-green-crypto/50 w-[76px]">S2</th>
              <th className="px-2 py-1.5 text-right font-medium text-green-crypto w-[76px]">S1</th>
              <th className="px-2 py-1.5 text-center font-medium text-gray-300 w-[88px]">Current</th>
              <th className="px-2 py-1.5 text-right font-medium text-red-crypto w-[76px]">R1</th>
              <th className="px-2 py-1.5 text-right font-medium text-red-crypto/50 w-[76px]">R2</th>
              <th className="px-2 py-1.5 text-right font-medium text-gray-400 w-[110px]">MV / Qty</th>
              <th className="px-2 py-1.5 text-right font-medium text-gray-400 w-[110px]">Price / Cost</th>
              <th className="px-2 py-1.5 text-right font-medium text-gray-400 w-[88px]">24h</th>
              <th className="px-2 py-1.5 text-right font-medium text-gray-400 w-[88px]">P/L</th>
              <th className="px-2 py-1.5 text-center font-medium text-gray-400 w-[112px]">Actions</th>
            </tr>
          </thead>

          <tbody>
            {watchlist.map((id) => {
              const row     = data[id];
              const product = products.find((p) => p.id === id);
              const name    = product?.display_name || id;
              const loadingSr = !row;

              const ticker    = tickers[id];
              const livePrice = ticker?.price ?? row?.price ?? null;
              const changePct = ticker?.change_pct_24h ?? null;

              const resistance = (row?.sr ?? []).filter((l) => l.type === "resistance").sort((a, b) => a.price - b.price).slice(0, 2);
              const support    = (row?.sr ?? []).filter((l) => l.type === "support").sort((a, b) => b.price - a.price).slice(0, 2);

              const r1 = resistance[0]?.price ?? null;
              const r2 = resistance[1]?.price ?? null;
              const s1 = support[0]?.price    ?? null;
              const s2 = support[1]?.price    ?? null;

              const baseCurrency = product?.base_currency || id.replace(/-USD$/, "").replace(/-USDT$/, "");
              const realAccount  = portfolio?.accounts.find((a) => a.currency === baseCurrency);
              const paperPos     = paperPortfolio?.positions.find((p) => p.product_id === id);
              const hasPaper     = paperPos != null && paperPos.qty > 0;

              // cost-per-unit for real account (cost_basis is total USD spent, total_balance is crypto qty)
              const realCostPerUnit = (
                !hasPaper &&
                realAccount &&
                !realAccount.is_cash &&
                (realAccount.cost_basis ?? 0) > 0 &&
                (realAccount.total_balance ?? 0) > 0
              ) ? (realAccount.cost_basis! / realAccount.total_balance) : null;

              // Prefer paper position if it exists; fall back to real portfolio
              const qty = hasPaper ? paperPos.qty : (realAccount?.total_balance ?? 0);
              // Always use live price for MV so symbols like ZORA-USD (no Exchange API ticker) display correctly
              const mv  = hasPaper
                ? (livePrice ? qty * livePrice : paperPos.market_value)
                : (realAccount?.value_usd ?? (qty > 0 && livePrice ? qty * livePrice : null));
              const avgCost = hasPaper ? paperPos.avg_cost : (realCostPerUnit ?? null);

              // Recompute P/L from live price when possible so out-of-date Coinbase snapshots
              // don't lag (e.g. ZORA-USD not on Exchange API falls back to stored unrealized_pnl).
              const livePnl = hasPaper && livePrice && paperPos.avg_cost
                ? (livePrice - paperPos.avg_cost) * paperPos.qty
                : hasPaper
                  ? paperPos.unrealized_pnl
                  : livePrice && realCostPerUnit && (realAccount!.total_balance ?? 0) > 0
                    ? (livePrice - realCostPerUnit) * realAccount!.total_balance
                    : (realAccount?.unrealized_pnl ?? null);

              const livePnlPct = hasPaper && livePrice && paperPos.avg_cost && paperPos.avg_cost > 0
                ? ((livePrice - paperPos.avg_cost) / paperPos.avg_cost) * 100
                : hasPaper
                  ? paperPos.unrealized_pnl_pct
                  : livePrice && realCostPerUnit && realCostPerUnit > 0
                    ? ((livePrice - realCostPerUnit) / realCostPerUnit) * 100
                    : (realAccount?.cost_basis && realAccount.cost_basis > 0 && realAccount.unrealized_pnl != null
                        ? (realAccount.unrealized_pnl / realAccount.cost_basis) * 100
                        : null);

              const unrealizedPnl    = livePnl;
              const unrealizedPnlPct = livePnlPct;
              // 24h column: shows the coin's daily price move (not position P/L)
              const dailyPct    = ticker?.change_pct_24h ?? null;
              const dailyDollar = (ticker?.change_24h != null && qty > 0) ? ticker.change_24h * qty : null;
              const priceColor = changePct !== null ? (changePct >= 0 ? "text-green-crypto" : "text-red-crypto") : "text-white";

              const isSelected = id === selectedId;
              const autoInfo   = autoStatus[id];
              const isActive   = autoInfo?.active === true;
              const isPaused   = autoInfo?.paused === true;
              const isAuto     = isActive; // legacy alias used below for display

              return (
                <tr
                  key={id}
                  onClick={() => onSelect(id)}
                  className={`border-b border-bg-border/50 cursor-pointer transition-colors hover:bg-bg-card ${
                    isSelected ? "bg-bg-card" : ""
                  }`}
                >
                  {/* Symbol */}
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      {isAuto && (
                        <span className="w-1.5 h-1.5 rounded-full bg-yellow-crypto animate-pulse shrink-0" title="Auto-trading active" />
                      )}
                      <span className={`font-semibold ${isSelected ? "text-blue-crypto" : "text-white"}`}>
                        {name}
                      </span>
                    </div>
                    {isAuto && autoInfo?.last_action && (() => {
                      const al = ACTION_LABELS[autoInfo.last_action] ?? { label: autoInfo.last_action, color: "text-gray-500" };
                      return (
                        <div className={`text-[9px] ${al.color} font-semibold mt-0.5`}>
                          ↳ {al.label}
                        </div>
                      );
                    })()}
                  </td>

                  <td className="px-2 py-1.5 num text-right text-green-crypto/50">{loadingSr ? <Sk /> : fmt(s2)}</td>
                  <td className="px-2 py-1.5 num text-right text-green-crypto">{loadingSr ? <Sk /> : fmt(s1)}</td>

                  {/* Current (live) */}
                  <td className="px-2 py-1.5 num text-center font-semibold">
                    {loadingSr && !livePrice ? <Sk center /> : (
                      <span className={priceColor}>{fmt(livePrice)}</span>
                    )}
                  </td>

                  <td className="px-2 py-1.5 num text-right text-red-crypto">{loadingSr ? <Sk /> : fmt(r1)}</td>
                  <td className="px-2 py-1.5 num text-right text-red-crypto/50">{loadingSr ? <Sk /> : fmt(r2)}</td>

                  {/* MV / Qty */}
                  <td className="px-2 py-1.5 num text-right">
                    {qty > 0 ? (
                      <div className="leading-tight">
                        <div className="text-white">{mv !== null ? fmt(mv, 2) : "—"}</div>
                        <div className="text-gray-500 text-[10px]">{fmtQty(qty, baseCurrency)}</div>
                      </div>
                    ) : <span className="text-gray-600">—</span>}
                  </td>

                  {/* Price / Cost */}
                  <td className="px-2 py-1.5 num text-right">
                    <div className="leading-tight">
                      <div className={priceColor}>{fmt(livePrice)}</div>
                      <div className="text-gray-600 text-[10px]">
                        {avgCost != null ? `cost: ${fmt(avgCost)}` : "cost: —"}
                      </div>
                    </div>
                  </td>

                  {/* 24h — coin's daily price change (distinct from position P/L) */}
                  <td className="px-2 py-1.5 num text-right">
                    {dailyPct !== null ? (
                      <div className="leading-tight">
                        <div className={dailyPct >= 0 ? "text-green-crypto" : "text-red-crypto"}>
                          {dailyPct >= 0 ? "+" : ""}{dailyPct.toFixed(2)}%
                        </div>
                        {dailyDollar !== null && (
                          <div className={`text-[10px] ${dailyDollar >= 0 ? "text-green-crypto/70" : "text-red-crypto/70"}`}>
                            {fmtPnl(dailyDollar)}
                          </div>
                        )}
                      </div>
                    ) : <span className="text-gray-600">—</span>}
                  </td>

                  {/* P/L */}
                  <td className="px-2 py-1.5 num text-right">
                    {unrealizedPnl != null ? (
                      <div className="leading-tight">
                        <div className={unrealizedPnl >= 0 ? "text-green-crypto" : "text-red-crypto"}>
                          {fmtPnl(unrealizedPnl)}
                        </div>
                        {unrealizedPnlPct != null && (
                          <div className={`text-[10px] ${unrealizedPnlPct >= 0 ? "text-green-crypto/70" : "text-red-crypto/70"}`}>
                            {unrealizedPnlPct >= 0 ? "+" : ""}{unrealizedPnlPct.toFixed(2)}%
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-gray-600">—</span>
                    )}
                  </td>

                  {/* Actions: Buy | Sell | Auto */}
                  <td className="px-2 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1 justify-center">
                      <button
                        onClick={() => onTrade(id, "buy")}
                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-green-crypto/15 text-green-crypto hover:bg-green-crypto/30 border border-green-crypto/25 transition-colors"
                      >
                        Buy
                      </button>
                      <button
                        onClick={() => onTrade(id, "sell")}
                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-crypto/15 text-red-crypto hover:bg-red-crypto/30 border border-red-crypto/25 transition-colors"
                      >
                        Sell
                      </button>
                      <button
                        onClick={(e) => {
                          if (isActive) {
                            onAutoToggle(id, 0, 0, 0, 0);
                          } else {
                            setAutoConfig({ id, anchor: e.currentTarget });
                          }
                        }}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                          isActive
                            ? "bg-yellow-crypto/25 text-yellow-crypto border-yellow-crypto/50 animate-pulse"
                            : isPaused
                            ? "bg-amber-500/15 text-amber-400 border-amber-500/40 hover:bg-amber-500/25"
                            : "bg-bg-border text-gray-500 hover:text-yellow-crypto border-bg-border hover:border-yellow-crypto/30"
                        }`}
                        title={isActive ? "Stop auto-trading" : isPaused ? "Paused — click to resume or start fresh" : "Start auto-trading"}
                      >
                        {isPaused ? "Paused" : "Auto"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {watchlist.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-gray-600">
                  Use the dropdown to add symbols to your watchlist.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Auto config popup (rendered outside the table to avoid overflow clipping) */}
      {autoConfig && (
        <AutoConfigPopup
          id={autoConfig.id}
          anchorEl={autoConfig.anchor}
          pausedStatus={autoStatus[autoConfig.id]?.paused ? autoStatus[autoConfig.id] : null}
          onConfirm={(tradeAmount, maxInvestment, tp1, tp2, entryPrice, forceFresh, mode) => {
            onAutoToggle(autoConfig.id, tradeAmount, maxInvestment, tp1, tp2, entryPrice, forceFresh, mode);
            setAutoConfig(null);
          }}
          onCancel={() => setAutoConfig(null)}
        />
      )}
    </div>
  );
}

function Sk({ center = false }: { center?: boolean }) {
  return (
    <span className={`inline-block w-14 h-2.5 rounded bg-bg-border animate-pulse ${center ? "mx-auto block" : ""}`} />
  );
}
