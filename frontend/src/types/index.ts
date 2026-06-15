export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Ticker {
  product_id: string;
  price: number;
  bid: number;
  ask: number;
  volume_24h: number;
  change_24h: number;
  change_pct_24h: number;
}

export interface SRLevel {
  price: number;
  strength: number;
  type: "support" | "resistance";
  distance_pct: number;
}

export interface TechnicalIndicators {
  rsi?: number;
  macd?: number;
  macd_signal?: number;
  macd_hist?: number;
  ema_9?: number;
  ema_21?: number;
  ema_50?: number;
  bb_upper?: number;
  bb_middle?: number;
  bb_lower?: number;
  volume_avg?: number;
  current_volume?: number;
}

export interface Signal {
  name: string;
  value: number;
  signal: "buy" | "sell" | "neutral";
  strength: "strong" | "moderate" | "weak";
  description: string;
}

export type OverallSignal = "strong_buy" | "buy" | "neutral" | "sell" | "strong_sell";

export interface Prediction {
  overall: OverallSignal;
  score: number;
  confidence: number;
  signals: Signal[];
  price_targets: { bull: number; base: number; bear: number };
}

export interface Analysis {
  product_id: string;
  current_price: number;
  indicators: TechnicalIndicators;
  support_resistance: SRLevel[];
  prediction: Prediction;
  chart_overlays: {
    ema9?: Array<{ time: number; value: number }>;
    ema21?: Array<{ time: number; value: number }>;
    ema50?: Array<{ time: number; value: number }>;
    bb_upper?: Array<{ time: number; value: number }>;
    bb_middle?: Array<{ time: number; value: number }>;
    bb_lower?: Array<{ time: number; value: number }>;
  };
}

export interface Account {
  currency: string;
  available_balance: number;
  total_balance: number;
  value_usd?: number;
  is_cash?: boolean;
  unrealized_pnl?: number;
  cost_basis?: number;
}

export interface Portfolio {
  total_value_usd: number;
  cash_balance: number;
  crypto_value: number;
  accounts: Account[];
  total_pnl_24h: number;
  total_pnl_pct_24h: number;
}

export interface Product {
  id: string;
  base_currency: string;
  quote_currency: string;
  display_name: string;
  min_market_funds: string;
  base_min_size: string;
}

export interface LiveTick {
  type: "ticker";
  product_id: string;
  price: number;
  best_bid: number;
  best_ask: number;
  volume_24h: number;
  time: string;
}

export type Interval = "1m" | "5m" | "15m" | "1h" | "6h" | "1d";

// ── Paper trading ─────────────────────────────────────────────────────────────

export interface PaperPosition {
  product_id: string;
  currency: string;
  qty: number;
  avg_cost: number;
  total_cost: number;
  current_price: number | null;
  market_value: number | null;
  unrealized_pnl: number | null;
  unrealized_pnl_pct: number | null;
}

export interface PaperOpenOrder {
  order_id: string;
  product_id: string;
  side: "buy" | "sell";
  order_type: "market" | "limit";
  qty: number;
  limit_price: number | null;
  status: "open" | "filled" | "cancelled";
  created_at: number;
}

export interface PaperTrade {
  trade_id: string;
  product_id: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  value: number;
  fee: number;
  realized_pnl: number | null;
  timestamp: number;
}

export interface PaperPortfolio {
  cash_balance: number;
  starting_balance: number;
  total_value: number;
  total_pnl: number;
  total_pnl_pct: number;
  unrealized_pnl: number;
  realized_pnl: number;
  positions: PaperPosition[];
  open_orders: PaperOpenOrder[];
}

// ── Auto-trading ──────────────────────────────────────────────────────────────

export interface AutoTradeStatus {
  product_id: string;
  active: boolean;
  paused: boolean;
  mode: "paper" | "live";
  trade_amount_usd: number;
  max_investment_usd: number;
  take_profit_pct_1: number;
  take_profit_pct_2: number;
  in_position: boolean;
  entry_price: number | null;
  position_size: number | null;
  last_action: string | null;
  last_action_time: number | null;
  last_candle_time: number | null;
}

export interface AutoTradeLog {
  action: string;
  timestamp: number;
  price: number;
  details: Record<string, number>;
  error?: string;
}
