import type { SRLevel } from "../types";

interface Props {
  levels: SRLevel[];
  currentPrice: number | null;
}

function StrengthBar({ value }: { value: number }) {
  const filled = Math.min(Math.max(value, 1), 5);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="w-1.5 h-3 rounded-sm"
          style={{ backgroundColor: i <= filled ? "#2979ff" : "#2a2a42" }}
        />
      ))}
    </div>
  );
}

export default function SupportResistance({ levels, currentPrice }: Props) {
  // R1 = nearest resistance (lowest price above current), R2 = next
  // S1 = nearest support  (highest price below current), S2 = next
  const resistance = levels
    .filter((l) => l.type === "resistance")
    .sort((a, b) => a.price - b.price)
    .slice(0, 2);
  const support = levels
    .filter((l) => l.type === "support")
    .sort((a, b) => b.price - a.price)
    .slice(0, 2);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-bg-border">
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          Support &amp; Resistance
        </span>
        {currentPrice && (
          <span className="ml-2 text-xs num text-gray-500">
            @ ${currentPrice.toLocaleString()}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        {/* Resistance */}
        <div>
          <div className="text-xs text-red-crypto uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-crypto inline-block" />
            Resistance
          </div>
          {resistance.length === 0 && (
            <div className="text-xs text-gray-600">None detected</div>
          )}
          {resistance.map((level, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-1.5 border-b border-bg-border last:border-0"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-red-crypto w-5">R{i + 1}</span>
                <div>
                  <div className="num text-sm text-red-crypto font-medium">
                    ${level.price.toLocaleString()}
                  </div>
                  <div className="num text-xs text-gray-500">
                    +{level.distance_pct.toFixed(2)}% away
                  </div>
                </div>
              </div>
              <StrengthBar value={level.strength} />
            </div>
          ))}
        </div>

        {/* Current price divider */}
        {currentPrice && (
          <div className="flex items-center gap-2 py-1">
            <div className="flex-1 h-px bg-blue-crypto opacity-40" />
            <span className="num text-xs text-blue-crypto font-medium">
              ${currentPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <div className="flex-1 h-px bg-blue-crypto opacity-40" />
          </div>
        )}

        {/* Support */}
        <div>
          <div className="text-xs text-green-crypto uppercase tracking-wider mb-1.5 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-crypto inline-block" />
            Support
          </div>
          {support.length === 0 && (
            <div className="text-xs text-gray-600">None detected</div>
          )}
          {support.map((level, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-1.5 border-b border-bg-border last:border-0"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-green-crypto w-5">S{i + 1}</span>
                <div>
                  <div className="num text-sm text-green-crypto font-medium">
                    ${level.price.toLocaleString()}
                  </div>
                  <div className="num text-xs text-gray-500">
                    -{level.distance_pct.toFixed(2)}% away
                  </div>
                </div>
              </div>
              <StrengthBar value={level.strength} />
            </div>
          ))}
        </div>

        {levels.length === 0 && (
          <div className="text-center text-gray-600 text-xs py-4">
            Loading levels…
          </div>
        )}
      </div>
    </div>
  );
}
