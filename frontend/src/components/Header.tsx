import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, Search, TrendingDown, TrendingUp, Wifi, WifiOff, X } from "lucide-react";
import type { Product, Ticker } from "../types";

interface Props {
  products:              Product[];
  watchlist:             string[];
  selectedId:            string;
  ticker:                Ticker | null;
  livePrice:             number | null;
  wsConnected:           boolean;
  onSelect:              (id: string) => void;
  onAddToWatchlist:      (id: string) => void;
  onRemoveFromWatchlist: (id: string) => void;
}

// ── Watchlist dropdown ────────────────────────────────────────────────────────

function PairDropdown({
  products,
  watchlist,
  selectedId,
  onSelect,
  onAdd,
  onRemove,
}: {
  products:  Product[];
  watchlist: string[];
  selectedId: string;
  onSelect:  (id: string) => void;
  onAdd:     (id: string) => void;
  onRemove:  (id: string) => void;
}) {
  const [open,   setOpen]   = useState(false);
  const [search, setSearch] = useState("");
  const rootRef  = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const selectedProduct = products.find((p) => p.id === selectedId);

  // Products not already in watchlist that match the search string
  const searchResults = search.trim().length > 0
    ? products
        .filter(
          (p) =>
            !watchlist.includes(p.id) &&
            (p.id.toLowerCase().includes(search.toLowerCase()) ||
              p.display_name?.toLowerCase().includes(search.toLowerCase()))
        )
        .slice(0, 8)
    : [];

  return (
    <div ref={rootRef} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 bg-bg-card border border-bg-border text-white text-sm rounded-md px-3 py-1.5 outline-none hover:border-blue-crypto transition-colors min-w-[130px]"
      >
        <span className="font-semibold flex-1 text-left">
          {selectedProduct?.display_name || selectedId}
        </span>
        <ChevronDown size={13} className={`text-gray-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full left-0 mt-1 w-60 bg-bg-card border border-bg-border rounded-lg shadow-2xl z-50 overflow-hidden">

          {/* Watchlist items */}
          <div className="max-h-52 overflow-y-auto">
            {watchlist.length === 0 && (
              <p className="px-3 py-4 text-xs text-gray-600 text-center">
                No symbols — search below to add.
              </p>
            )}
            {watchlist.map((id) => {
              const p          = products.find((x) => x.id === id);
              const isSelected = id === selectedId;
              return (
                <div
                  key={id}
                  onClick={() => { onSelect(id); setOpen(false); setSearch(""); }}
                  className={`flex items-center justify-between px-3 py-2 cursor-pointer group transition-colors hover:bg-bg-border ${
                    isSelected ? "bg-bg-border" : ""
                  }`}
                >
                  <span className={`text-sm font-medium ${isSelected ? "text-blue-crypto" : "text-gray-200"}`}>
                    {p?.display_name || id}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(id);
                    }}
                    title="Remove from watchlist"
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-gray-500 hover:text-red-crypto hover:bg-red-crypto/10 transition-all"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Divider */}
          <div className="border-t border-bg-border" />

          {/* Search / Add */}
          <div className="p-2">
            <div className="flex items-center gap-2 bg-bg-primary border border-bg-border rounded px-2 py-1">
              <Search size={11} className="text-gray-500 shrink-0" />
              <input
                ref={inputRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search to add symbol…"
                className="flex-1 bg-transparent text-xs text-white outline-none placeholder-gray-600"
                onClick={(e) => e.stopPropagation()}
              />
              {search && (
                <button onClick={() => setSearch("")} className="text-gray-600 hover:text-gray-400">
                  <X size={10} />
                </button>
              )}
            </div>

            {searchResults.length > 0 && (
              <div className="mt-1 max-h-36 overflow-y-auto">
                {searchResults.map((p) => (
                  <div
                    key={p.id}
                    onClick={() => { onAdd(p.id); setSearch(""); }}
                    className="flex items-center gap-2 px-2 py-1.5 cursor-pointer text-xs text-gray-400 hover:text-white hover:bg-bg-border rounded transition-colors"
                  >
                    <Plus size={11} className="text-green-crypto shrink-0" />
                    <span>{p.display_name || p.id}</span>
                    <span className="ml-auto text-gray-600">{p.id}</span>
                  </div>
                ))}
              </div>
            )}

            {search.trim().length > 0 && searchResults.length === 0 && (
              <p className="px-2 py-2 text-xs text-gray-600 text-center">No results</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────

export default function Header({
  products,
  watchlist,
  selectedId,
  ticker,
  livePrice,
  wsConnected,
  onSelect,
  onAddToWatchlist,
  onRemoveFromWatchlist,
}: Props) {
  const displayPrice = livePrice ?? ticker?.price ?? null;
  const isUp = (ticker?.change_pct_24h ?? 0) >= 0;

  return (
    <header className="flex items-center gap-4 px-4 py-2 bg-bg-secondary border-b border-bg-border shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-2">
        <div className="w-7 h-7 rounded-full bg-blue-crypto flex items-center justify-center text-xs font-bold">
          CT
        </div>
        <span className="text-sm font-semibold hidden sm:block text-gray-300">CryptoTrader</span>
      </div>

      {/* Watchlist dropdown */}
      <PairDropdown
        products={products}
        watchlist={watchlist}
        selectedId={selectedId}
        onSelect={onSelect}
        onAdd={onAddToWatchlist}
        onRemove={onRemoveFromWatchlist}
      />

      {/* Price */}
      {displayPrice !== null && (
        <div className="flex items-center gap-3">
          <span className="num text-xl font-semibold text-white">
            ${displayPrice.toLocaleString("en-US", {
              minimumFractionDigits: 2,
              maximumFractionDigits: displayPrice < 1 ? 6 : 2,
            })}
          </span>
          {ticker && (
            <div className={`flex items-center gap-1 text-sm num ${isUp ? "text-green-crypto" : "text-red-crypto"}`}>
              {isUp ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              <span>
                {isUp ? "+" : ""}
                {ticker.change_pct_24h.toFixed(2)}%
              </span>
              <span className="text-gray-500 text-xs">24h</span>
            </div>
          )}
        </div>
      )}

      <div className="flex-1" />

      {/* Stats */}
      {ticker && (
        <div className="hidden md:flex items-center gap-4 text-xs text-gray-400">
          <div>
            <span className="text-gray-600 mr-1">Bid</span>
            <span className="num text-green-crypto">${ticker.bid.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-gray-600 mr-1">Ask</span>
            <span className="num text-red-crypto">${ticker.ask.toLocaleString()}</span>
          </div>
          <div>
            <span className="text-gray-600 mr-1">Vol 24h</span>
            <span className="num">{ticker.volume_24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
        </div>
      )}

      {/* WS status */}
      <div className={`flex items-center gap-1 text-xs ${wsConnected ? "text-green-crypto" : "text-gray-600"}`}>
        {wsConnected ? <Wifi size={13} /> : <WifiOff size={13} />}
        {wsConnected && <span className="w-1.5 h-1.5 rounded-full bg-green-crypto live-dot inline-block" />}
      </div>
    </header>
  );
}
