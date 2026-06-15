import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import type { Ticker } from "../types";

export function useWatchlistTickers(ids: string[], intervalMs = 5_000) {
  const [tickers, setTickers] = useState<Record<string, Ticker>>({});
  const timerRef = useRef<ReturnType<typeof window.setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    if (!ids.length) return;
    const results = await Promise.allSettled(
      ids.map((id) => api.ticker(id).then((t) => [id, t] as const))
    );
    setTickers((prev) => {
      const next = { ...prev };
      for (const r of results) {
        if (r.status === "fulfilled") next[r.value[0]] = r.value[1];
      }
      return next;
    });
  }, [ids]); // ids ref only changes when watchlist is modified

  useEffect(() => {
    fetchAll();
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(fetchAll, intervalMs);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [fetchAll, intervalMs]);

  return tickers;
}
