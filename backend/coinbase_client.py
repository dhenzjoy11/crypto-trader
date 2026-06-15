import os
import uuid
import httpx
from typing import List, Dict, Optional
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

EXCHANGE_REST = "https://api.exchange.coinbase.com"
EXCHANGE_WS = "wss://ws-feed.exchange.coinbase.com"

COINBASE_API_KEY = os.getenv("COINBASE_API_KEY", "")
COINBASE_API_SECRET = os.getenv("COINBASE_API_SECRET", "")

HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "CryptoDashboard/1.0",
    "Accept": "application/json",
}

# Granularity seconds → Coinbase label
GRANULARITY_MAP = {
    60: 60,
    300: 300,
    900: 900,
    3600: 3600,
    21600: 21600,
    86400: 86400,
}

POPULAR_PAIRS = [
    "BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD",
    "ADA-USD", "AVAX-USD", "SHIB-USD", "DOT-USD", "LINK-USD",
    "MATIC-USD", "LTC-USD", "BCH-USD", "UNI-USD", "ATOM-USD",
    "XLM-USD", "ALGO-USD", "NEAR-USD", "APE-USD", "PEPE-USD",
    "BONK-USD", "FLOKI-USD", "WIF-USD", "ZORA-USD", "SUI-USD",
]


class PublicClient:
    """Coinbase Exchange public API — no auth required."""

    async def get_products(self) -> List[Dict]:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{EXCHANGE_REST}/products", headers=HEADERS)
            resp.raise_for_status()
            products = resp.json()
        usd = [
            p for p in products
            if p.get("quote_currency") == "USD"
            and p.get("status") == "online"
            and not p.get("trading_disabled", False)
        ]
        # Popular pairs first; rest sorted alphabetically
        def rank(p):
            pid = p.get("id", "")
            return (0, POPULAR_PAIRS.index(pid)) if pid in POPULAR_PAIRS else (1, pid)

        usd.sort(key=rank)
        return usd

    async def get_candles(
        self, product_id: str, granularity: int, start: int, end: int
    ) -> List[List]:
        """Returns [[time, low, high, open, close, volume], ...] sorted ascending."""
        params = {"granularity": granularity, "start": start, "end": end}
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{EXCHANGE_REST}/products/{product_id}/candles",
                params=params,
                headers=HEADERS,
            )
            resp.raise_for_status()
            candles = resp.json()
        # Coinbase returns newest-first; reverse for ascending time
        return sorted(candles, key=lambda c: c[0])

    async def get_ticker(self, product_id: str) -> Dict:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{EXCHANGE_REST}/products/{product_id}/ticker", headers=HEADERS
            )
            resp.raise_for_status()
            return resp.json()

    async def get_stats(self, product_id: str) -> Dict:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{EXCHANGE_REST}/products/{product_id}/stats", headers=HEADERS
            )
            resp.raise_for_status()
            return resp.json()


class AdvancedClient:
    """Coinbase Advanced Trade API — requires API key + secret."""

    def __init__(self):
        self.api_key = COINBASE_API_KEY
        self.api_secret = COINBASE_API_SECRET
        self._rest: Optional[object] = None
        self._init()

    def _init(self):
        if not (self.api_key and self.api_secret):
            return
        try:
            from coinbase.rest import RESTClient
            self._rest = RESTClient(
                api_key=self.api_key,
                api_secret=self.api_secret,
            )
        except Exception as e:
            print(f"[Coinbase] Advanced client init failed: {e}")

    @property
    def authenticated(self) -> bool:
        return self._rest is not None

    def get_portfolio(self) -> Dict:
        """Returns full portfolio via breakdown endpoint — includes cash balance and all holdings."""
        if not self._rest:
            raise PermissionError("Coinbase API keys not configured.")
        # Get default portfolio UUID
        port_resp = self._rest.get_portfolios()
        portfolios = getattr(port_resp, "portfolios", None) or port_resp.get("portfolios", [])
        portfolio_id = None
        for p in portfolios:
            pd = p if isinstance(p, dict) else (vars(p) if hasattr(p, "__dict__") else {})
            if pd.get("type") == "DEFAULT":
                portfolio_id = pd["uuid"]
                break
        if not portfolio_id:
            raise ValueError("No default Coinbase portfolio found")

        bd_resp = self._rest.get_portfolio_breakdown(portfolio_id)
        bd = getattr(bd_resp, "breakdown", None) or bd_resp.get("breakdown", {})
        if hasattr(bd, "__dict__"):
            bd = vars(bd)

        # Portfolio-level balances
        balances = bd.get("portfolio_balances", {}) or {}
        if hasattr(balances, "__dict__"):
            balances = vars(balances)

        def _fval(obj, key):
            v = obj.get(key, {}) if isinstance(obj, dict) else getattr(obj, key, {})
            if hasattr(v, "__dict__"):
                v = vars(v)
            return float((v.get("value") if isinstance(v, dict) else getattr(v, "value", 0)) or 0)

        total_value = _fval(balances, "total_balance")
        cash_balance = _fval(balances, "total_cash_equivalent_balance")
        crypto_value = _fval(balances, "total_crypto_balance")

        # Spot positions → holdings
        spots = bd.get("spot_positions", []) or []
        holdings = []
        for sp in spots:
            d = sp if isinstance(sp, dict) else (vars(sp) if hasattr(sp, "__dict__") else {})
            asset      = d.get("asset", "")
            is_cash    = d.get("is_cash", False)
            fiat_val   = float(d.get("total_balance_fiat", 0) or 0)
            crypto_qty = float(d.get("total_balance_crypto", 0) or 0)
            avail_fiat = float(d.get("available_to_trade_fiat", 0) or 0)
            upnl       = float(d.get("unrealized_pnl", 0) or 0)
            cb_raw     = d.get("cost_basis", {}) or {}
            if hasattr(cb_raw, "__dict__"):
                cb_raw = vars(cb_raw)
            cost_basis = float((cb_raw.get("value") if isinstance(cb_raw, dict) else getattr(cb_raw, "value", 0)) or 0)
            if fiat_val > 0.001 or is_cash:
                holdings.append({
                    "currency":          asset,
                    "available_balance": avail_fiat if is_cash else crypto_qty,
                    "total_balance":     fiat_val if is_cash else crypto_qty,
                    "value_usd":         round(fiat_val, 2),
                    "is_cash":           is_cash,
                    "unrealized_pnl":    round(upnl, 2),
                    "cost_basis":        round(cost_basis, 2),
                })

        return {
            "total_value_usd": round(total_value, 2),
            "cash_balance":    round(cash_balance, 2),
            "crypto_value":    round(crypto_value, 2),
            "holdings":        sorted(holdings, key=lambda x: -x["value_usd"]),
        }

    def get_accounts(self) -> List[Dict]:
        if not self._rest:
            raise PermissionError("Coinbase API keys not configured.")
        resp = self._rest.get_accounts()
        # SDK returns typed response objects, not plain dicts
        raw = getattr(resp, "accounts", None)
        if raw is None:
            raw = resp.get("accounts", []) if isinstance(resp, dict) else []
        accounts = []
        for acc in raw:
            d = acc if isinstance(acc, dict) else (vars(acc) if hasattr(acc, "__dict__") else {})
            cur   = d.get("currency", "")
            avail = d.get("available_balance", {}) or {}
            hold  = d.get("hold", {}) or {}
            bal   = float((avail.get("value") if isinstance(avail, dict) else getattr(avail, "value", 0)) or 0)
            hld   = float((hold.get("value")  if isinstance(hold,  dict) else getattr(hold,  "value", 0)) or 0)
            tot   = bal + hld
            if tot > 0.000001:
                accounts.append({"currency": cur, "available_balance": bal, "total_balance": tot})
        return accounts

    def place_order(
        self,
        product_id: str,
        side: str,
        order_type: str,
        amount: float,
        limit_price: Optional[float] = None,
    ) -> Dict:
        if not self._rest:
            raise PermissionError("Coinbase API keys not configured.")

        oid = str(uuid.uuid4())
        try:
            if order_type == "market":
                if side == "buy":
                    r = self._rest.market_order_buy(
                        client_order_id=oid,
                        product_id=product_id,
                        quote_size=str(amount),
                    )
                else:
                    r = self._rest.market_order_sell(
                        client_order_id=oid,
                        product_id=product_id,
                        base_size=str(amount),
                    )
            else:
                if limit_price is None:
                    raise ValueError("limit_price required for limit orders")
                if side == "buy":
                    r = self._rest.limit_order_gtc_buy(
                        client_order_id=oid,
                        product_id=product_id,
                        base_size=str(amount),
                        limit_price=str(limit_price),
                    )
                else:
                    r = self._rest.limit_order_gtc_sell(
                        client_order_id=oid,
                        product_id=product_id,
                        base_size=str(amount),
                        limit_price=str(limit_price),
                    )
        except Exception as e:
            raise ValueError(str(e))

        # SDK returns typed response objects — extract order fields via attr or dict
        order = r.get("order", r) if isinstance(r, dict) else getattr(r, "order", r)
        if isinstance(order, dict):
            return {
                "order_id":    order.get("order_id", oid),
                "status":      order.get("status", "pending"),
                "filled_size": float(order.get("filled_size", 0) or 0),
                "filled_value": float(order.get("filled_value", 0) or 0),
            }
        return {
            "order_id":    getattr(order, "order_id", oid),
            "status":      getattr(order, "status", "submitted"),
            "filled_size": float(getattr(order, "filled_size", 0) or 0),
            "filled_value": float(getattr(order, "filled_value", 0) or 0),
        }


public_client = PublicClient()
advanced_client = AdvancedClient()
