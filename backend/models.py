from pydantic import BaseModel
from typing import List, Optional, Dict


class Candle(BaseModel):
    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


class Ticker(BaseModel):
    product_id: str
    price: float
    bid: float
    ask: float
    volume_24h: float
    change_24h: float
    change_pct_24h: float


class SupportResistanceLevel(BaseModel):
    price: float
    strength: int
    type: str  # "support" or "resistance"
    distance_pct: float


class TechnicalIndicators(BaseModel):
    rsi: Optional[float] = None
    macd: Optional[float] = None
    macd_signal: Optional[float] = None
    macd_hist: Optional[float] = None
    ema_9: Optional[float] = None
    ema_21: Optional[float] = None
    ema_50: Optional[float] = None
    bb_upper: Optional[float] = None
    bb_middle: Optional[float] = None
    bb_lower: Optional[float] = None
    volume_avg: Optional[float] = None
    current_volume: Optional[float] = None


class Signal(BaseModel):
    name: str
    value: float
    signal: str  # "buy", "sell", "neutral"
    strength: str  # "strong", "moderate", "weak"
    description: str


class Prediction(BaseModel):
    overall: str  # "strong_buy", "buy", "neutral", "sell", "strong_sell"
    score: float
    confidence: float
    signals: List[Signal]
    price_targets: Dict[str, float]


class Analysis(BaseModel):
    product_id: str
    current_price: float
    indicators: TechnicalIndicators
    support_resistance: List[SupportResistanceLevel]
    prediction: Prediction
    chart_overlays: Dict


class Account(BaseModel):
    currency: str
    available_balance: float
    total_balance: float
    value_usd: Optional[float] = None
    is_cash: bool = False
    unrealized_pnl: Optional[float] = None
    cost_basis: Optional[float] = None


class Portfolio(BaseModel):
    total_value_usd: float
    cash_balance: float = 0.0
    crypto_value: float = 0.0
    accounts: List[Account]
    total_pnl_24h: float
    total_pnl_pct_24h: float


class OrderRequest(BaseModel):
    product_id: str
    side: str  # "buy" or "sell"
    order_type: str  # "market" or "limit"
    amount: float
    limit_price: Optional[float] = None


class OrderResponse(BaseModel):
    order_id: str
    product_id: str
    side: str
    status: str
    filled_size: Optional[float] = None
    filled_value: Optional[float] = None
    message: Optional[str] = None


# ── Paper trading models ──────────────────────────────────────────────────────

class PaperOrderRequest(BaseModel):
    product_id: str
    side: str           # "buy" | "sell"
    order_type: str     # "market" | "limit"
    amount: float       # USD for buy, qty for sell
    limit_price: Optional[float] = None
    current_price: Optional[float] = None  # live price from frontend; bypasses Exchange API fetch


class PaperResetRequest(BaseModel):
    starting_balance: float = 10_000.0


class AutoTradeStartRequest(BaseModel):
    product_id:          str
    trade_amount_usd:    float = 100.0
    max_investment_usd:  float = 500.0
    take_profit_pct_1:   float = 0.05
    take_profit_pct_2:   float = 0.20
    entry_price:         Optional[float] = None   # pre-fill position at this price (fresh start)
    force_fresh:         bool = False             # ignore any paused state and start new
    mode:                str  = "paper"           # "paper" | "live"


class AutoTradeStopRequest(BaseModel):
    product_id: str
