"""
Paper trading engine — real prices, virtual money.
State is persisted to paper_trading_state.json so it survives backend restarts.
"""
import json
import os
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional

_ENV       = os.getenv("APP_ENV", "development")
_SUFFIX    = "_prod" if _ENV == "production" else ""
STATE_FILE = os.path.join(os.path.dirname(__file__), f"paper_trading_state{_SUFFIX}.json")
STARTING_BALANCE = 10_000.0
FEE_RATE = 0.001   # 0.1% per side (realistic taker fee)

_state: Optional["PaperState"] = None


@dataclass
class PaperPosition:
    product_id: str
    currency: str
    qty: float
    avg_cost: float     # average cost per unit in USD
    total_cost: float   # total cost basis in USD


@dataclass
class PaperOrder:
    order_id: str
    product_id: str
    side: str           # "buy" | "sell"
    order_type: str     # "market" | "limit"
    qty: float
    limit_price: Optional[float]
    status: str         # "open" | "filled" | "cancelled"
    created_at: float
    filled_at: Optional[float] = None
    filled_price: Optional[float] = None


@dataclass
class PaperTrade:
    trade_id: str
    product_id: str
    side: str
    qty: float
    price: float
    value: float
    fee: float
    realized_pnl: Optional[float]   # only set on sells
    timestamp: float


@dataclass
class PaperState:
    cash_balance: float = STARTING_BALANCE
    starting_balance: float = STARTING_BALANCE
    positions: Dict[str, PaperPosition] = field(default_factory=dict)
    open_orders: List[PaperOrder] = field(default_factory=list)
    trades: List[PaperTrade] = field(default_factory=list)


# ── Persistence ───────────────────────────────────────────────────────────────

def _to_dict(state: PaperState) -> dict:
    return {
        "cash_balance": state.cash_balance,
        "starting_balance": state.starting_balance,
        "positions": {k: asdict(v) for k, v in state.positions.items()},
        "open_orders": [asdict(o) for o in state.open_orders],
        "trades": [asdict(t) for t in state.trades],
    }


def _from_dict(data: dict) -> PaperState:
    state = PaperState(
        cash_balance=data.get("cash_balance", STARTING_BALANCE),
        starting_balance=data.get("starting_balance", STARTING_BALANCE),
    )
    for pid, p in data.get("positions", {}).items():
        state.positions[pid] = PaperPosition(**p)
    for o in data.get("open_orders", []):
        state.open_orders.append(PaperOrder(**o))
    for t in data.get("trades", []):
        state.trades.append(PaperTrade(**t))
    return state


def _load() -> PaperState:
    global _state
    if _state is not None:
        return _state
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE) as f:
                _state = _from_dict(json.load(f))
            return _state
        except Exception as e:
            print(f"[Paper] Failed to load state: {e} — starting fresh")
    _state = PaperState()
    return _state


def _save(state: PaperState):
    try:
        with open(STATE_FILE, "w") as f:
            json.dump(_to_dict(state), f, indent=2)
    except Exception as e:
        print(f"[Paper] Failed to save state: {e}")


# ── Public API ────────────────────────────────────────────────────────────────

def get_state() -> PaperState:
    return _load()


def place_order(
    product_id: str,
    side: str,
    order_type: str,
    qty: float,
    limit_price: Optional[float],
    current_price: float,
) -> dict:
    """Execute or queue a paper order. Market orders fill immediately."""
    if qty <= 0:
        raise ValueError("Quantity must be positive.")

    state = _load()
    order_id = str(uuid.uuid4())[:8].upper()
    now = time.time()

    if order_type == "market":
        fill_price = current_price
        fee = qty * fill_price * FEE_RATE
        _execute_fill(state, order_id, product_id, side, qty, fill_price, fee, now)
        _save(state)
        return {
            "order_id": order_id,
            "status": "filled",
            "filled_price": round(fill_price, 4),
            "qty": round(qty, 8),
            "value": round(qty * fill_price, 2),
            "fee": round(fee, 2),
        }
    else:
        if limit_price is None:
            raise ValueError("limit_price required for limit orders.")

        # Pre-validate cash/position before queuing
        if side == "buy":
            cost = qty * limit_price * (1 + FEE_RATE)
            if state.cash_balance < cost:
                raise ValueError(
                    f"Insufficient cash. Need ${cost:.2f}, have ${state.cash_balance:.2f}"
                )
        else:
            pos = state.positions.get(product_id)
            if not pos or pos.qty < qty - 1e-9:
                avail = pos.qty if pos else 0
                raise ValueError(
                    f"Insufficient position. Need {qty:.6f}, have {avail:.6f}"
                )

        order = PaperOrder(
            order_id=order_id,
            product_id=product_id,
            side=side,
            order_type="limit",
            qty=qty,
            limit_price=limit_price,
            status="open",
            created_at=now,
        )
        state.open_orders.append(order)
        _save(state)
        return {
            "order_id": order_id,
            "status": "open",
            "limit_price": limit_price,
            "qty": round(qty, 8),
        }


def cancel_order(order_id: str) -> bool:
    state = _load()
    before = len(state.open_orders)
    state.open_orders = [o for o in state.open_orders if o.order_id != order_id]
    if len(state.open_orders) < before:
        _save(state)
        return True
    return False


def check_limit_orders(prices: Dict[str, float]) -> List[PaperOrder]:
    """Call periodically with a {product_id: price} map; fills any triggered limits."""
    state = _load()
    filled: List[PaperOrder] = []
    now = time.time()

    for order in list(state.open_orders):
        price = prices.get(order.product_id)
        if price is None or order.limit_price is None:
            continue
        triggered = (
            (order.side == "buy"  and price <= order.limit_price) or
            (order.side == "sell" and price >= order.limit_price)
        )
        if not triggered:
            continue
        fee = order.qty * order.limit_price * FEE_RATE
        try:
            _execute_fill(
                state, order.order_id, order.product_id, order.side,
                order.qty, order.limit_price, fee, now,
            )
            order.status = "filled"
            order.filled_at = now
            order.filled_price = order.limit_price
            filled.append(order)
        except ValueError as e:
            print(f"[Paper] Limit order {order.order_id} fill failed: {e}")

    if filled:
        filled_ids = {o.order_id for o in filled}
        state.open_orders = [o for o in state.open_orders if o.order_id not in filled_ids]
        _save(state)

    return filled


def reset(starting_balance: float = STARTING_BALANCE):
    global _state
    _state = PaperState(
        cash_balance=starting_balance,
        starting_balance=starting_balance,
    )
    _save(_state)
    print(f"[Paper] Account reset — starting balance ${starting_balance:,.2f}")


# ── Internal ──────────────────────────────────────────────────────────────────

def _execute_fill(
    state: PaperState,
    order_id: str,
    product_id: str,
    side: str,
    qty: float,
    fill_price: float,
    fee: float,
    timestamp: float,
):
    value = qty * fill_price
    currency = product_id.split("-")[0]
    realized_pnl: Optional[float] = None

    if side == "buy":
        total_cost = value + fee
        if state.cash_balance < total_cost - 1e-6:
            raise ValueError(
                f"Insufficient cash. Need ${total_cost:.2f}, have ${state.cash_balance:.2f}"
            )
        state.cash_balance -= total_cost
        pos = state.positions.get(product_id)
        if pos:
            new_qty        = pos.qty + qty
            new_total_cost = pos.total_cost + value
            pos.qty        = new_qty
            pos.total_cost = new_total_cost
            pos.avg_cost   = new_total_cost / new_qty
        else:
            state.positions[product_id] = PaperPosition(
                product_id=product_id,
                currency=currency,
                qty=qty,
                avg_cost=fill_price,
                total_cost=value,
            )

    else:  # sell
        pos = state.positions.get(product_id)
        if not pos or pos.qty < qty - 1e-9:
            avail = pos.qty if pos else 0
            raise ValueError(
                f"Insufficient position. Need {qty:.6f}, have {avail:.6f}"
            )
        proceeds      = value - fee
        cost_of_sold  = pos.avg_cost * qty
        realized_pnl  = proceeds - cost_of_sold
        state.cash_balance += proceeds

        remaining_qty = pos.qty - qty
        if remaining_qty <= 1e-9:
            del state.positions[product_id]
        else:
            pos.qty        = remaining_qty
            pos.total_cost = pos.avg_cost * remaining_qty   # keep avg_cost unchanged

    state.trades.append(PaperTrade(
        trade_id=str(uuid.uuid4())[:8].upper(),
        product_id=product_id,
        side=side,
        qty=qty,
        price=fill_price,
        value=value,
        fee=round(fee, 4),
        realized_pnl=round(realized_pnl, 4) if realized_pnl is not None else None,
        timestamp=timestamp,
    ))
