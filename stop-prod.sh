#!/bin/bash
lsof -ti:8001 | xargs kill -9 2>/dev/null && echo "Stopped prod backend  (8001)" || echo "Prod backend not running"
lsof -ti:4173 | xargs kill -9 2>/dev/null && echo "Stopped prod frontend (4173)" || echo "Prod frontend not running"
