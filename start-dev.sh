#!/bin/bash
# ── Development environment ──────────────────────────────────────
# Backend:  http://localhost:8000  (uvicorn --reload)
# Frontend: http://localhost:5173  (Vite HMR)
# State files: auto_trading_state.json / paper_trading_state.json

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Starting DEVELOPMENT servers..."

lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 1

# Backend
cd "$ROOT/backend"
source .venv/bin/activate
APP_ENV=development nohup uvicorn main:app --reload --port 8000 \
  > /tmp/crypto-dev-backend.log 2>&1 &
echo "  Backend  → http://localhost:8000  (log: /tmp/crypto-dev-backend.log)"

# Frontend
cd "$ROOT/frontend"
nohup npm run dev > /tmp/crypto-dev-frontend.log 2>&1 &
echo "  Frontend → http://localhost:5173  (log: /tmp/crypto-dev-frontend.log)"

echo ""
echo "Development environment ready."
