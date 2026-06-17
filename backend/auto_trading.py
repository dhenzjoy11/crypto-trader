"""
Auto-trading engine.
Runs the SupportResistanceCryptoBot strategy on live 1h candles and executes
paper trades through the paper_trading module.
State is persisted to auto_trading_state.json so it survives restarts.
"""
import asyncio
import copy
import json
import os
import time
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

import paper_trading
from coinbase_client import advanced_client, public_client

_ENV      = os.getenv("APP_ENV", "development")
_SUFFIX   = "_prod" if _ENV == "production" else ""
STATE_FILE = os.path.join(os.path.dirname(__file__), f"auto_trading_state{_SUFFIX}.json")
CANDLE_INTERVAL_SEC = 3600   # 1h candles
CHECK_INTERVAL_SEC  = 60     # check for new candles every minute
CANDLE_HISTORY      = 300    # candles fetched for indicator warmup


# ── Strategy (exactly as provided) ───────────────────────────────────────────

class Action(Enum):
    BUY_INITIAL        = "BUY_INITIAL"
    BUY_ADD_SUPPORT    = "BUY_ADD_SUPPORT"
    BUY_ADD_BREAKOUT   = "BUY_ADD_BREAKOUT"
    SELL_TP1           = "SELL_TP1"          # partial exit at take_profit_pct_1 (50% of position)
    SELL_TP2           = "SELL_TP2"          # full exit at take_profit_pct_2
    SELL_STOP          = "SELL_STOP"
    SELL_TRAILING_STOP = "SELL_TRAILING_STOP"
    HOLD               = "HOLD"


@dataclass
class StrategyConfig:
    atr_period:   int   = 14
    support_atr_mult:    float = 1.5
    resistance_atr_mult: float = 2.0
    stop_atr_mult:       float = 2.0   # was 3.0 — tighter stop loss

    add_size_pct:      float = 0.25
    max_support_adds:  int   = 2
    max_breakout_adds: int   = 3

    rsi_period:               int   = 14
    rsi_buy_floor:            float = 20    # BUY_ADD_SUPPORT blocked when RSI below this (crash guard)
    rsi_buy_threshold:        float = 28    # only add when truly oversold (RSI ≤ 28)
    min_add_stop_buffer_atr:  float = 1.0  # add blocked if price < stop + N×ATR (prevents adding near stop)
    rsi_entry_threshold:      float = 65    # normal uptrend RSI ceiling
    rsi_entry_strong_trend:   float = 75    # relaxed ceiling when EMA gap >= strong_trend_ema_gap_pct
    strong_trend_ema_gap_pct: float = 3.0   # EMA50–EMA200 gap % to qualify as strong trend
    rsi_entry_breakout:       float = 78    # ceiling for fresh N-period high breakout entries
    entry_ema_distance_pct:   float = 0.05  # BUY_INITIAL: price must be within 5% above EMA50

    ema_fast: int = 50
    ema_slow: int = 200

    # Two-tier take-profit:
    #   TP1 — sell 50% of the position at this profit; 0 = disabled
    #   TP2 — sell all remaining shares at this profit; 0 = use trailing stop instead
    take_profit_pct_1: float = 0.05
    take_profit_pct_2: float = 0.20

    # RSI overbought exits — fire before TP% if RSI peaks first
    rsi_sell_overbought: float = 72    # RSI above this → partial sell (same as TP1, fires even if TP% not hit)
    rsi_sell_full_exit:  float = 80    # RSI above this after TP1 → sell all remaining

    trailing_activation_profit: float = 0.08
    trailing_stop_pct:          float = 0.10

    breakout_confirmation_candles: int = 2
    breakout_volume_factor:  float = 0.75  # add-on-breakout needs >= 75% of 20-period avg volume
    breakout_entry_lookback: int   = 48    # candles to look back for fresh-high breakout entry
    breakout_volume_mult:    float = 1.5   # fresh-high breakout entry needs 1.5× avg volume
    cooldown_candles: int = 1


@dataclass
class PositionState:
    in_position:     bool  = False
    entry_price:     float = 0.0
    entry_baseline:  float = 0.0   # anchors stop; raised to entry_price after TP1
    baseline:        float = 0.0   # updates after each breakout for S/R tracking
    position_size:   float = 0.0
    support_adds:    int   = 0
    breakout_adds:   int   = 0
    highest_price:   float = 0.0
    trailing_active: bool  = False
    tp1_triggered:   bool  = False
    cooldown_candles_remaining: int   = 0
    last_stop_price:           float = 0.0  # re-entry blocked until price exceeds this


class SupportResistanceCryptoBot:
    def __init__(self, config: StrategyConfig):
        self.config = config
        self.state  = PositionState()

    def add_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        df["prev_close"] = df["close"].shift(1)
        df["tr1"] = df["high"] - df["low"]
        df["tr2"] = (df["high"] - df["prev_close"]).abs()
        df["tr3"] = (df["low"]  - df["prev_close"]).abs()
        df["true_range"] = df[["tr1", "tr2", "tr3"]].max(axis=1)
        df["atr"]      = df["true_range"].rolling(self.config.atr_period).mean()
        df["ema_fast"] = df["close"].ewm(span=self.config.ema_fast, adjust=False).mean()
        df["ema_slow"] = df["close"].ewm(span=self.config.ema_slow, adjust=False).mean()
        delta    = df["close"].diff()
        gain     = delta.clip(lower=0)
        loss     = -delta.clip(upper=0)
        avg_gain = gain.rolling(self.config.rsi_period).mean()
        avg_loss = loss.rolling(self.config.rsi_period).mean()
        rs       = avg_gain / avg_loss
        df["rsi"]       = 100 - (100 / (1 + rs))
        df["volume_ma"] = df["volume"].rolling(20).mean()
        return df

    def calculate_levels(self, baseline: float, atr: float):
        support    = baseline - self.config.support_atr_mult    * atr
        resistance = baseline + self.config.resistance_atr_mult * atr
        stop       = baseline - self.config.stop_atr_mult       * atr
        return support, resistance, stop

    def should_confirm_breakout(self, df: pd.DataFrame, i: int, resistance: float) -> bool:
        n = self.config.breakout_confirmation_candles
        if i < n:
            return False
        return all(df["close"].iloc[i - n + 1 : i + 1] > resistance)

    def step(self, df: pd.DataFrame, i: int):
        row      = df.iloc[i]
        price    = row["close"]
        atr      = row["atr"]
        rsi      = row["rsi"]
        ema_fast = row["ema_fast"]
        ema_slow = row["ema_slow"]

        if pd.isna(atr) or pd.isna(rsi) or pd.isna(ema_slow):
            return Action.HOLD, {}

        if not self.state.in_position:
            # Cooldown: skip N candles after a stop-loss exit before re-entering
            if self.state.cooldown_candles_remaining > 0:
                self.state.cooldown_candles_remaining -= 1
                return Action.HOLD, {"price": price, "cooldown_remaining": self.state.cooldown_candles_remaining}

            # Re-entry guard: price must recover above the level that stopped us out
            if self.state.last_stop_price > 0 and price <= self.state.last_stop_price:
                return Action.HOLD, {"price": price, "waiting_for_recovery": True,
                                     "last_stop_price": self.state.last_stop_price}

            entry_signal = False
            if ema_fast > ema_slow:  # uptrend required for all entry types
                vol_ma = float(row["volume_ma"]) if "volume_ma" in df.columns and not pd.isna(row["volume_ma"]) else 0

                # Entry type A: two-speed RSI + price not too extended above EMA50
                trend_gap_pct  = (ema_fast - ema_slow) / ema_slow * 100
                rsi_ceiling    = (self.config.rsi_entry_strong_trend
                                  if trend_gap_pct >= self.config.strong_trend_ema_gap_pct
                                  else self.config.rsi_entry_threshold)
                ema_dist_pct   = (price - ema_fast) / ema_fast  # negative = price below EMA50
                standard_entry = (rsi < rsi_ceiling
                                  and ema_dist_pct <= self.config.entry_ema_distance_pct)

                # Entry type B: fresh breakout above N-period high on strong volume
                lookback    = min(i, self.config.breakout_entry_lookback)
                recent_high = df["high"].iloc[max(0, i - lookback):i].max() if lookback > 0 else 0
                breakout_entry = (
                    lookback >= self.config.breakout_entry_lookback
                    and price > recent_high
                    and vol_ma > 0
                    and row["volume"] >= vol_ma * self.config.breakout_volume_mult
                    and rsi < self.config.rsi_entry_breakout
                )

                entry_signal = standard_entry or breakout_entry

            if not entry_signal:
                return Action.HOLD, {"price": price, "waiting_for_entry": True}

            self.state.in_position    = True
            self.state.entry_price    = price
            self.state.entry_baseline = price
            self.state.baseline       = price
            self.state.position_size  = 1.0
            self.state.highest_price  = price
            return Action.BUY_INITIAL, {
                "price": price,
                "baseline": self.state.baseline,
                "position_size": self.state.position_size,
            }

        self.state.highest_price = max(self.state.highest_price, price)
        # Backwards-compat: old saved states have entry_baseline=0.0; heal it from entry_price
        if self.state.entry_baseline == 0.0 and self.state.entry_price > 0:
            self.state.entry_baseline = self.state.entry_price
        support, resistance, _ = self.calculate_levels(self.state.baseline, atr)
        # Stop anchored to original entry level — never ratchets up after breakout adds
        stop = self.state.entry_baseline - self.config.stop_atr_mult * atr

        profit_pct = (price - self.state.entry_price) / self.state.entry_price

        # ── Two-tier take-profit ──────────────────────────────────────────────
        # TP1: sell 50% when price target OR RSI overbought is reached first
        tp1_price_hit = self.config.take_profit_pct_1 > 0 and profit_pct >= self.config.take_profit_pct_1
        tp1_rsi_hit   = self.config.rsi_sell_overbought > 0 and rsi >= self.config.rsi_sell_overbought
        if not self.state.tp1_triggered and (tp1_price_hit or tp1_rsi_hit):
            self.state.tp1_triggered  = True
            self.state.position_size *= 0.5
            self.state.entry_baseline = self.state.entry_price
            return Action.SELL_TP1, {
                "price":      price,
                "sell_ratio": 0.5,
                "profit_pct": round(profit_pct * 100, 2),
                "rsi":        round(rsi, 2),
            }

        # TP2: sell all remaining when price target OR RSI full-exit threshold reached (after TP1)
        tp2_price_hit = self.config.take_profit_pct_2 > 0 and profit_pct >= self.config.take_profit_pct_2
        tp2_rsi_hit   = (self.config.rsi_sell_full_exit > 0
                         and self.state.tp1_triggered
                         and rsi >= self.config.rsi_sell_full_exit)
        if tp2_price_hit or tp2_rsi_hit:
            old_size   = self.state.position_size
            self.state = PositionState()
            return Action.SELL_TP2, {
                "price":      price,
                "sold_size":  old_size,
                "profit_pct": round(profit_pct * 100, 2),
                "rsi":        round(rsi, 2),
            }

        # ── Trailing stop (used when TP2 == 0 or hasn't triggered yet) ───────
        if profit_pct >= self.config.trailing_activation_profit:
            self.state.trailing_active = True

        if self.state.trailing_active:
            trailing_stop = self.state.highest_price * (1 - self.config.trailing_stop_pct)
            if price <= trailing_stop:
                old_size = self.state.position_size
                self.state = PositionState(
                    cooldown_candles_remaining=self.config.cooldown_candles,
                    last_stop_price=trailing_stop,
                )
                return Action.SELL_TRAILING_STOP, {
                    "price": price, "sold_size": old_size, "trailing_stop": trailing_stop,
                }

        if price <= stop:
            old_size = self.state.position_size
            self.state = PositionState(
                cooldown_candles_remaining=self.config.cooldown_candles,
                last_stop_price=stop,
            )
            return Action.SELL_STOP, {
                "price": price, "sold_size": old_size, "stop": stop,
            }

        if self.should_confirm_breakout(df, i, resistance):
            vol_ma = float(row["volume_ma"]) if "volume_ma" in df.columns and not pd.isna(row["volume_ma"]) else 0
            low_volume = vol_ma > 0 and row["volume"] < vol_ma * self.config.breakout_volume_factor
            if not low_volume and self.state.breakout_adds < self.config.max_breakout_adds:
                # Baseline only moves when the order actually fires — not on skipped breakouts
                self.state.baseline     = resistance
                self.state.support_adds = 0
                add_size = self.state.position_size * self.config.add_size_pct
                self.state.position_size += add_size
                self.state.breakout_adds += 1
                return Action.BUY_ADD_BREAKOUT, {
                    "price": price, "new_baseline": self.state.baseline,
                    "added_size": add_size, "position_size": self.state.position_size,
                }
            return Action.HOLD, {"price": price, "resistance": resistance, "breakout_low_volume": low_volume}

        uptrend = price > ema_slow and ema_fast > ema_slow
        add_has_stop_room = price >= stop + self.config.min_add_stop_buffer_atr * atr
        if (
            price <= support
            and self.config.rsi_buy_floor < rsi <= self.config.rsi_buy_threshold
            and uptrend
            and add_has_stop_room
            and self.state.support_adds < self.config.max_support_adds
        ):
            add_size = self.state.position_size * self.config.add_size_pct
            self.state.position_size += add_size
            self.state.support_adds  += 1
            return Action.BUY_ADD_SUPPORT, {
                "price": price, "support": support, "rsi": rsi,
                "added_size": add_size, "position_size": self.state.position_size,
            }

        return Action.HOLD, {
            "price": price, "baseline": self.state.baseline,
            "support": support, "resistance": resistance,
            "stop": stop, "position_size": self.state.position_size,
        }

    def backtest(self, df: pd.DataFrame) -> pd.DataFrame:
        df   = self.add_indicators(df)
        logs = []
        for i in range(len(df)):
            action, info = self.step(df, i)
            if action != Action.HOLD:
                logs.append({"timestamp": df.index[i], "action": action.value, **info})
        return pd.DataFrame(logs)


# ── Per-symbol state ──────────────────────────────────────────────────────────

@dataclass
class AutoTraderEntry:
    product_id:          str
    trade_amount_usd:    float
    max_investment_usd:  float
    take_profit_pct_1:   float
    take_profit_pct_2:   float
    last_candle_time:    Optional[int]
    mode:                str = "paper"               # "paper" | "live"
    logs: List[dict] = field(default_factory=list)   # most-recent first, max 50


# ── Manager ───────────────────────────────────────────────────────────────────

class AutoTraderManager:
    def __init__(self):
        self.entries: Dict[str, AutoTraderEntry] = {}
        self.bots:    Dict[str, SupportResistanceCryptoBot] = {}
        self.paused:  Dict[str, dict] = {}   # stopped bots whose state is preserved for resume
        self._load()

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def run(self):
        """Background loop — checks for new candles every minute."""
        while True:
            await asyncio.sleep(CHECK_INTERVAL_SEC)
            for pid in list(self.entries):
                try:
                    await self._check(pid)
                except Exception as e:
                    print(f"[AutoTrade] {pid} check error: {e}")

    def start(
        self,
        product_id: str,
        trade_amount_usd: float,
        max_investment_usd: float = 500.0,
        take_profit_pct_1: float = 0.05,
        take_profit_pct_2: float = 0.20,
        entry_price: Optional[float] = None,
        force_fresh: bool = False,
        mode: str = "paper",
    ):
        if product_id in self.entries:
            # Already active — update config only
            entry = self.entries[product_id]
            entry.trade_amount_usd   = trade_amount_usd
            entry.max_investment_usd = max_investment_usd
            entry.take_profit_pct_1  = take_profit_pct_1
            entry.take_profit_pct_2  = take_profit_pct_2
            entry.mode               = mode
            if product_id in self.bots:
                self.bots[product_id].config.take_profit_pct_1 = take_profit_pct_1
                self.bots[product_id].config.take_profit_pct_2 = take_profit_pct_2
            self._save()
            return

        # Resume paused state unless caller explicitly wants a fresh start
        if product_id in self.paused and not force_fresh and entry_price is None:
            ps = self.paused.pop(product_id)
            bot = SupportResistanceCryptoBot(StrategyConfig(
                take_profit_pct_1=take_profit_pct_1,
                take_profit_pct_2=take_profit_pct_2,
            ))
            bot.state = PositionState(**{
                k: v for k, v in ps.get("bot_state", {}).items()
                if k in PositionState.__dataclass_fields__
            })
            self.entries[product_id] = AutoTraderEntry(
                product_id=product_id,
                trade_amount_usd=trade_amount_usd,
                max_investment_usd=max_investment_usd,
                take_profit_pct_1=take_profit_pct_1,
                take_profit_pct_2=take_profit_pct_2,
                last_candle_time=ps.get("last_candle_time"),
                mode=ps.get("mode", mode),
                logs=ps.get("logs", []),
            )
            self.bots[product_id] = bot
            self._save()
            print(f"[AutoTrade] Resumed {product_id} mode={ps.get('mode', mode)} (TP1: {take_profit_pct_1*100:.1f}%, TP2: {take_profit_pct_2*100:.1f}%)")
            return

        # Start fresh — clear any stale paused state
        self.paused.pop(product_id, None)

        bot = SupportResistanceCryptoBot(StrategyConfig(
            take_profit_pct_1=take_profit_pct_1,
            take_profit_pct_2=take_profit_pct_2,
        ))

        if entry_price and entry_price > 0:
            # Pre-fill position at user-specified price; skip BUY_INITIAL
            bot.state = PositionState(
                in_position=True,
                entry_price=entry_price,
                entry_baseline=entry_price,
                baseline=entry_price,
                position_size=1.0,
                highest_price=entry_price,
            )
            if mode == "paper":
                ps_paper = paper_trading.get_state()
                usd = min(trade_amount_usd, ps_paper.cash_balance)
                if usd >= 1:
                    paper_trading.place_order(product_id, "buy", "market", usd / entry_price, None, entry_price)
            else:
                # Live: place real buy at specified entry price
                qty = trade_amount_usd / entry_price
                try:
                    advanced_client.place_order(product_id, "buy", "market", trade_amount_usd)
                    print(f"[AutoTrade] LIVE entry order placed for {product_id}: ~{qty:.4f} @ ${entry_price}")
                except Exception as e:
                    print(f"[AutoTrade] LIVE entry order failed for {product_id}: {e}")

        self.entries[product_id] = AutoTraderEntry(
            product_id=product_id,
            trade_amount_usd=trade_amount_usd,
            max_investment_usd=max_investment_usd,
            take_profit_pct_1=take_profit_pct_1,
            take_profit_pct_2=take_profit_pct_2,
            last_candle_time=None,
            mode=mode,
        )
        self.bots[product_id] = bot
        self._save()
        tag = f"entry_price=${entry_price}" if entry_price else "waiting for BUY signal"
        print(f"[AutoTrade] Started {product_id} fresh mode={mode} (trade: ${trade_amount_usd}, max: ${max_investment_usd}, TP1: {take_profit_pct_1*100:.1f}%, TP2: {take_profit_pct_2*100:.1f}%, {tag})")

    def stop(self, product_id: str):
        entry = self.entries.pop(product_id, None)
        bot   = self.bots.pop(product_id, None)
        if entry and bot:
            # Preserve state so the bot can be resumed later
            self.paused[product_id] = {
                "trade_amount_usd":   entry.trade_amount_usd,
                "max_investment_usd": entry.max_investment_usd,
                "take_profit_pct_1":  entry.take_profit_pct_1,
                "take_profit_pct_2":  entry.take_profit_pct_2,
                "last_candle_time":   entry.last_candle_time,
                "mode":               entry.mode,
                "bot_state":          asdict(bot.state),
                "logs":               entry.logs,
            }
        self._save()
        print(f"[AutoTrade] Stopped {product_id} (state paused for resume)")

    def clear_paused(self, product_id: str):
        """Discard a paused state so next start creates a fresh bot."""
        self.paused.pop(product_id, None)
        self._save()

    def status(self) -> Dict[str, dict]:
        out = {}
        for pid, entry in self.entries.items():
            bot = self.bots.get(pid)
            bs  = bot.state if bot else PositionState()
            out[pid] = {
                "product_id":         pid,
                "active":             True,
                "paused":             False,
                "mode":               entry.mode,
                "trade_amount_usd":   entry.trade_amount_usd,
                "max_investment_usd": entry.max_investment_usd,
                "take_profit_pct_1":  entry.take_profit_pct_1,
                "take_profit_pct_2":  entry.take_profit_pct_2,
                "in_position":        bs.in_position,
                "entry_price":        bs.entry_price   if bs.in_position else None,
                "position_size":      bs.position_size if bs.in_position else None,
                "last_action":        entry.logs[0]["action"]    if entry.logs else None,
                "last_action_time":   entry.logs[0]["timestamp"] if entry.logs else None,
                "last_candle_time":   entry.last_candle_time,
            }
        for pid, ps in self.paused.items():
            bs_dict = ps.get("bot_state", {})
            in_pos  = bs_dict.get("in_position", False)
            logs    = ps.get("logs", [])
            out[pid] = {
                "product_id":         pid,
                "active":             False,
                "paused":             True,
                "mode":               ps.get("mode", "paper"),
                "trade_amount_usd":   ps.get("trade_amount_usd", 100),
                "max_investment_usd": ps.get("max_investment_usd", 500),
                "take_profit_pct_1":  ps.get("take_profit_pct_1", 0.05),
                "take_profit_pct_2":  ps.get("take_profit_pct_2", 0.20),
                "in_position":        in_pos,
                "entry_price":        bs_dict.get("entry_price") if in_pos else None,
                "position_size":      bs_dict.get("position_size") if in_pos else None,
                "last_action":        logs[0].get("action")    if logs else None,
                "last_action_time":   logs[0].get("timestamp") if logs else None,
                "last_candle_time":   ps.get("last_candle_time"),
            }
        return out

    def get_logs(self, product_id: str) -> List[dict]:
        return self.entries[product_id].logs if product_id in self.entries else []

    # ── Internal ──────────────────────────────────────────────────────────────

    async def _check(self, product_id: str):
        entry = self.entries.get(product_id)
        bot   = self.bots.get(product_id)
        if not entry or not bot:
            return

        import time as _time
        end   = int(_time.time())
        start = end - CANDLE_INTERVAL_SEC * CANDLE_HISTORY

        raw = await public_client.get_candles(product_id, CANDLE_INTERVAL_SEC, start, end)
        if not raw:
            return

        df = _raw_to_df(raw)
        df = bot.add_indicators(df)

        # Find all new candles since last processed time
        if entry.last_candle_time is None:
            new_df = df.tail(1)   # first activation: process the latest completed candle
        else:
            new_df = df[df["time"] > entry.last_candle_time]

        if new_df.empty:
            return

        # ── Fix: lock last_candle_time BEFORE any awaits ─────────────────────
        # Prevents a second concurrent _check call (e.g., from a /start API race
        # or a server restart) from seeing last_candle_time=None and re-processing
        # the same candle, which caused duplicate BUY_INITIAL orders.
        entry.last_candle_time = int(df["time"].iloc[-1])

        # Process each new candle in chronological order
        for idx in new_df.index:
            i = df.index.get_loc(idx)

            # Snapshot state before step() so we can rollback if a live order fails
            pre_state = copy.deepcopy(bot.state)
            action, info = bot.step(df, i)

            log_entry = {
                "action":    action.value,
                "timestamp": float(df.iloc[i]["time"]),
                "price":     round(float(info.get("price", 0)), 4),
                "details":   {k: round(float(v), 4) for k, v in info.items()
                              if k != "price" and isinstance(v, (int, float))},
            }

            if action != Action.HOLD:
                print(f"[AutoTrade] {product_id}: {action.value} @ {log_entry['price']}")
                try:
                    await self._execute(entry, bot, action, info)
                except Exception as e:
                    print(f"[AutoTrade] Execute error for {product_id}: {e}")
                    log_entry["error"] = str(e)
                    # Rollback bot state for failed BUY orders so we don't
                    # record a position that was never actually opened
                    if action in (Action.BUY_INITIAL, Action.BUY_ADD_SUPPORT, Action.BUY_ADD_BREAKOUT):
                        bot.state = pre_state
                        continue  # don't log a buy that didn't happen

                entry.logs.insert(0, log_entry)
                entry.logs = entry.logs[:50]

        self._save()

    async def _execute(
        self,
        entry: AutoTraderEntry,
        bot: SupportResistanceCryptoBot,
        action: Action,
        info: dict,
    ):
        price = float(info.get("price", 0))
        if price <= 0:
            return

        if entry.mode == "live":
            await self._execute_live(entry, bot, action, price)
        else:
            self._execute_paper(entry, bot, action, price)

    def _execute_paper(
        self,
        entry: AutoTraderEntry,
        bot: SupportResistanceCryptoBot,
        action: Action,
        price: float,
    ):
        ps        = paper_trading.get_state()
        paper_pos = ps.positions.get(entry.product_id)

        total_invested   = paper_pos.total_cost if paper_pos else 0.0
        remaining_budget = max(0.0, entry.max_investment_usd - total_invested)

        if action == Action.BUY_INITIAL:
            usd = min(entry.trade_amount_usd, ps.cash_balance, remaining_budget)
            if usd < 1:
                return
            paper_trading.place_order(entry.product_id, "buy", "market", usd / price, None, price)

        elif action in (Action.BUY_ADD_SUPPORT, Action.BUY_ADD_BREAKOUT):
            usd = min(entry.trade_amount_usd * bot.config.add_size_pct, ps.cash_balance, remaining_budget)
            if usd < 1:
                return
            paper_trading.place_order(entry.product_id, "buy", "market", usd / price, None, price)

        elif action == Action.SELL_TP1:
            if paper_pos and paper_pos.qty > 0:
                paper_trading.place_order(entry.product_id, "sell", "market", paper_pos.qty * 0.5, None, price)

        elif action in (Action.SELL_STOP, Action.SELL_TRAILING_STOP, Action.SELL_TP2):
            if paper_pos and paper_pos.qty > 0:
                paper_trading.place_order(entry.product_id, "sell", "market", paper_pos.qty, None, price)
            else:
                bot.state = PositionState()

    async def _place_order_with_retry(
        self,
        pid: str,
        side: str,
        order_type: str,
        amount: float,
        retries: int = 3,
        delay: float = 3.0,
    ) -> dict:
        """Improvement 3: retry transient connection errors before giving up."""
        last_err: Exception = RuntimeError("no attempts")
        for attempt in range(retries):
            try:
                return advanced_client.place_order(pid, side, order_type, amount)
            except Exception as e:
                last_err = e
                if attempt < retries - 1:
                    print(f"[AutoTrade LIVE] {pid} {side} attempt {attempt + 1}/{retries} failed ({e}), retrying in {delay}s...")
                    await asyncio.sleep(delay)
        raise last_err

    async def _execute_live(
        self,
        entry: AutoTraderEntry,
        bot: SupportResistanceCryptoBot,
        action: Action,
        price: float,
    ):
        if not advanced_client.authenticated:
            raise PermissionError("Coinbase API not authenticated — cannot place live order")

        pid = entry.product_id
        base_currency = pid.split("-")[0]

        # get_accounts() misses USD fiat — use portfolio breakdown for accurate balances
        portfolio     = advanced_client.get_portfolio()
        usd_holding   = next((h for h in portfolio["holdings"] if h["is_cash"]), None)
        asset_holding = next((h for h in portfolio["holdings"] if h["currency"] == base_currency), None)
        usd_balance   = usd_holding["available_balance"] if usd_holding else 0.0
        asset_balance = asset_holding["available_balance"] if asset_holding else 0.0   # crypto units

        # Compute how much USD is currently invested in this position (based on live value)
        invested = (asset_holding["value_usd"] if asset_holding else 0.0)
        remaining_budget = max(0.0, entry.max_investment_usd - invested)

        if action == Action.BUY_INITIAL:
            # Don't check remaining_budget here — pre-existing holdings of the asset
            # would count as "invested" and prevent a proper initial entry.
            usd = min(entry.trade_amount_usd, usd_balance)
            if usd < 1:
                raise ValueError(f"BUY_INITIAL skipped — insufficient USD (${usd_balance:.2f})")
            await self._place_order_with_retry(pid, "buy", "market", usd)
            print(f"[AutoTrade LIVE] {pid} BUY_INITIAL ${usd:.2f}")

        elif action in (Action.BUY_ADD_SUPPORT, Action.BUY_ADD_BREAKOUT):
            usd = min(entry.trade_amount_usd * bot.config.add_size_pct, usd_balance, remaining_budget)
            if usd < 1:
                raise ValueError(f"{action.value} skipped — insufficient USD (${usd_balance:.2f})")
            await self._place_order_with_retry(pid, "buy", "market", usd)
            print(f"[AutoTrade LIVE] {pid} {action.value} ${usd:.2f}")

        elif action == Action.SELL_TP1:
            sell_qty = asset_balance * 0.5
            if sell_qty <= 0:
                print(f"[AutoTrade LIVE] {pid} SELL_TP1 skipped — no asset balance")
                return
            await self._place_order_with_retry(pid, "sell", "market", sell_qty)
            print(f"[AutoTrade LIVE] {pid} SELL_TP1 {sell_qty:.6f} {base_currency}")

        elif action in (Action.SELL_STOP, Action.SELL_TRAILING_STOP, Action.SELL_TP2):
            if asset_balance <= 0:
                print(f"[AutoTrade LIVE] {pid} {action.value} skipped — no asset balance")
                bot.state = PositionState()
                return
            await self._place_order_with_retry(pid, "sell", "market", asset_balance)
            print(f"[AutoTrade LIVE] {pid} {action.value} {asset_balance:.6f} {base_currency}")

    # ── Persistence ───────────────────────────────────────────────────────────

    def _save(self):
        data: dict = {}
        for pid, entry in self.entries.items():
            bot_s = self.bots[pid].state if pid in self.bots else PositionState()
            data[pid] = {
                "trade_amount_usd":   entry.trade_amount_usd,
                "max_investment_usd": entry.max_investment_usd,
                "take_profit_pct_1":  entry.take_profit_pct_1,
                "take_profit_pct_2":  entry.take_profit_pct_2,
                "last_candle_time":   entry.last_candle_time,
                "mode":               entry.mode,
                "bot_state":          asdict(bot_s),
                "logs":               entry.logs,
            }
        data["__paused__"] = self.paused
        try:
            with open(STATE_FILE, "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"[AutoTrade] Save failed: {e}")

    def _load(self):
        if not os.path.exists(STATE_FILE):
            return
        try:
            with open(STATE_FILE) as f:
                data = json.load(f)
            self.paused = data.pop("__paused__", {})
            for pid, d in data.items():
                # Backwards compat: old state files have take_profit_pct (single value)
                tp1 = d.get("take_profit_pct_1", d.get("take_profit_pct", 0.05))
                tp2 = d.get("take_profit_pct_2", 0.20)
                entry = AutoTraderEntry(
                    product_id=pid,
                    trade_amount_usd=d.get("trade_amount_usd", 100.0),
                    max_investment_usd=d.get("max_investment_usd", 500.0),
                    take_profit_pct_1=tp1,
                    take_profit_pct_2=tp2,
                    last_candle_time=d.get("last_candle_time"),
                    mode=d.get("mode", "paper"),
                    logs=d.get("logs", []),
                )
                bot = SupportResistanceCryptoBot(StrategyConfig(
                    take_profit_pct_1=tp1,
                    take_profit_pct_2=tp2,
                ))
                # tp1_triggered defaults to False — safe even loading old state
                bot.state = PositionState(**{
                    k: v for k, v in d.get("bot_state", {}).items()
                    if k in PositionState.__dataclass_fields__
                })
                self.entries[pid] = entry
                self.bots[pid]    = bot
            print(f"[AutoTrade] Loaded {len(self.entries)} active trader(s): {list(self.entries)}")
        except Exception as e:
            print(f"[AutoTrade] Load failed: {e}")


def _raw_to_df(raw: list) -> pd.DataFrame:
    df = pd.DataFrame(raw, columns=["time", "low", "high", "open", "close", "volume"])
    df = df.astype(float)
    df["time"] = df["time"].astype(int)
    return df.sort_values("time").reset_index(drop=True)


# Module-level singleton
auto_trader = AutoTraderManager()
