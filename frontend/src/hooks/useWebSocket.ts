import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveTick } from "../types";

export function useTickerSocket(productId: string, enabled = true) {
  const [tick, setTick] = useState<LiveTick | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current || !enabled) return;
    const ws = new WebSocket(`ws://${location.host}/ws/ticker/${productId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (mountedRef.current) setConnected(true);
    };

    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as LiveTick;
        if (mountedRef.current && data.type === "ticker") {
          setTick(data);
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected(false);
      retryRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, [productId, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    setTick(null);
    connect();
    return () => {
      mountedRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { tick, connected };
}
