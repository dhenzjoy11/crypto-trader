import { Lock } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { Portfolio, Product } from "../types";

interface Props {
  portfolio: Portfolio | null;
  loading: boolean;
  authenticated: boolean;
  products: Product[];
  onSelectPair: (id: string) => void;
}

const COLORS = [
  "#2979ff", "#00c853", "#ff1744", "#ffd600", "#7c4dff",
  "#00bcd4", "#ff9800", "#e91e63", "#4caf50", "#9e9e9e",
];

export default function PortfolioSidebar({
  portfolio,
  loading,
  authenticated,
  products,
  onSelectPair,
}: Props) {
  const chartData = portfolio
    ? [
        ...(portfolio.cash_balance > 0.01
          ? [{ name: "USD Cash", value: portfolio.cash_balance }]
          : []),
        ...portfolio.accounts
          .filter((a) => !a.is_cash && (a.value_usd ?? 0) > 0.01)
          .map((a) => ({ name: a.currency, value: a.value_usd ?? 0 })),
      ]
    : [];

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-bg-border">
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Portfolio</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!authenticated ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8 px-3 text-center">
            <Lock size={20} className="text-gray-600" />
            <p className="text-xs text-gray-500 leading-relaxed">
              Add Coinbase API keys in <code className="font-mono text-gray-400">.env</code> to view your portfolio
            </p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-blue-crypto border-t-transparent rounded-full animate-spin" />
          </div>
        ) : portfolio ? (
          <div className="px-3 py-2 space-y-3">
            {/* Total / Cash / Crypto breakdown */}
            <div className="bg-bg-card rounded-lg p-3 border border-bg-border space-y-2">
              <div>
                <div className="text-xs text-gray-500 mb-0.5">Total Value</div>
                <div className="num text-lg font-semibold text-white">
                  ${portfolio.total_value_usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-bg-border">
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">Cash (USD)</div>
                  <div className="num text-sm font-medium text-green-400">
                    ${(portfolio.cash_balance ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-0.5">Crypto</div>
                  <div className="num text-sm font-medium text-blue-400">
                    ${(portfolio.crypto_value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              </div>
            </div>

            {/* Pie chart */}
            {chartData.length > 1 && (
              <div className="h-28">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={28}
                      outerRadius={48}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => [`$${v.toFixed(2)}`, ""]}
                      contentStyle={{ background: "#1a1a2e", border: "1px solid #2a2a42", borderRadius: 6, fontSize: 11 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Holdings */}
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wider mb-1.5">Holdings</div>
              <div className="space-y-1">
                {portfolio.accounts.map((acc, i) => {
                  const pct = portfolio.total_value_usd > 0
                    ? ((acc.value_usd ?? 0) / portfolio.total_value_usd * 100)
                    : 0;
                  const pairId = `${acc.currency}-USD`;
                  const hasPair = !acc.is_cash && products.some((p) => p.id === pairId);
                  const upnl = acc.unrealized_pnl;

                  return (
                    <div
                      key={acc.currency}
                      onClick={() => hasPair && onSelectPair(pairId)}
                      className={`flex items-center justify-between p-2 rounded border border-bg-border bg-bg-card ${hasPair ? "cursor-pointer hover:border-blue-crypto/50" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: acc.is_cash ? "#22c55e" : COLORS[i % COLORS.length] }}
                        />
                        <div>
                          <div className="text-xs font-medium text-white flex items-center gap-1">
                            {acc.currency}
                            {acc.is_cash && <span className="text-[9px] text-green-400 border border-green-400/40 rounded px-0.5">CASH</span>}
                          </div>
                          <div className="num text-xs text-gray-500">
                            {acc.is_cash
                              ? `$${acc.total_balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                              : acc.total_balance.toFixed(6)
                            }
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="num text-xs text-gray-300">
                          ${(acc.value_usd ?? 0).toFixed(2)}
                        </div>
                        {upnl != null && !acc.is_cash ? (
                          <div className={`num text-xs ${upnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                            {upnl >= 0 ? "+" : ""}${upnl.toFixed(2)}
                          </div>
                        ) : (
                          <div className="num text-xs text-gray-600">{pct.toFixed(1)}%</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center text-gray-600 text-xs py-8">No portfolio data</div>
        )}
      </div>
    </div>
  );
}
