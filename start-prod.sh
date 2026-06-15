#!/bin/bash
# ── Production environment ───────────────────────────────────────
# Backend:  http://localhost:8001  (uvicorn, no reload)
# Frontend: http://localhost:4173  (Vite preview of built files)
# State files: auto_trading_state_prod.json / paper_trading_state_prod.json

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Starting PRODUCTION servers..."

lsof -ti:8001 | xargs kill -9 2>/dev/null || true
lsof -ti:4173 | xargs kill -9 2>/dev/null || true
sleep 1

# Build frontend
echo "  Building frontend..."
cd "$ROOT/frontend"
npm run build --silent
echo "  Build complete."

# Backend
cd "$ROOT/backend"
source .venv/bin/activate
APP_ENV=production nohup uvicorn main:app --port 8001 \
  > /tmp/crypto-prod-backend.log 2>&1 &
echo "  Backend  → http://localhost:8001  (log: /tmp/crypto-prod-backend.log)"

# Frontend preview
cd "$ROOT/frontend"
nohup npm run preview > /tmp/crypto-prod-frontend.log 2>&1 &
echo "  Frontend → http://localhost:4173  (log: /tmp/crypto-prod-frontend.log)"

echo ""
echo "Production environment ready."
echo "  Backend:  http://localhost:8001"
echo "  Frontend: http://localhost:4173"
