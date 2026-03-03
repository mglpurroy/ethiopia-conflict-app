#!/bin/bash
# Local development startup (no Docker required)

cd "$(dirname "$0")"

echo "Starting backend on http://localhost:8000 ..."
cd backend
uv run uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

echo "Starting frontend on http://localhost:3000 ..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "App running:"
echo "  Frontend → http://localhost:3000"
echo "  API docs → http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both services."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
