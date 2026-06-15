import type {
  Analysis, AutoTradeLog, AutoTradeStatus, Candle, Interval,
  PaperPortfolio, PaperTrade, Portfolio, Product, Ticker,
} from "../types";

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  products: () => get<Product[]>("/products"),

  ticker: (productId: string) => get<Ticker>(`/ticker/${productId}`),

  candles: (productId: string, interval: Interval = "1h", limit = 200) =>
    get<Candle[]>(`/candles/${productId}?interval=${interval}&limit=${limit}`),

  analysis: (productId: string, interval: Interval = "1h") =>
    get<Analysis>(`/analysis/${productId}?interval=${interval}`),

  portfolio: () => get<Portfolio>("/portfolio"),

  authStatus: () => get<{ authenticated: boolean }>("/auth-status"),

  placeOrder: (order: {
    product_id: string;
    side: string;
    order_type: string;
    amount: number;
    limit_price?: number;
  }) => post("/orders", order),

  orderHistory: (productId: string) =>
    get<Array<{ order_id: string; side: string; price: number; qty: number; timestamp: number }>>(
      `/orders/history/${productId}`
    ),

  autoTrade: {
    status: () => get<Record<string, AutoTradeStatus>>("/auto-trade/status"),

    start: (
      product_id: string,
      trade_amount_usd: number,
      max_investment_usd: number,
      take_profit_pct_1: number,
      take_profit_pct_2: number,
      entry_price?: number,
      force_fresh?: boolean,
      mode?: "paper" | "live",
    ) =>
      post<{ ok: boolean }>("/auto-trade/start", {
        product_id, trade_amount_usd, max_investment_usd,
        take_profit_pct_1, take_profit_pct_2,
        ...(entry_price != null ? { entry_price } : {}),
        ...(force_fresh ? { force_fresh: true } : {}),
        mode: mode ?? "paper",
      }),

    stop: (product_id: string) =>
      post<{ ok: boolean }>("/auto-trade/stop", { product_id }),

    clearPaused: (product_id: string) =>
      del<{ ok: boolean }>(`/auto-trade/paused/${product_id}`),

    logs: (product_id: string) =>
      get<AutoTradeLog[]>(`/auto-trade/logs/${product_id}`),
  },

  paper: {
    portfolio: () => get<PaperPortfolio>("/paper/portfolio"),

    order: (req: {
      product_id: string;
      side: string;
      order_type: string;
      amount: number;
      limit_price?: number;
      current_price?: number;
    }) => post<Record<string, unknown>>("/paper/order", req),

    cancelOrder: (orderId: string) =>
      fetch(`/api/paper/orders/${orderId}`, { method: "DELETE" }).then((r) => r.json()),

    trades: (limit = 50) => get<PaperTrade[]>(`/paper/trades?limit=${limit}`),

    reset: (startingBalance = 10_000) =>
      post<{ ok: boolean; starting_balance: number }>("/paper/reset", {
        starting_balance: startingBalance,
      }),
  },
};
