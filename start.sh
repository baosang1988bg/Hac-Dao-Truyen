#!/bin/bash

# Define colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}Starting NovelAI Backend (FastAPI)...${NC}"
python3 -m uvicorn api:app --host 127.0.0.1 --port 4444 --reload &
BACKEND_PID=$!

echo -e "${GREEN}Starting NovelAI Frontend (Vite React)...${NC}"
cd frontend && npm run dev &
FRONTEND_PID=$!

# Trap SIGINT (Ctrl+C) and kill both processes
trap "echo -e '\nStopping NovelAI...'; kill $BACKEND_PID $FRONTEND_PID; exit 0" SIGINT

# Wait for both processes
wait
