import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../services/api";
import type { Product, Ticker } from "../types";

interface Props {
  product: Product | undefined;
  ticker: Ticker | null;
  livePrice: number | null;
  authenticated: boolean;
  defaultSide?: "buy" | "sell";
}

export default function OrderPanel({ product, ticker, livePrice, authenticated, defaultSide }: Props) {
  const [side, setSide] = useState<"buy" | "sell">(defaultSide ?? "buy");

  // When a Buy/Sell is clicked in the watchlist table, snap to that side
  useEffect(() => {
    if (defaultSide) setSide(defaultSide);
  }, [defaultSide]);
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [amount, setAmount] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const price = livePrice ?? ticker?.price ?? 0;
  const minUsd = parseFloat(product?.min_market_funds ?? "10");
  const minBase = parseFloat(product?.base_min_size ?? "0.001");

  const estimatedValue = () => {
    if (!amount || !price) return null;
    const amt = parseFloat(amount);
    if (isNaN(amt)) return null;
    if (side === "buy") {
      // amount is USD
      return `≈ ${(amt / price).toFixed(6)} ${product?.base_currency ?? ""}`;
    } else {
      // amount is crypto
      const lp = orderType === "limit" && limitPrice ? parseFloat(limitPrice) : price;
      return `≈ $${(amt * lp).toFixed(2)} USD`;
    }
  };

  const handleSubmit = async () => {
    if (!product || !amount) return;
    setResult(null);
    setLoading(true);
    try {
      const payload = {
        product_id: product.id,
        side,
        order_type: orderType,
        amount: parseFloat(amount),
        limit_price: orderType === "limit" ? parseFloat(limitPrice) : undefined,
      };
      const res = await api.placeOrder(payload) as { order_id: string; status: string };
      setResult({ ok: true, msg: `Order ${res.order_id?.slice(0, 8)}… ${res.status}` });
      setAmount("");
    } catch (e: unknown) {
      setResult({ ok: false, msg: (e as Error).message ?? "Order failed" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-bg-border">
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          Place Order
        </span>
        {price > 0 && (
          <span className="ml-2 num text-xs text-gray-500">${price.toLocaleString()}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {!authenticated && (
          <div className="bg-yellow-crypto/10 border border-yellow-crypto/30 rounded p-2 text-xs text-yellow-crypto">
            Configure API keys in <code className="font-mono">.env</code> to enable trading
          </div>
        )}

        {/* Buy/Sell toggle */}
        <div className="flex rounded overflow-hidden border border-bg-border">
          <button
            onClick={() => setSide("buy")}
            className={`flex-1 py-2 text-sm font-semibold transition-colors ${
              side === "buy" ? "bg-green-crypto text-bg-primary" : "text-gray-500 hover:text-white"
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => setSide("sell")}
            className={`flex-1 py-2 text-sm font-semibold transition-colors ${
              side === "sell" ? "bg-red-crypto text-white" : "text-gray-500 hover:text-white"
            }`}
          >
            Sell
          </button>
        </div>

        {/* Order type */}
        <div className="flex gap-2">
          {(["market", "limit"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setOrderType(t)}
              className={`flex-1 py-1 text-xs rounded border transition-colors capitalize ${
                orderType === t
                  ? "border-blue-crypto text-blue-crypto"
                  : "border-bg-border text-gray-500 hover:border-gray-500"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Limit price */}
        {orderType === "limit" && (
          <div>
            <label className="block text-xs text-gray-400 mb-1">Limit Price (USD)</label>
            <input
              type="number"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder={price ? price.toFixed(2) : "0.00"}
              className="w-full bg-bg-card border border-bg-border text-white text-sm num rounded px-2 py-1.5 outline-none focus:border-blue-crypto"
            />
          </div>
        )}

        {/* Amount */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            {side === "buy" ? "Amount (USD)" : `Amount (${product?.base_currency ?? "Crypto"})`}
          </label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={side === "buy" ? `Min $${minUsd}` : `Min ${minBase}`}
              className="w-full bg-bg-card border border-bg-border text-white text-sm num rounded px-2 py-1.5 outline-none focus:border-blue-crypto pr-12"
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500">
              {side === "buy" ? "USD" : product?.base_currency}
            </span>
          </div>
        </div>

        {/* Quick amounts */}
        <div className="flex gap-1">
          {side === "buy"
            ? ["25", "50", "100", "250"].map((v) => (
                <button
                  key={v}
                  onClick={() => setAmount(v)}
                  className="flex-1 py-0.5 text-xs bg-bg-card hover:bg-bg-border rounded border border-bg-border text-gray-400 hover:text-white transition-colors"
                >
                  ${v}
                </button>
              ))
            : ["25%", "50%", "75%", "100%"].map((v) => (
                <button
                  key={v}
                  onClick={() => setAmount(v.replace("%", ""))}
                  className="flex-1 py-0.5 text-xs bg-bg-card hover:bg-bg-border rounded border border-bg-border text-gray-400 hover:text-white transition-colors"
                >
                  {v}
                </button>
              ))}
        </div>

        {/* Estimate */}
        {estimatedValue() && (
          <div className="text-xs text-gray-500 bg-bg-card rounded px-2 py-1.5 num">
            {estimatedValue()}
          </div>
        )}

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!amount || loading || !authenticated}
          className={`w-full py-2.5 rounded font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
            side === "buy"
              ? "bg-green-crypto hover:brightness-110 text-bg-primary"
              : "bg-red-crypto hover:brightness-110 text-white"
          }`}
        >
          {loading && <Loader2 size={14} className="animate-spin" />}
          {side === "buy" ? "Buy" : "Sell"} {product?.base_currency}
        </button>

        {/* Result */}
        {result && (
          <div
            className={`flex items-start gap-2 text-xs rounded p-2 ${
              result.ok
                ? "bg-green-dim text-green-crypto"
                : "bg-red-dim text-red-crypto"
            }`}
          >
            {result.ok ? <CheckCircle2 size={12} className="mt-0.5 shrink-0" /> : <AlertCircle size={12} className="mt-0.5 shrink-0" />}
            <span>{result.msg}</span>
          </div>
        )}
      </div>
    </div>
  );
}
