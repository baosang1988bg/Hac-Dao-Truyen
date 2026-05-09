#!/bin/bash

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── Dọn port cũ trước khi start ──────────────────────────────────────────────
echo -e "${YELLOW}Cleaning up ports 4444 and 5173...${NC}"
lsof -ti :4444 | xargs kill -9 2>/dev/null
lsof -ti :5173 | xargs kill -9 2>/dev/null
sleep 0.5

# ── Start Backend ──────────────────────────────────────────────────────────────
echo -e "${BLUE}Starting NovelAI Backend (FastAPI)...${NC}"
python3 -m uvicorn api:app --host 127.0.0.1 --port 4444 --reload &
BACKEND_PID=$!

# ── Start Frontend ─────────────────────────────────────────────────────────────
echo -e "${GREEN}Starting NovelAI Frontend (Vite React)...${NC}"
cd frontend && npm run dev &
FRONTEND_PID=$!

# ── Cleanup on Ctrl+C ─────────────────────────────────────────────────────────
cleanup() {
    echo -e "\nStopping NovelAI..."
    lsof -ti :4444 | xargs kill -9 2>/dev/null
    lsof -ti :5173 | xargs kill -9 2>/dev/null
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 0
}
trap cleanup SIGINT SIGTERM

wait
