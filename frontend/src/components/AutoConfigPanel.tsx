import { ChevronDown, ChevronUp, Play, Square, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../services/api";
import type { AutoTradeStatus, Product } from "../types";

interface Props {
  autoStatus: Record<string, AutoTradeStatus>;
  products: Product[];
  watchlist: string[];
  onRefresh: () => void;
}

// ── Field ─────────────────────────────────────────────────────────────────────

function Field({
  label, hint, value, onChange, suffix,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] text-gray-500 mb-0.5">{label}</label>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-bg-primary border border-bg-border text-white num rounded px-2 py-1 text-xs outline-none focus:border-yellow-crypto"
        />
        {suffix && <span className="text-gray-500 text-[10px] shrink-0">{suffix}</span>}
      </div>
      {hint && <p className="text-[10px] text-gray-600 mt-0.5 leading-relaxed">{hint}</p>}
    </div>
  );
}

// ── Per-bot card ──────────────────────────────────────────────────────────────

function ModeToggle({ value, onChange }: { value: "paper" | "live"; onChange: (v: "paper" | "live") => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-gray-500">Mode</label>
      <div className="flex rounded overflow-hidden border border-bg-border text-[10px] font-semibold">
        <button
          onClick={() => onChange("paper")}
          className={`flex-1 py-1 transition-colors ${value === "paper" ? "bg-blue-500/20 text-blue-400" : "text-gray-500 hover:text-gray-300"}`}
        >Paper</button>
        <button
          onClick={() => onChange("live")}
          className={`flex-1 py-1 transition-colors ${value === "live" ? "bg-green-crypto/20 text-green-crypto" : "text-gray-500 hover:text-gray-300"}`}
        >Live</button>
      </div>
      {value === "live" && (
        <p className="text-[10px] text-orange-400 leading-relaxed">⚠ Places real orders on Coinbase.</p>
      )}
    </div>
  );
}

function BotCard({ pid, status, onRefresh }: {
  pid: string;
  status: AutoTradeStatus;
  onRefresh: () => void;
}) {
  const [tradeAmt,  setTradeAmt]  = useState(String(status.trade_amount_usd));
  const [maxInvest, setMaxInvest] = useState(String(status.max_investment_usd));
  const [tp1,       setTp1]       = useState(String((status.take_profit_pct_1 * 100).toFixed(1)));
  const [tp2,       setTp2]       = useState(String((status.take_profit_pct_2 * 100).toFixed(1)));
  const [tradeMode, setTradeMode] = useState<"paper" | "live">(status.mode ?? "paper");

  const [saving,   setSaving]   = useState(false);
  const [stopping, setStopping] = useState(false);
  const [flash,    setFlash]    = useState<"saved" | "error" | null>(null);

  const sym = pid.replace(/-USD$/, "");

  async function handleSave() {
    setSaving(true);
    setFlash(null);
    try {
      await api.autoTrade.start(
        pid,
        parseFloat(tradeAmt)  || 100,
        parseFloat(maxInvest) || 500,
        (parseFloat(tp1) || 5)  / 100,
        (parseFloat(tp2) || 20) / 100,
        undefined, undefined, tradeMode,
      );
      setFlash("saved");
      setTimeout(() => setFlash(null), 2500);
      onRefresh();
    } catch {
      setFlash("error");
    } finally {
      setSaving(false);
    }
  }

  async function handleStop() {
    setStopping(true);
    try {
      await api.autoTrade.stop(pid);
      onRefresh();
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="bg-bg-card border border-yellow-crypto/20 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-bg-border">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-yellow-crypto animate-pulse shrink-0" />
          <div>
            <span className="font-bold text-white text-sm">{sym}</span>
            <span className="text-gray-600 text-[10px] ml-1">{pid}</span>
            <span className={`ml-1.5 text-[9px] font-bold px-1 py-0.5 rounded ${tradeMode === "live" ? "bg-green-crypto/20 text-green-crypto" : "bg-blue-500/20 text-blue-400"}`}>
              {tradeMode.toUpperCase()}
            </span>
          </div>
        </div>
        <button
          onClick={handleStop}
          disabled={stopping}
          className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-red-crypto/30 text-red-crypto hover:bg-red-crypto/10 transition-colors disabled:opacity-50"
        >
          <Square size={8} />
          {stopping ? "…" : "Stop"}
        </button>
      </div>

      {/* Position status */}
      {status.in_position && (
        <div className="px-3 py-1.5 border-b border-bg-border flex items-center gap-4 text-[10px]">
          <div>
            <span className="text-gray-600">Entry </span>
            <span className="text-white num">${status.entry_price?.toFixed(4) ?? "—"}</span>
          </div>
          <div>
            <span className="text-gray-600">Size </span>
            <span className="text-white num">{status.position_size?.toFixed(2) ?? "—"}×</span>
          </div>
          {status.last_action && (
            <span className="text-yellow-crypto font-semibold">
              {status.last_action.replace(/_/g, " ")}
            </span>
          )}
        </div>
      )}

      {/* Config fields */}
      <div className="p-3 flex flex-col gap-2.5">
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Trade Amount"
            suffix="USD"
            value={tradeAmt}
            onChange={setTradeAmt}
          />
          <Field
            label="Max Investment"
            suffix="USD"
            value={maxInvest}
            onChange={setMaxInvest}
            hint="Caps total buys for this symbol."
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field
            label="TP1 — sell 50%"
            suffix="%"
            value={tp1}
            onChange={setTp1}
            hint="Locks in profit early."
          />
          <Field
            label="TP2 — sell all"
            suffix="%"
            value={tp2}
            onChange={setTp2}
            hint="Full exit on big move."
          />
        </div>

        <ModeToggle value={tradeMode} onChange={setTradeMode} />

        {/* Summary row */}
        <div className="flex items-center justify-between text-[10px] text-gray-600 border-t border-bg-border pt-2">
          <span>Stop loss: <span className="text-gray-400">3 × ATR14</span></span>
          <span>Adds: <span className="text-gray-400">10% on breakout / oversold</span></span>
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving}
          className={`w-full py-1.5 rounded text-xs font-semibold transition-all ${
            flash === "saved"
              ? "bg-green-crypto/20 text-green-crypto border border-green-crypto/30"
              : flash === "error"
              ? "bg-red-crypto/20 text-red-crypto border border-red-crypto/30"
              : "bg-yellow-crypto/15 text-yellow-crypto border border-yellow-crypto/25 hover:bg-yellow-crypto/25"
          }`}
        >
          {saving ? "Saving…" : flash === "saved" ? "Saved ✓" : flash === "error" ? "Error — retry" : "Save Changes"}
        </button>
      </div>
    </div>
  );
}

// ── Paused bot card ───────────────────────────────────────────────────────────

function PausedBotCard({ pid, status, onRefresh }: {
  pid: string;
  status: AutoTradeStatus;
  onRefresh: () => void;
}) {
  const [tradeAmt,  setTradeAmt]  = useState(String(status.trade_amount_usd));
  const [maxInvest, setMaxInvest] = useState(String(status.max_investment_usd));
  const [tp1,       setTp1]       = useState(String((status.take_profit_pct_1 * 100).toFixed(1)));
  const [tp2,       setTp2]       = useState(String((status.take_profit_pct_2 * 100).toFixed(1)));
  const [tradeMode, setTradeMode] = useState<"paper" | "live">(status.mode ?? "paper");
  const [resuming,  setResuming]  = useState(false);
  const [clearing,  setClearing]  = useState(false);

  const sym = pid.replace(/-USD$/, "");

  async function handleResume() {
    setResuming(true);
    try {
      await api.autoTrade.start(pid, parseFloat(tradeAmt) || 100, parseFloat(maxInvest) || 500,
        (parseFloat(tp1) || 5) / 100, (parseFloat(tp2) || 20) / 100,
        undefined, undefined, tradeMode);
      onRefresh();
    } finally { setResuming(false); }
  }

  async function handleClear() {
    setClearing(true);
    try {
      await api.autoTrade.clearPaused(pid);
      onRefresh();
    } finally { setClearing(false); }
  }

  return (
    <div className="bg-bg-card border border-amber-500/25 rounded-lg overflow-hidden opacity-80">
      <div className="flex items-center justify-between px-3 py-2 border-b border-bg-border">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
          <div>
            <span className="font-bold text-white text-sm">{sym}</span>
            <span className="text-gray-600 text-[10px] ml-1">PAUSED</span>
          </div>
        </div>
        <button
          onClick={handleClear}
          disabled={clearing}
          title="Discard paused state"
          className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border border-gray-700 text-gray-500 hover:text-red-crypto hover:border-red-crypto/30 transition-colors disabled:opacity-50"
        >
          <Trash2 size={8} />
          {clearing ? "…" : "Clear"}
        </button>
      </div>

      {status.in_position && (
        <div className="px-3 py-1.5 border-b border-bg-border flex items-center gap-4 text-[10px]">
          <div>
            <span className="text-gray-600">Entry </span>
            <span className="text-amber-400 num">${status.entry_price?.toFixed(4) ?? "—"}</span>
          </div>
          <div>
            <span className="text-gray-600">Size </span>
            <span className="text-white num">{status.position_size?.toFixed(2) ?? "—"}×</span>
          </div>
          <span className="text-gray-500 text-[10px]">position held</span>
        </div>
      )}

      <div className="p-3 flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Trade Amount" suffix="USD" value={tradeAmt} onChange={setTradeAmt} />
          <Field label="Max Investment" suffix="USD" value={maxInvest} onChange={setMaxInvest} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field label="TP1 — sell 50%" suffix="%" value={tp1} onChange={setTp1} />
          <Field label="TP2 — sell all" suffix="%" value={tp2} onChange={setTp2} />
        </div>
        <ModeToggle value={tradeMode} onChange={setTradeMode} />
        <button
          onClick={handleResume}
          disabled={resuming}
          className="w-full py-1.5 rounded text-xs font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/25 hover:bg-amber-500/25 transition-all disabled:opacity-50"
        >
          <span className="flex items-center justify-center gap-1.5">
            <Play size={10} />
            {resuming ? "Resuming…" : "Resume Bot"}
          </span>
        </button>
      </div>
    </div>
  );
}

// ── Start new bot card ────────────────────────────────────────────────────────

function StartBotCard({ products, watchlist, activeIds, onRefresh }: {
  products: Product[];
  watchlist: string[];
  activeIds: string[];
  onRefresh: () => void;
}) {
  const [open,      setOpen]     = useState(false);
  const [symbol,    setSymbol]   = useState("");
  const [tradeAmt,  setTradeAmt] = useState("100");
  const [maxInvest, setMaxInvest] = useState("500");
  const [tp1,       setTp1]      = useState("5");
  const [tp2,       setTp2]      = useState("20");
  const [tradeMode, setTradeMode] = useState<"paper" | "live">("paper");
  const [starting,  setStarting] = useState(false);

  async function handleStart() {
    if (!symbol) return;
    const pid = symbol.includes("-") ? symbol.toUpperCase() : `${symbol.toUpperCase()}-USD`;
    setStarting(true);
    try {
      await api.autoTrade.start(
        pid,
        parseFloat(tradeAmt)  || 100,
        parseFloat(maxInvest) || 500,
        (parseFloat(tp1) || 5)  / 100,
        (parseFloat(tp2) || 20) / 100,
        undefined, undefined, tradeMode,
      );
      setSymbol("");
      setOpen(false);
      onRefresh();
    } finally {
      setStarting(false);
    }
  }

  // Watchlist items not already running shown first
  const watchlistOptions = watchlist.filter((id) => !activeIds.includes(id));
  const otherOptions     = products.filter((p) => !watchlist.includes(p.id) && !activeIds.includes(p.id));

  return (
    <div className="bg-bg-card border border-bg-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-xs hover:bg-bg-border/20 transition-colors"
      >
        <span className="font-semibold text-gray-400">+ Start New Bot</span>
        {open
          ? <ChevronUp  size={12} className="text-gray-600" />
          : <ChevronDown size={12} className="text-gray-600" />
        }
      </button>

      {open && (
        <div className="px-3 pb-3 border-t border-bg-border flex flex-col gap-2.5 pt-3">
          <div>
            <label className="block text-[10px] text-gray-500 mb-0.5">Symbol</label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="w-full bg-bg-primary border border-bg-border text-white rounded px-2 py-1 text-xs outline-none focus:border-yellow-crypto"
            >
              <option value="">Select symbol…</option>
              {watchlistOptions.length > 0 && (
                <optgroup label="Watchlist">
                  {watchlistOptions.map((id) => (
                    <option key={id} value={id}>{id}</option>
                  ))}
                </optgroup>
              )}
              <optgroup label="All products">
                {otherOptions.slice(0, 100).map((p) => (
                  <option key={p.id} value={p.id}>{p.id}</option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Trade Amt" suffix="USD" value={tradeAmt} onChange={setTradeAmt} />
            <Field label="Max Invest" suffix="USD" value={maxInvest} onChange={setMaxInvest} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="TP1 — 50%" suffix="%" value={tp1} onChange={setTp1} hint="Sell 50% at this %" />
            <Field label="TP2 — all" suffix="%" value={tp2} onChange={setTp2} hint="Sell remaining at this %" />
          </div>

          <ModeToggle value={tradeMode} onChange={setTradeMode} />

          <button
            onClick={handleStart}
            disabled={!symbol || starting}
            className={`w-full py-1.5 rounded text-xs font-semibold hover:brightness-110 transition-colors disabled:opacity-40 ${
              tradeMode === "live" ? "bg-green-crypto text-bg-primary" : "bg-yellow-crypto text-bg-primary"
            }`}
          >
            {starting ? "Starting…" : tradeMode === "live" ? "Start Live Bot" : "Start Paper Bot"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function AutoConfigPanel({ autoStatus, products, watchlist, onRefresh }: Props) {
  const activeEntries = Object.entries(autoStatus).filter(([, s]) => s.active);
  const pausedEntries = Object.entries(autoStatus).filter(([, s]) => s.paused);
  const activeIds     = Object.keys(autoStatus);

  return (
    <div className="flex flex-col h-full overflow-y-auto p-3 gap-3">
      {/* Description */}
      <p className="text-[10px] text-gray-500 leading-relaxed shrink-0">
        S/R breakout strategy on 1h candles. Buys on first candle, adds on breakouts
        and oversold support bounces, exits via take-profit or stop loss.
      </p>

      {/* Active bots */}
      {activeEntries.length === 0 && pausedEntries.length === 0 ? (
        <p className="text-xs text-gray-600 text-center py-6">
          No active bots. Start one below.
        </p>
      ) : (
        activeEntries.map(([pid, status]) => (
          <BotCard key={pid} pid={pid} status={status} onRefresh={onRefresh} />
        ))
      )}

      {/* Paused bots */}
      {pausedEntries.length > 0 && (
        <>
          <p className="text-[10px] text-amber-400/70 font-semibold -mb-1">Paused</p>
          {pausedEntries.map(([pid, status]) => (
            <PausedBotCard key={pid} pid={pid} status={status} onRefresh={onRefresh} />
          ))}
        </>
      )}

      {/* Start new */}
      <StartBotCard
        products={products}
        watchlist={watchlist}
        activeIds={activeIds}
        onRefresh={onRefresh}
      />

      {/* Strategy legend */}
      <div className="border border-bg-border rounded-lg p-3 text-[10px] text-gray-600 flex flex-col gap-1 shrink-0">
        <p className="text-gray-400 font-semibold mb-1">Strategy rules (fixed)</p>
        <div className="flex justify-between"><span>Initial buy</span><span className="text-gray-400">First 1h candle</span></div>
        <div className="flex justify-between"><span>Add on breakout</span><span className="text-gray-400">2× closes above R · up to 3×</span></div>
        <div className="flex justify-between"><span>Add on support</span><span className="text-gray-400">Price at S · RSI ≤ 35 · uptrend</span></div>
        <div className="flex justify-between"><span>Stop loss</span><span className="text-gray-400">Price below 3 × ATR14</span></div>
        <div className="flex justify-between"><span>TP1</span><span className="text-gray-400">Sell 50% at target profit</span></div>
        <div className="flex justify-between"><span>TP2</span><span className="text-gray-400">Sell remaining at higher target</span></div>
        <div className="flex justify-between"><span>Trailing stop</span><span className="text-gray-400">Arm at +20% · trail 10% (if TP2=0)</span></div>
        <div className="flex justify-between"><span>Add-on size</span><span className="text-gray-400">10% of base trade amt</span></div>
      </div>
    </div>
  );
}
