import {
  AlertCircle, CheckCircle2, ChevronDown, ChevronUp,
  Loader2, RefreshCw, RotateCcw, X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import type { AutoTradeLog, AutoTradeStatus, PaperOpenOrder, PaperPortfolio, PaperTrade, Ticker } from "../types";

interface Props {
  selectedId: string;
  livePrice: number | null;
  ticker: Ticker | null;
  onOrderFilled?: () => void;
}

const REFRESH_MS = 15_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function usd(v: number | null, dp = 2): string {
  if (v === null) return "—";
  return "$" + Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  });
}

function pct(v: number | null): string {
  if (v === null) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}

function qty(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: v >= 1 ? 4 : 8 });
}

function relTime(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function pnlClass(v: number | null) {
  if (v === null) return "text-gray-500";
  return v >= 0 ? "text-green-crypto" : "text-red-crypto";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, subClass }: {
  label: string; value: string; sub?: string; subClass?: string;
}) {
  return (
    <div className="bg-bg-card rounded px-2 py-1.5 flex-1 min-w-0">
      <div className="text-[10px] text-gray-600 uppercase tracking-wide">{label}</div>
      <div className="num text-sm font-semibold text-white truncate">{value}</div>
      {sub && <div className={`num text-[10px] ${subClass ?? "text-gray-500"}`}>{sub}</div>}
    </div>
  );
}

function Section({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-bg-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500 hover:text-gray-300 transition-colors"
      >
        {title}
        {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}

// ── Auto-trade activity section (fetches its own data) ───────────────────────

const ACTION_COLOR: Record<string, string> = {
  BUY_INITIAL:        "text-green-crypto",
  BUY_ADD_SUPPORT:    "text-green-crypto",
  BUY_ADD_BREAKOUT:   "text-blue-crypto",
  SELL_TP1:           "text-green-crypto",
  SELL_TP2:           "text-green-crypto",
  SELL_TAKE_PROFIT:   "text-green-crypto",  // backwards compat
  SELL_STOP:          "text-red-crypto",
  SELL_TRAILING_STOP: "text-yellow-crypto",
};

function AutoTradeSection() {
  const [statuses, setStatuses]   = useState<Record<string, AutoTradeStatus>>({});
  const [logsMap, setLogsMap]     = useState<Record<string, AutoTradeLog[]>>({});
  const timerRef = useRef<ReturnType<typeof window.setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.autoTrade.status();
      setStatuses(s);
      const entries = await Promise.all(
        Object.keys(s).map(async (pid) => {
          const logs = await api.autoTrade.logs(pid);
          return [pid, logs] as const;
        })
      );
      setLogsMap(Object.fromEntries(entries));
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    timerRef.current = window.setInterval(refresh, 10_000);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [refresh]);

  const active = Object.values(statuses);
  if (active.length === 0) return null;

  return (
    <Section title={`Auto-Trading (${active.length})`} defaultOpen={true}>
      <div className="px-2 pb-1 space-y-2">
        {active.map((st) => {
          const sym  = st.product_id.split("-")[0];
          const logs = logsMap[st.product_id] ?? [];
          return (
            <div key={st.product_id} className="bg-bg-card rounded px-2 py-1.5 space-y-1">
              {/* Header row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-crypto animate-pulse" />
                  <span className="font-semibold text-white">{sym}</span>
                  <span className="text-gray-600 text-[10px]">${st.trade_amount_usd}</span>
                </div>
                <span className={`text-[10px] font-medium ${st.in_position ? "text-green-crypto" : "text-gray-500"}`}>
                  {st.in_position ? `in @ ${usd(st.entry_price, 2)}` : "watching"}
                </span>
              </div>

              {/* Recent log entries */}
              {logs.slice(0, 4).map((log, i) => {
                const color = ACTION_COLOR[log.action] ?? "text-gray-500";
                const dt    = new Date(log.timestamp * 1000);
                const timeStr = dt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
                return (
                  <div key={i} className="flex items-center justify-between text-[10px]">
                    <span className={`font-semibold ${color}`}>{log.action.replace("_", " ")}</span>
                    <span className="num text-gray-600">
                      {usd(log.price, log.price < 1 ? 6 : 2)} · {timeStr}
                    </span>
                  </div>
                );
              })}
              {logs.length === 0 && (
                <p className="text-[10px] text-gray-700">Waiting for next 1h candle…</p>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PaperTradingPanel({ selectedId, livePrice, ticker, onOrderFilled }: Props) {
  const [portfolio, setPortfolio] = useState<PaperPortfolio | null>(null);
  const [trades, setTrades]       = useState<PaperTrade[]>([]);
  const [loading, setLoading]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Form state
  const [side, setSide]           = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [amount, setAmount]       = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [symbol, setSymbol]       = useState(selectedId);

  // Result / error
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const resultTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  // Reset confirm
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetBalance, setResetBalance] = useState("10000");

  const timer = useRef<ReturnType<typeof window.setInterval> | null>(null);

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchAll = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);
    try {
      const [pf, tr] = await Promise.all([api.paper.portfolio(), api.paper.trades(20)]);
      setPortfolio(pf);
      setTrades(tr);
    } catch (e) {
      console.error("paper portfolio fetch:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    timer.current = window.setInterval(() => fetchAll(true), REFRESH_MS);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [fetchAll]);

  // Keep symbol in sync when the chart pair changes (unless user has typed something)
  useEffect(() => { setSymbol(selectedId); }, [selectedId]);

  // ── Derived values ─────────────────────────────────────────────────────────

  const currentPrice = livePrice ?? ticker?.price ?? null;
  const activeSym = symbol.toUpperCase().includes("-") ? symbol.toUpperCase() : `${symbol.toUpperCase()}-USD`;
  const position = portfolio?.positions.find((p) => p.product_id === activeSym);
  const fillRef = orderType === "limit" && limitPrice ? parseFloat(limitPrice) : currentPrice;

  const estimatedQty = side === "buy" && amount && fillRef
    ? parseFloat(amount) / fillRef
    : null;
  const estimatedUsd = side === "sell" && amount && fillRef
    ? parseFloat(amount) * fillRef
    : null;

  // ── Actions ────────────────────────────────────────────────────────────────

  function showResult(ok: boolean, msg: string) {
    setResult({ ok, msg });
    if (resultTimer.current) window.clearTimeout(resultTimer.current);
    resultTimer.current = window.setTimeout(() => setResult(null), 5_000);
  }

  async function handleSubmit() {
    if (!amount || loading) return;
    setLoading(true);
    try {
      await api.paper.order({
        product_id: activeSym,
        side,
        order_type: orderType,
        amount: parseFloat(amount),
        limit_price: orderType === "limit" && limitPrice ? parseFloat(limitPrice) : undefined,
        current_price: currentPrice ?? undefined,
      });
      showResult(true, orderType === "market"
        ? `${side === "buy" ? "Bought" : "Sold"} ${activeSym} successfully`
        : `Limit order placed for ${activeSym}`
      );
      setAmount("");
      await fetchAll(true);
      onOrderFilled?.();
    } catch (e: unknown) {
      showResult(false, (e as Error).message ?? "Order failed");
    } finally {
      setLoading(false);
    }
  }

  async function closePosition(productId: string, posQty: number, posPrice?: number | null) {
    setLoading(true);
    try {
      await api.paper.order({
        product_id: productId,
        side: "sell",
        order_type: "market",
        amount: posQty,
        current_price: posPrice ?? (productId === activeSym ? currentPrice ?? undefined : undefined),
      });
      showResult(true, `Closed position in ${productId}`);
      await fetchAll(true);
      onOrderFilled?.();
    } catch (e: unknown) {
      showResult(false, (e as Error).message ?? "Close failed");
    } finally {
      setLoading(false);
    }
  }

  async function cancelOrder(orderId: string) {
    await api.paper.cancelOrder(orderId);
    await fetchAll(true);
  }

  async function handleReset() {
    const bal = parseFloat(resetBalance) || 10_000;
    await api.paper.reset(bal);
    setConfirmReset(false);
    await fetchAll();
  }

  // ── Quick amount helpers ───────────────────────────────────────────────────

  function quickBuy(usdAmt: number) { setAmount(String(usdAmt)); }

  function quickSellPct(pctVal: number) {
    if (!position) return;
    setAmount(String(+(position.qty * pctVal / 100).toFixed(8)));
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading && !portfolio) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600">
        <Loader2 size={18} className="animate-spin" />
      </div>
    );
  }

  const p = portfolio;

  return (
    <div className="flex flex-col h-full overflow-hidden text-xs">

      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <div className="px-3 py-2 border-b border-bg-border shrink-0 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold bg-yellow-crypto/20 text-yellow-crypto border border-yellow-crypto/30 px-1.5 py-0.5 rounded uppercase tracking-wider">
            Paper
          </span>
          <span className="text-gray-400 font-medium">Trading</span>
        </div>
        <button
          onClick={() => fetchAll(true)}
          className="text-gray-600 hover:text-gray-300 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ── Portfolio stats ─────────────────────────────────────────────── */}
        {p && (
          <div className="px-2 py-2 space-y-1.5 border-b border-bg-border">
            <div className="flex gap-1.5">
              <StatCard label="Cash" value={usd(p.cash_balance)} />
              <StatCard
                label="Total"
                value={usd(p.total_value)}
                sub={`${pct(p.total_pnl_pct)} total`}
                subClass={pnlClass(p.total_pnl)}
              />
            </div>
            <div className="flex gap-1.5">
              <StatCard
                label="Unrealized P/L"
                value={(p.unrealized_pnl >= 0 ? "+" : "") + usd(p.unrealized_pnl)}
                subClass={pnlClass(p.unrealized_pnl)}
              />
              <StatCard
                label="Realized P/L"
                value={(p.realized_pnl >= 0 ? "+" : "") + usd(p.realized_pnl)}
                subClass={pnlClass(p.realized_pnl)}
              />
            </div>
          </div>
        )}

        {/* ── Auto-trading activity ───────────────────────────────────────── */}
        <AutoTradeSection />

        {/* ── Trade form ──────────────────────────────────────────────────── */}
        <Section title="Place Order">
          <div className="px-3 space-y-2 pb-1">

            {/* Symbol input */}
            <div>
              <label className="block text-gray-600 mb-0.5">Symbol</label>
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="BTC-USD"
                className="w-full bg-bg-card border border-bg-border text-white num rounded px-2 py-1 outline-none focus:border-blue-crypto uppercase"
              />
            </div>

            {/* Buy / Sell */}
            <div className="flex rounded overflow-hidden border border-bg-border">
              {(["buy", "sell"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { setSide(s); setAmount(""); }}
                  className={`flex-1 py-1.5 text-xs font-semibold capitalize transition-colors ${
                    side === s
                      ? s === "buy" ? "bg-green-crypto text-bg-primary" : "bg-red-crypto text-white"
                      : "text-gray-500 hover:text-white"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Market / Limit */}
            <div className="flex gap-1.5">
              {(["market", "limit"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setOrderType(t)}
                  className={`flex-1 py-1 rounded border capitalize text-[10px] transition-colors ${
                    orderType === t
                      ? "border-blue-crypto text-blue-crypto"
                      : "border-bg-border text-gray-600 hover:border-gray-500 hover:text-gray-400"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Limit price */}
            {orderType === "limit" && (
              <div>
                <label className="block text-gray-600 mb-0.5">Limit Price (USD)</label>
                <input
                  type="number"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder={currentPrice?.toFixed(2) ?? "0.00"}
                  className="w-full bg-bg-card border border-bg-border text-white num rounded px-2 py-1 outline-none focus:border-blue-crypto"
                />
              </div>
            )}

            {/* Amount */}
            <div>
              <label className="block text-gray-600 mb-0.5">
                {side === "buy" ? "Amount (USD)" : `Quantity (${activeSym.split("-")[0]})`}
              </label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={side === "buy" ? "e.g. 100" : "e.g. 0.001"}
                className="w-full bg-bg-card border border-bg-border text-white num rounded px-2 py-1 outline-none focus:border-blue-crypto"
              />
            </div>

            {/* Quick amounts */}
            <div className="flex gap-1">
              {side === "buy"
                ? [25, 50, 100, 500].map((v) => (
                    <button
                      key={v}
                      onClick={() => quickBuy(v)}
                      className="flex-1 py-0.5 bg-bg-card border border-bg-border text-gray-500 hover:text-white hover:border-gray-500 rounded text-[10px] transition-colors"
                    >
                      ${v}
                    </button>
                  ))
                : [25, 50, 75, 100].map((v) => (
                    <button
                      key={v}
                      onClick={() => quickSellPct(v)}
                      disabled={!position}
                      className="flex-1 py-0.5 bg-bg-card border border-bg-border text-gray-500 hover:text-white hover:border-gray-500 rounded text-[10px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {v}%
                    </button>
                  ))
              }
            </div>

            {/* Estimate */}
            {(estimatedQty || estimatedUsd) && (
              <div className="text-gray-500 num text-[10px] bg-bg-card rounded px-2 py-1">
                {estimatedQty !== null && `≈ ${qty(estimatedQty)} ${activeSym.split("-")[0]}`}
                {estimatedUsd !== null && `≈ ${usd(estimatedUsd)}`}
                {currentPrice && ` @ ${usd(currentPrice, currentPrice < 1 ? 6 : 2)}`}
                &nbsp;· fee ~{usd((parseFloat(amount) || 0) * 0.001, 2)}
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={!amount || loading}
              className={`w-full py-2 rounded font-semibold text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 ${
                side === "buy"
                  ? "bg-green-crypto hover:brightness-110 text-bg-primary"
                  : "bg-red-crypto hover:brightness-110 text-white"
              }`}
            >
              {loading && <Loader2 size={12} className="animate-spin" />}
              {side === "buy" ? "Buy" : "Sell"} {activeSym.split("-")[0]}
              {orderType === "limit" && " (Limit)"}
            </button>

            {/* Result message */}
            {result && (
              <div className={`flex items-center gap-1.5 rounded px-2 py-1.5 text-[10px] ${
                result.ok ? "bg-green-dim text-green-crypto" : "bg-red-dim text-red-crypto"
              }`}>
                {result.ok
                  ? <CheckCircle2 size={11} className="shrink-0" />
                  : <AlertCircle size={11} className="shrink-0" />
                }
                <span>{result.msg}</span>
              </div>
            )}
          </div>
        </Section>

        {/* ── Positions ───────────────────────────────────────────────────── */}
        <Section title={`Positions (${p?.positions.length ?? 0})`}>
          {(!p || p.positions.length === 0) ? (
            <p className="px-3 pb-2 text-gray-700">No open positions.</p>
          ) : (
            <div className="px-2 pb-1 space-y-1">
              {p.positions.map((pos) => (
                <div
                  key={pos.product_id}
                  className="bg-bg-card rounded px-2 py-1.5 flex items-start justify-between gap-1"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-white">{pos.currency}</span>
                      <span className="num text-gray-500">{qty(pos.qty)}</span>
                    </div>
                    <div className="num text-gray-600 text-[10px]">
                      avg {usd(pos.avg_cost, pos.avg_cost < 1 ? 6 : 2)}
                      {pos.current_price &&
                        <span className="ml-1">· now {usd(pos.current_price, pos.current_price < 1 ? 6 : 2)}</span>
                      }
                    </div>
                    {pos.unrealized_pnl !== null && (
                      <div className={`num text-[10px] font-semibold ${pnlClass(pos.unrealized_pnl)}`}>
                        {pos.unrealized_pnl >= 0 ? "+" : ""}{usd(pos.unrealized_pnl)}
                        {pos.unrealized_pnl_pct !== null && ` (${pct(pos.unrealized_pnl_pct)})`}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => closePosition(pos.product_id, pos.qty, pos.current_price)}
                    title="Close position at market"
                    className="shrink-0 p-1 text-gray-600 hover:text-red-crypto hover:bg-red-crypto/10 rounded transition-colors"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── Open orders (limit orders waiting) ─────────────────────────── */}
        {p && p.open_orders.length > 0 && (
          <Section title={`Limit Orders (${p.open_orders.length})`} defaultOpen={true}>
            <div className="px-2 pb-1 space-y-1">
              {p.open_orders.map((o: PaperOpenOrder) => (
                <div
                  key={o.order_id}
                  className="bg-bg-card rounded px-2 py-1.5 flex items-center justify-between gap-1"
                >
                  <div className="flex-1 min-w-0">
                    <span className={`font-semibold mr-1 ${o.side === "buy" ? "text-green-crypto" : "text-red-crypto"}`}>
                      {o.side.toUpperCase()}
                    </span>
                    <span className="text-gray-400">{o.product_id.split("-")[0]}</span>
                    <span className="num text-gray-500 ml-1 text-[10px]">
                      {qty(o.qty)} @ {usd(o.limit_price, o.limit_price && o.limit_price < 1 ? 6 : 2)}
                    </span>
                  </div>
                  <button
                    onClick={() => cancelOrder(o.order_id)}
                    title="Cancel order"
                    className="shrink-0 p-1 text-gray-600 hover:text-red-crypto hover:bg-red-crypto/10 rounded transition-colors"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Trade history ────────────────────────────────────────────────── */}
        <Section title={`History (${trades.length})`} defaultOpen={false}>
          {trades.length === 0 ? (
            <p className="px-3 pb-2 text-gray-700">No trades yet.</p>
          ) : (
            <div className="px-2 pb-1 space-y-0.5">
              {trades.map((t) => (
                <div key={t.trade_id} className="flex items-center justify-between py-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`font-bold text-[10px] ${t.side === "buy" ? "text-green-crypto" : "text-red-crypto"}`}>
                      {t.side === "buy" ? "▲" : "▼"}
                    </span>
                    <span className="text-gray-400">{t.product_id.split("-")[0]}</span>
                    <span className="num text-gray-600 text-[10px]">{qty(t.qty)} @ {usd(t.price, t.price < 1 ? 6 : 2)}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {t.realized_pnl !== null && (
                      <span className={`num text-[10px] font-medium ${pnlClass(t.realized_pnl)}`}>
                        {t.realized_pnl >= 0 ? "+" : ""}{usd(t.realized_pnl)}
                      </span>
                    )}
                    <span className="text-gray-700 text-[9px]">{relTime(t.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── Reset ────────────────────────────────────────────────────────── */}
        <div className="px-3 py-3 border-t border-bg-border">
          {!confirmReset ? (
            <button
              onClick={() => setConfirmReset(true)}
              className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded border border-bg-border text-gray-600 hover:text-red-crypto hover:border-red-crypto/40 transition-colors text-[10px]"
            >
              <RotateCcw size={10} /> Reset Account
            </button>
          ) : (
            <div className="space-y-1.5 bg-bg-card rounded p-2">
              <p className="text-gray-400 text-[10px]">Reset all trades and positions?</p>
              <div className="flex items-center gap-1">
                <span className="text-gray-600 text-[10px] shrink-0">Start $</span>
                <input
                  type="number"
                  value={resetBalance}
                  onChange={(e) => setResetBalance(e.target.value)}
                  className="flex-1 bg-bg-primary border border-bg-border num text-white rounded px-1.5 py-0.5 outline-none text-[10px] focus:border-blue-crypto"
                />
              </div>
              <div className="flex gap-1.5">
                <button
                  onClick={handleReset}
                  className="flex-1 py-1 bg-red-crypto text-white rounded text-[10px] font-semibold hover:brightness-110 transition-colors"
                >
                  Confirm Reset
                </button>
                <button
                  onClick={() => setConfirmReset(false)}
                  className="flex-1 py-1 border border-bg-border text-gray-500 hover:text-white rounded text-[10px] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
