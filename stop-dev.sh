#!/bin/bash
lsof -ti:8000 | xargs kill -9 2>/dev/null && echo "Stopped dev backend  (8000)" || echo "Dev backend not running"
lsof -ti:5173 | xargs kill -9 2>/dev/null && echo "Stopped dev frontend (5173)" || echo "Dev frontend not running"
