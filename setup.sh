#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "==> Setting up Crypto Dashboard"
echo ""

# ── Backend ──────────────────────────────────────────────────────────────────
echo "[1/3] Installing Python backend dependencies..."
cd "$ROOT/backend"

if ! command -v python3 &>/dev/null; then
  echo "ERROR: python3 not found. Please install Python 3.10+."
  exit 1
fi

python3 -m venv .venv
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt 2>&1 | grep -v "^$" || true
echo "    Backend ready."

# ── .env ─────────────────────────────────────────────────────────────────────
cd "$ROOT"
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ""
  echo "[!] Created .env from .env.example"
  echo "    Edit .env and add your Coinbase API keys to enable trading/portfolio."
fi

# ── Frontend ──────────────────────────────────────────────────────────────────
echo ""
echo "[2/3] Installing Node.js frontend dependencies..."
cd "$ROOT/frontend"

if ! command -v node &>/dev/null; then
  echo "ERROR: node not found. Please install Node.js 18+."
  exit 1
fi

npm install --silent
echo "    Frontend ready."

echo ""
echo "==> Setup complete!"
echo ""
echo "To start the dashboard:"
echo ""
echo "  Terminal 1 (backend):"
echo "    cd $ROOT/backend"
echo "    source .venv/bin/activate"
echo "    uvicorn main:app --reload --port 8000"
echo ""
echo "  Terminal 2 (frontend):"
echo "    cd $ROOT/frontend"
echo "    npm run dev"
echo ""
echo "  Then open: http://localhost:5173"
echo ""
