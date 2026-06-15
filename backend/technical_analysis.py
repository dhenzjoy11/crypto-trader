import warnings
from typing import List, Tuple

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

try:
    from ta.momentum import RSIIndicator
    from ta.trend import MACD, EMAIndicator
    from ta.volatility import BollingerBands
    HAS_TA = True
except ImportError:
    HAS_TA = False

from models import SupportResistanceLevel, TechnicalIndicators, Signal, Prediction


# ── Support / Resistance ─────────────────────────────────────────────────────

def calculate_support_resistance(
    df: pd.DataFrame,
    window: int = 8,
    num_levels: int = 4,
    cluster_pct: float = 0.005,
) -> List[SupportResistanceLevel]:
    if len(df) < window * 2 + 1:
        return []

    highs = df["high"].values
    lows = df["low"].values
    current_price = float(df["close"].iloc[-1])

    resistance_points: List[float] = []
    support_points: List[float] = []

    for i in range(window, len(df) - window):
        if all(highs[i] >= highs[i - j] for j in range(1, window + 1)) and \
           all(highs[i] >= highs[i + j] for j in range(1, window + 1)):
            resistance_points.append(float(highs[i]))
        if all(lows[i] <= lows[i - j] for j in range(1, window + 1)) and \
           all(lows[i] <= lows[i + j] for j in range(1, window + 1)):
            support_points.append(float(lows[i]))

    # Classic pivot levels from most-recent completed candle
    h = float(df["high"].iloc[-1])
    l = float(df["low"].iloc[-1])
    c = float(df["close"].iloc[-1])
    pivot = (h + l + c) / 3
    resistance_points.extend([2 * pivot - l, pivot + (h - l), pivot + 2 * (h - l)])
    support_points.extend([2 * pivot - h, pivot - (h - l), pivot - 2 * (h - l)])

    def cluster(points: List[float]) -> List[Tuple[float, int]]:
        if not points:
            return []
        pts = sorted(set(points))
        groups: List[List[float]] = [[pts[0]]]
        for p in pts[1:]:
            if (p - groups[-1][-1]) / groups[-1][-1] <= cluster_pct:
                groups[-1].append(p)
            else:
                groups.append([p])
        return [(float(np.mean(g)), len(g)) for g in groups]

    result: List[SupportResistanceLevel] = []
    per_side = num_levels // 2
    max_dist = current_price * 0.12  # cap levels within ±12% — prevents extreme pivot extensions distorting chart scale

    res = [
        (p, s) for p, s in cluster(resistance_points)
        if current_price < p <= current_price + max_dist
    ]
    res.sort(key=lambda x: x[0])
    for price, strength in res[:per_side]:
        result.append(SupportResistanceLevel(
            price=round(price, 2),
            strength=min(strength, 10),
            type="resistance",
            distance_pct=round((price - current_price) / current_price * 100, 2),
        ))

    sup = [
        (p, s) for p, s in cluster(support_points)
        if current_price - max_dist <= p < current_price
    ]
    sup.sort(key=lambda x: x[0], reverse=True)
    for price, strength in sup[:per_side]:
        result.append(SupportResistanceLevel(
            price=round(price, 2),
            strength=min(strength, 10),
            type="support",
            distance_pct=round((current_price - price) / current_price * 100, 2),
        ))

    return result


# ── Indicators ────────────────────────────────────────────────────────────────

def _safe(series: "pd.Series | None") -> "float | None":
    if series is None:
        return None
    try:
        v = float(series.iloc[-1])
        return round(v, 6) if not np.isnan(v) else None
    except Exception:
        return None


def calculate_indicators(df: pd.DataFrame) -> TechnicalIndicators:
    if len(df) < 26:
        return TechnicalIndicators()

    close = df["close"]
    volume = df["volume"] if "volume" in df.columns else None

    rsi_val = macd_val = macd_sig_val = macd_hist_val = None
    ema9_val = ema21_val = ema50_val = None
    bb_upper_val = bb_mid_val = bb_lower_val = None

    if HAS_TA:
        try:
            rsi_val = _safe(RSIIndicator(close=close, window=14).rsi())

            macd_ind = MACD(close=close, window_slow=26, window_fast=12, window_sign=9)
            macd_val = _safe(macd_ind.macd())
            macd_sig_val = _safe(macd_ind.macd_signal())
            macd_hist_val = _safe(macd_ind.macd_diff())

            ema9_val = _safe(EMAIndicator(close=close, window=9).ema_indicator())
            ema21_val = _safe(EMAIndicator(close=close, window=21).ema_indicator())
            ema50_val = _safe(EMAIndicator(close=close, window=50).ema_indicator())

            bb = BollingerBands(close=close, window=20, window_dev=2)
            bb_upper_val = _safe(bb.bollinger_hband())
            bb_mid_val = _safe(bb.bollinger_mavg())
            bb_lower_val = _safe(bb.bollinger_lband())
        except Exception:
            pass
    else:
        # Pure-pandas fallback
        rsi_val = _calc_rsi(close, 14)
        ema9_val = _safe(close.ewm(span=9, adjust=False).mean())
        ema21_val = _safe(close.ewm(span=21, adjust=False).mean())
        ema50_val = _safe(close.ewm(span=50, adjust=False).mean())

    vol_avg = _safe(volume.rolling(20).mean()) if volume is not None else None
    current_vol = _safe(volume) if volume is not None else None

    return TechnicalIndicators(
        rsi=rsi_val,
        macd=macd_val,
        macd_signal=macd_sig_val,
        macd_hist=macd_hist_val,
        ema_9=ema9_val,
        ema_21=ema21_val,
        ema_50=ema50_val,
        bb_upper=bb_upper_val,
        bb_middle=bb_mid_val,
        bb_lower=bb_lower_val,
        volume_avg=vol_avg,
        current_volume=current_vol,
    )


def _calc_rsi(close: pd.Series, period: int = 14) -> "float | None":
    if len(close) < period + 1:
        return None
    delta = close.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - 100 / (1 + rs)
    v = float(rsi.iloc[-1])
    return round(v, 2) if not np.isnan(v) else None


# ── Prediction signals ────────────────────────────────────────────────────────

def generate_prediction(df: pd.DataFrame, indicators: TechnicalIndicators) -> Prediction:
    signals: List[Signal] = []
    total_score = 0.0
    current_price = float(df["close"].iloc[-1])

    # RSI
    if indicators.rsi is not None:
        r = indicators.rsi
        if r < 30:
            sc, sig, st, desc = 2.0, "buy",     "strong",   f"RSI {r:.1f} — deeply oversold"
        elif r < 40:
            sc, sig, st, desc = 1.0, "buy",     "moderate", f"RSI {r:.1f} — approaching oversold"
        elif r > 70:
            sc, sig, st, desc = -2.0, "sell",   "strong",   f"RSI {r:.1f} — deeply overbought"
        elif r > 60:
            sc, sig, st, desc = -1.0, "sell",   "moderate", f"RSI {r:.1f} — approaching overbought"
        else:
            sc, sig, st, desc = 0.0, "neutral", "weak",     f"RSI {r:.1f} — neutral zone"
        total_score += sc
        signals.append(Signal(name="RSI (14)", value=r, signal=sig, strength=st, description=desc))

    # MACD
    if indicators.macd is not None and indicators.macd_signal is not None:
        m, ms = indicators.macd, indicators.macd_signal
        if m > ms and m > 0:
            sc, sig, st, desc = 2.0,  "buy",     "strong",   "MACD bullish crossover above zero"
        elif m > ms:
            sc, sig, st, desc = 1.0,  "buy",     "moderate", "MACD above signal (below zero)"
        elif m < ms and m < 0:
            sc, sig, st, desc = -2.0, "sell",    "strong",   "MACD bearish crossover below zero"
        elif m < ms:
            sc, sig, st, desc = -1.0, "sell",    "moderate", "MACD below signal (above zero)"
        else:
            sc, sig, st, desc = 0.0,  "neutral", "weak",     "MACD flat"
        total_score += sc
        signals.append(Signal(name="MACD (12/26/9)", value=round(m, 6), signal=sig, strength=st, description=desc))

    # Bollinger Bands
    if indicators.bb_upper and indicators.bb_lower and indicators.bb_middle:
        bb_range = indicators.bb_upper - indicators.bb_lower
        if bb_range > 0:
            pos = (current_price - indicators.bb_lower) / bb_range
            if current_price < indicators.bb_lower:
                sc, sig, st, desc = 1.5,  "buy",     "strong", "Price below lower BB — reversal likely"
            elif current_price > indicators.bb_upper:
                sc, sig, st, desc = -1.5, "sell",    "strong", "Price above upper BB — reversal likely"
            elif pos < 0.3:
                sc, sig, st, desc = 0.5,  "buy",     "weak",   f"Price in lower BB zone ({pos*100:.0f}%)"
            elif pos > 0.7:
                sc, sig, st, desc = -0.5, "sell",    "weak",   f"Price in upper BB zone ({pos*100:.0f}%)"
            else:
                sc, sig, st, desc = 0.0,  "neutral", "weak",   f"Price mid-band ({pos*100:.0f}%)"
            total_score += sc
            signals.append(Signal(name="Bollinger Bands", value=round(pos * 100, 1), signal=sig, strength=st, description=desc))

    # EMA Trend
    if indicators.ema_9 and indicators.ema_21 and indicators.ema_50:
        e9, e21, e50 = indicators.ema_9, indicators.ema_21, indicators.ema_50
        if e9 > e21 > e50:
            sc, sig, st, desc = 1.5,  "buy",     "strong",   "Bullish EMA stack: 9 > 21 > 50"
        elif e9 < e21 < e50:
            sc, sig, st, desc = -1.5, "sell",    "strong",   "Bearish EMA stack: 9 < 21 < 50"
        elif e9 > e21:
            sc, sig, st, desc = 0.5,  "buy",     "moderate", "Short EMA above mid-term"
        else:
            sc, sig, st, desc = -0.5, "sell",    "moderate", "Short EMA below mid-term"
        total_score += sc
        signals.append(Signal(name="EMA Trend", value=round(e9, 2), signal=sig, strength=st, description=desc))

    # Volume confirmation
    if indicators.volume_avg and indicators.current_volume and len(df) > 1:
        ratio = indicators.current_volume / indicators.volume_avg
        change = (float(df["close"].iloc[-1]) - float(df["close"].iloc[-2])) / float(df["close"].iloc[-2])
        if ratio > 1.5 and change > 0:
            sc, sig, st, desc = 1.0,  "buy",     "moderate", f"High volume ({ratio:.1f}x avg) confirms upward move"
        elif ratio > 1.5 and change < 0:
            sc, sig, st, desc = -1.0, "sell",    "moderate", f"High volume ({ratio:.1f}x avg) confirms downward move"
        else:
            sc, sig, st, desc = 0.0,  "neutral", "weak",     f"Volume {ratio:.1f}x average"
        total_score += sc
        signals.append(Signal(name="Volume", value=round(ratio, 2), signal=sig, strength=st, description=desc))

    max_possible = 8.0
    norm = max(-5.0, min(5.0, (total_score / max_possible) * 5.0))

    if norm >= 2.0:
        overall = "strong_buy"
    elif norm >= 0.8:
        overall = "buy"
    elif norm <= -2.0:
        overall = "strong_sell"
    elif norm <= -0.8:
        overall = "sell"
    else:
        overall = "neutral"

    atr = _calc_atr(df)
    return Prediction(
        overall=overall,
        score=round(norm, 2),
        confidence=round(min(abs(norm) / 5.0, 1.0), 2),
        signals=signals,
        price_targets={
            "bull": round(current_price + atr * 2, 2),
            "base": round(current_price + atr * 0.5, 2),
            "bear": round(current_price - atr * 2, 2),
        },
    )


def _calc_atr(df: pd.DataFrame, period: int = 14) -> float:
    if len(df) < period + 1:
        return float(df["close"].std()) if len(df) > 1 else 0.0
    h, l, c = df["high"], df["low"], df["close"]
    tr = pd.concat([(h - l), (h - c.shift(1)).abs(), (l - c.shift(1)).abs()], axis=1).max(axis=1)
    atr = float(tr.rolling(period).mean().iloc[-1])
    return atr if not np.isnan(atr) else float(df["close"].std())


# ── Chart overlay data ────────────────────────────────────────────────────────

def prepare_chart_overlays(df: pd.DataFrame) -> dict:
    if len(df) < 50:
        return {}

    close = df["close"]
    times = df["time"].astype(int).tolist()

    def to_series(series: "pd.Series | None") -> list:
        if series is None:
            return []
        return [
            {"time": int(t), "value": round(float(v), 4)}
            for t, v in zip(times, series.values)
            if not np.isnan(float(v))
        ]

    result: dict = {}

    if HAS_TA:
        try:
            result["ema9"]  = to_series(EMAIndicator(close=close, window=9).ema_indicator())
            result["ema21"] = to_series(EMAIndicator(close=close, window=21).ema_indicator())
            result["ema50"] = to_series(EMAIndicator(close=close, window=50).ema_indicator())
            bb = BollingerBands(close=close, window=20, window_dev=2)
            result["bb_upper"]  = to_series(bb.bollinger_hband())
            result["bb_middle"] = to_series(bb.bollinger_mavg())
            result["bb_lower"]  = to_series(bb.bollinger_lband())
        except Exception:
            pass
    else:
        result["ema9"]  = to_series(close.ewm(span=9,  adjust=False).mean())
        result["ema21"] = to_series(close.ewm(span=21, adjust=False).mean())
        result["ema50"] = to_series(close.ewm(span=50, adjust=False).mean())

    return result
