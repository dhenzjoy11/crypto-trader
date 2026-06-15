import asyncio
import json
import time
from contextlib import asynccontextmanager
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
import websockets
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

import auto_trading as auto_trading_module
import paper_trading
from coinbase_client import EXCHANGE_WS, advanced_client, public_client
from models import (
    Analysis, AutoTradeStartRequest, AutoTradeStopRequest,
    OrderRequest, OrderResponse, PaperOrderRequest, PaperResetRequest, Portfolio, Ticker,
)
from technical_analysis import (
    calculate_indicators,
    calculate_support_resistance,
    generate_prediction,
    prepare_chart_overlays,
)

# ── WebSocket connection manager ─────────────────────────────────────────────

class ConnectionManager:
    def __init__(self):
        self.connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, key: str, ws: WebSocket):
        await ws.accept()
        self.connections.setdefault(key, []).append(ws)

    def disconnect(self, key: str, ws: WebSocket):
        if key in self.connections:
            try:
                self.connections[key].remove(ws)
            except ValueError:
                pass

    async def broadcast(self, key: str, data: dict):
        dead: List[WebSocket] = []
        for ws in self.connections.get(key, []):
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(key, ws)

    def has_listeners(self, key: str) -> bool:
        return bool(self.connections.get(key))


manager = ConnectionManager()
_cb_ws_tasks: Dict[str, asyncio.Task] = {}


# ── Coinbase → Backend WebSocket relay ───────────────────────────────────────

async def coinbase_feed_task(product_id: str):
    """Connect to Coinbase Exchange WebSocket and relay ticker to frontend clients."""
    while True:
        try:
            async with websockets.connect(EXCHANGE_WS, ping_interval=20) as ws:
                sub = json.dumps({
                    "type": "subscribe",
                    "channels": [{"name": "ticker", "product_ids": [product_id]}],
                })
                await ws.send(sub)
                async for raw in ws:
                    if not manager.has_listeners(product_id):
                        return  # No clients — stop task
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if msg.get("type") == "ticker":
                        payload = {
                            "type": "ticker",
                            "product_id": product_id,
                            "price": float(msg.get("price", 0)),
                            "best_bid": float(msg.get("best_bid", 0)),
                            "best_ask": float(msg.get("best_ask", 0)),
                            "volume_24h": float(msg.get("volume_24h", 0)),
                            "time": msg.get("time", ""),
                        }
                        await manager.broadcast(product_id, payload)
        except Exception as e:
            if not manager.has_listeners(product_id):
                return
            await asyncio.sleep(3)  # reconnect backoff


def ensure_feed(product_id: str):
    if product_id not in _cb_ws_tasks or _cb_ws_tasks[product_id].done():
        _cb_ws_tasks[product_id] = asyncio.create_task(coinbase_feed_task(product_id))


# ── App setup ─────────────────────────────────────────────────────────────────

async def _limit_order_checker():
    """Background task: check open paper limit orders every 15 s."""
    while True:
        await asyncio.sleep(15)
        state = paper_trading.get_state()
        if not state.open_orders:
            continue
        product_ids = {o.product_id for o in state.open_orders}
        prices: Dict[str, float] = {}
        for pid in product_ids:
            try:
                t = await public_client.get_ticker(pid)
                prices[pid] = float(t.get("price", 0))
            except Exception:
                pass
        filled = paper_trading.check_limit_orders(prices)
        for o in filled:
            print(f"[Paper] Limit order {o.order_id} filled: {o.side} {o.qty:.6f} {o.product_id} @ {o.filled_price}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    limit_task = asyncio.create_task(_limit_order_checker())
    auto_task  = asyncio.create_task(auto_trading_module.auto_trader.run())
    yield
    limit_task.cancel()
    auto_task.cancel()
    for task in _cb_ws_tasks.values():
        task.cancel()


app = FastAPI(title="Crypto Dashboard API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ───────────────────────────────────────────────────────────────────

GRANULARITY_LABEL = {
    "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "6h": 21600, "1d": 86400
}
CANDLE_LIMIT = 300  # max candles per request


def candles_to_df(raw: List[List]) -> pd.DataFrame:
    df = pd.DataFrame(raw, columns=["time", "low", "high", "open", "close", "volume"])
    df = df.astype({"time": int, "low": float, "high": float, "open": float, "close": float, "volume": float})
    return df.sort_values("time").reset_index(drop=True)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/api/products")
async def get_products():
    try:
        products = await public_client.get_products()
        return [
            {
                "id": p["id"],
                "base_currency": p.get("base_currency", ""),
                "quote_currency": p.get("quote_currency", ""),
                "display_name": p.get("display_name", p["id"]),
                "min_market_funds": p.get("min_market_funds", "10"),
                "base_min_size": p.get("base_min_size", "0.001"),
            }
            for p in products
        ]
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/ticker/{product_id}")
async def get_ticker(product_id: str) -> Ticker:
    try:
        ticker = await public_client.get_ticker(product_id)
        stats = await public_client.get_stats(product_id)
        price = float(ticker.get("price", 0))
        open_24h = float(stats.get("open", price) or price)
        change = price - open_24h
        change_pct = (change / open_24h * 100) if open_24h else 0
        return Ticker(
            product_id=product_id,
            price=price,
            bid=float(ticker.get("bid", 0)),
            ask=float(ticker.get("ask", 0)),
            volume_24h=float(stats.get("volume", 0)),
            change_24h=round(change, 4),
            change_pct_24h=round(change_pct, 2),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/candles/{product_id}")
async def get_candles(product_id: str, interval: str = "1h", limit: int = 200):
    granularity = GRANULARITY_LABEL.get(interval, 3600)
    limit = min(limit, CANDLE_LIMIT)
    end = int(time.time())
    start = end - granularity * limit
    try:
        raw = await public_client.get_candles(product_id, granularity, start, end)
        return [
            {
                "time": int(c[0]),
                "open": float(c[3]),
                "high": float(c[2]),
                "low": float(c[1]),
                "close": float(c[4]),
                "volume": float(c[5]),
            }
            for c in raw
        ]
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/analysis/{product_id}")
async def get_analysis(product_id: str, interval: str = "1h") -> Analysis:
    granularity = GRANULARITY_LABEL.get(interval, 3600)
    end = int(time.time())
    start = end - granularity * 300
    try:
        raw = await public_client.get_candles(product_id, granularity, start, end)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    if not raw:
        raise HTTPException(status_code=404, detail="No candle data returned")

    df = candles_to_df(raw)
    current_price = float(df["close"].iloc[-1])

    indicators = calculate_indicators(df)
    sr_levels = calculate_support_resistance(df)
    prediction = generate_prediction(df, indicators)
    overlays = prepare_chart_overlays(df)

    return Analysis(
        product_id=product_id,
        current_price=current_price,
        indicators=indicators,
        support_resistance=sr_levels,
        prediction=prediction,
        chart_overlays=overlays,
    )


@app.get("/api/portfolio")
async def get_portfolio() -> Portfolio:
    if not advanced_client.authenticated:
        raise HTTPException(
            status_code=401,
            detail="Coinbase API keys not configured. Set COINBASE_API_KEY and COINBASE_API_SECRET in .env",
        )
    try:
        data = advanced_client.get_portfolio()
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))

    total_upnl = sum(h.get("unrealized_pnl", 0) for h in data["holdings"])
    return Portfolio(
        total_value_usd=data["total_value_usd"],
        cash_balance=data["cash_balance"],
        crypto_value=data["crypto_value"],
        accounts=[
            {
                "currency":          h["currency"],
                "available_balance": h["available_balance"],
                "total_balance":     h["total_balance"],
                "value_usd":         h["value_usd"],
                "is_cash":           h["is_cash"],
                "unrealized_pnl":    h.get("unrealized_pnl"),
                "cost_basis":        h.get("cost_basis"),
            }
            for h in data["holdings"]
        ],
        total_pnl_24h=round(total_upnl, 2),
        total_pnl_pct_24h=0.0,
    )


@app.post("/api/orders")
async def place_order(req: OrderRequest) -> OrderResponse:
    if not advanced_client.authenticated:
        raise HTTPException(
            status_code=401,
            detail="Coinbase API keys not configured.",
        )
    try:
        result = advanced_client.place_order(
            product_id=req.product_id,
            side=req.side,
            order_type=req.order_type,
            amount=req.amount,
            limit_price=req.limit_price,
        )
        return OrderResponse(
            order_id=result["order_id"],
            product_id=req.product_id,
            side=req.side,
            status=result["status"],
            filled_size=result.get("filled_size"),
            filled_value=result.get("filled_value"),
        )
    except PermissionError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/auth-status")
async def auth_status():
    return {"authenticated": advanced_client.authenticated}


@app.get("/api/orders/history/{product_id}")
async def get_order_history(product_id: str, limit: int = 100):
    """Return filled Coinbase orders for a product (newest first)."""
    if not advanced_client.authenticated:
        return []
    try:
        return advanced_client.get_order_history(product_id, limit)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Paper trading routes ──────────────────────────────────────────────────────

@app.get("/api/paper/portfolio")
async def get_paper_portfolio():
    state = paper_trading.get_state()

    # Enrich positions with current prices
    enriched: List[dict] = []
    total_market_value = 0.0
    total_unrealized = 0.0

    for pid, pos in state.positions.items():
        try:
            t = await public_client.get_ticker(pid)
            cur = float(t.get("price", 0))
        except Exception:
            cur = 0.0
        mv          = cur * pos.qty if cur else None
        unreal      = (cur - pos.avg_cost) * pos.qty if cur else None
        unreal_pct  = ((cur - pos.avg_cost) / pos.avg_cost * 100) if cur and pos.avg_cost else None
        if mv:
            total_market_value += mv
        if unreal:
            total_unrealized += unreal
        enriched.append({
            "product_id":         pid,
            "currency":           pos.currency,
            "qty":                round(pos.qty, 8),
            "avg_cost":           round(pos.avg_cost, 4),
            "total_cost":         round(pos.total_cost, 2),
            "current_price":      round(cur, 4) if cur else None,
            "market_value":       round(mv, 2) if mv else None,
            "unrealized_pnl":     round(unreal, 2) if unreal is not None else None,
            "unrealized_pnl_pct": round(unreal_pct, 2) if unreal_pct is not None else None,
        })

    # Sort by market value descending
    enriched.sort(key=lambda x: x["market_value"] or 0, reverse=True)

    realized_pnl = sum(t.realized_pnl or 0 for t in state.trades)
    total_pnl    = realized_pnl + total_unrealized
    total_value  = state.cash_balance + total_market_value
    pnl_pct      = (total_pnl / state.starting_balance * 100) if state.starting_balance else 0

    return {
        "cash_balance":     round(state.cash_balance, 2),
        "starting_balance": state.starting_balance,
        "total_value":      round(total_value, 2),
        "total_pnl":        round(total_pnl, 2),
        "total_pnl_pct":    round(pnl_pct, 2),
        "unrealized_pnl":   round(total_unrealized, 2),
        "realized_pnl":     round(realized_pnl, 2),
        "positions":        enriched,
        "open_orders":      [
            {
                "order_id":    o.order_id,
                "product_id":  o.product_id,
                "side":        o.side,
                "order_type":  o.order_type,
                "qty":         o.qty,
                "limit_price": o.limit_price,
                "status":      o.status,
                "created_at":  o.created_at,
            }
            for o in state.open_orders
        ],
    }


@app.post("/api/paper/order")
async def place_paper_order(req: PaperOrderRequest):
    # Use client-supplied price (from live WebSocket/ticker) to avoid Exchange API 404s
    if req.current_price and req.current_price > 0:
        current_price = req.current_price
    else:
        try:
            t = await public_client.get_ticker(req.product_id)
            current_price = float(t.get("price", 0))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Symbol '{req.product_id}' not found on exchange. Try selecting it first so a live price is available.")

    if current_price <= 0:
        raise HTTPException(status_code=400, detail="Could not determine current price for this symbol")

    fill_ref = req.limit_price if req.order_type == "limit" else current_price

    # Convert amount → qty
    if req.side == "buy":
        qty = req.amount / fill_ref
    else:
        qty = req.amount  # for sell, amount IS the qty

    try:
        result = paper_trading.place_order(
            product_id=req.product_id,
            side=req.side,
            order_type=req.order_type,
            qty=qty,
            limit_price=req.limit_price,
            current_price=current_price,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/paper/orders/{order_id}")
async def cancel_paper_order(order_id: str):
    if not paper_trading.cancel_order(order_id):
        raise HTTPException(status_code=404, detail="Order not found")
    return {"cancelled": True}


@app.get("/api/paper/trades")
async def get_paper_trades(limit: int = 50):
    state = paper_trading.get_state()
    trades = sorted(state.trades, key=lambda t: t.timestamp, reverse=True)[:limit]
    return [
        {
            "trade_id":     t.trade_id,
            "product_id":   t.product_id,
            "side":         t.side,
            "qty":          round(t.qty, 8),
            "price":        round(t.price, 4),
            "value":        round(t.value, 2),
            "fee":          round(t.fee, 4),
            "realized_pnl": round(t.realized_pnl, 2) if t.realized_pnl is not None else None,
            "timestamp":    t.timestamp,
        }
        for t in trades
    ]


@app.post("/api/paper/reset")
async def reset_paper_account(req: PaperResetRequest):
    paper_trading.reset(req.starting_balance)
    return {"ok": True, "starting_balance": req.starting_balance}


# ── Auto-trading routes ───────────────────────────────────────────────────────

@app.get("/api/auto-trade/status")
async def auto_trade_status():
    return auto_trading_module.auto_trader.status()


@app.post("/api/auto-trade/start")
async def auto_trade_start(req: AutoTradeStartRequest):
    auto_trading_module.auto_trader.start(
        req.product_id,
        req.trade_amount_usd,
        req.max_investment_usd,
        req.take_profit_pct_1,
        req.take_profit_pct_2,
        entry_price=req.entry_price,
        force_fresh=req.force_fresh,
        mode=req.mode,
    )
    return {"ok": True, "product_id": req.product_id}


@app.post("/api/auto-trade/stop")
async def auto_trade_stop(req: AutoTradeStopRequest):
    auto_trading_module.auto_trader.stop(req.product_id)
    return {"ok": True, "product_id": req.product_id}


@app.delete("/api/auto-trade/paused/{product_id}")
async def auto_trade_clear_paused(product_id: str):
    auto_trading_module.auto_trader.clear_paused(product_id)
    return {"ok": True, "product_id": product_id}


@app.get("/api/auto-trade/logs/{product_id}")
async def auto_trade_logs(product_id: str):
    return auto_trading_module.auto_trader.get_logs(product_id)


# ── WebSocket endpoint ────────────────────────────────────────────────────────

@app.websocket("/ws/ticker/{product_id}")
async def ws_ticker(websocket: WebSocket, product_id: str):
    await manager.connect(product_id, websocket)
    ensure_feed(product_id)
    try:
        while True:
            await asyncio.sleep(1)  # keep alive, messages sent via broadcast
    except WebSocketDisconnect:
        manager.disconnect(product_id, websocket)
    except Exception:
        manager.disconnect(product_id, websocket)
