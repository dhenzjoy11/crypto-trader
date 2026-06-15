import { RefreshCw } from "lucide-react";
import type { Analysis } from "../types";

interface Props {
  analysis: Analysis | null;
  loading: boolean;
  onRefresh: () => void;
}

const OVERALL_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  strong_buy:  { label: "STRONG BUY",  color: "#00c853", bg: "#00c85322" },
  buy:         { label: "BUY",         color: "#69f0ae", bg: "#00c85315" },
  neutral:     { label: "NEUTRAL",     color: "#9e9e9e", bg: "#9e9e9e15" },
  sell:        { label: "SELL",        color: "#ff5252", bg: "#ff174415" },
  strong_sell: { label: "STRONG SELL", color: "#ff1744", bg: "#ff174422" },
};

const SIGNAL_COLORS = {
  buy:     "text-green-crypto",
  sell:    "text-red-crypto",
  neutral: "text-gray-400",
};

const STRENGTH_DOTS: Record<string, number> = {
  strong: 3, moderate: 2, weak: 1,
};

export default function SignalPanel({ analysis, loading, onRefresh }: Props) {
  const pred = analysis?.prediction;
  const indicators = analysis?.indicators;
  const overall = pred ? OVERALL_LABELS[pred.overall] : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-bg-border">
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Signal Analysis</span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-gray-500 hover:text-white transition-colors disabled:opacity-40"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {/* Overall signal */}
        {overall && pred && (
          <div
            className="rounded-lg p-3 border"
            style={{ backgroundColor: overall.bg, borderColor: overall.color + "44" }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-400">Overall Signal</span>
              <span className="text-xs num text-gray-400">Score: {pred.score > 0 ? "+" : ""}{pred.score}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm" style={{ color: overall.color }}>
                {overall.label}
              </span>
              <div className="flex items-center gap-1">
                <span className="text-xs text-gray-400">Confidence</span>
                <div className="w-16 h-1.5 bg-bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pred.confidence * 100}%`, backgroundColor: overall.color }}
                  />
                </div>
                <span className="text-xs num" style={{ color: overall.color }}>
                  {Math.round(pred.confidence * 100)}%
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Price targets */}
        {pred?.price_targets && (
          <div className="bg-bg-card rounded-lg p-2.5">
            <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Price Targets</div>
            <div className="grid grid-cols-3 gap-1 text-center text-xs">
              <div className="rounded p-1.5 bg-green-dim">
                <div className="text-gray-400 mb-0.5">Bull</div>
                <div className="num text-green-crypto font-medium">
                  ${pred.price_targets.bull.toLocaleString()}
                </div>
              </div>
              <div className="rounded p-1.5 bg-bg-secondary">
                <div className="text-gray-400 mb-0.5">Base</div>
                <div className="num text-gray-300 font-medium">
                  ${pred.price_targets.base.toLocaleString()}
                </div>
              </div>
              <div className="rounded p-1.5 bg-red-dim">
                <div className="text-gray-400 mb-0.5">Bear</div>
                <div className="num text-red-crypto font-medium">
                  ${pred.price_targets.bear.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Individual signals */}
        {pred?.signals && pred.signals.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs text-gray-500 uppercase tracking-wider">Indicators</div>
            {pred.signals.map((sig) => (
              <div
                key={sig.name}
                className="bg-bg-card rounded p-2 border border-bg-border"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-300 font-medium">{sig.name}</span>
                  <div className="flex items-center gap-1.5">
                    {/* Strength dots */}
                    <div className="flex gap-0.5">
                      {[1, 2, 3].map((d) => (
                        <div
                          key={d}
                          className="w-1.5 h-1.5 rounded-full"
                          style={{
                            backgroundColor:
                              d <= (STRENGTH_DOTS[sig.strength] || 0)
                                ? sig.signal === "buy" ? "#00c853" : sig.signal === "sell" ? "#ff1744" : "#9e9e9e"
                                : "#2a2a42",
                          }}
                        />
                      ))}
                    </div>
                    <span className={`text-xs font-semibold uppercase ${SIGNAL_COLORS[sig.signal]}`}>
                      {sig.signal}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-gray-500 leading-tight">{sig.description}</p>
              </div>
            ))}
          </div>
        )}

        {/* Indicators snapshot */}
        {indicators && (
          <div className="bg-bg-card rounded-lg p-2.5">
            <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Snapshot</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {[
                ["RSI (14)", indicators.rsi?.toFixed(1)],
                ["MACD", indicators.macd?.toFixed(4)],
                ["EMA 9", indicators.ema_9?.toFixed(2)],
                ["EMA 21", indicators.ema_21?.toFixed(2)],
                ["EMA 50", indicators.ema_50?.toFixed(2)],
                ["BB Upper", indicators.bb_upper?.toFixed(2)],
                ["BB Lower", indicators.bb_lower?.toFixed(2)],
              ]
                .filter(([, v]) => v !== undefined)
                .map(([label, val]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-gray-500">{label}</span>
                    <span className="num text-gray-300">{val}</span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {!pred && !loading && (
          <div className="text-center text-gray-600 text-xs py-4">No analysis data</div>
        )}
      </div>
    </div>
  );
}
