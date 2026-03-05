#!/bin/bash
# Local development startup (no Docker required)
set -euo pipefail

cd "$(dirname "$0")"

# Clean up stale dev processes/locks from prior runs.
pkill -f "uvicorn main:app" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
rm -f frontend/.next/dev/lock 2>/dev/null || true

echo "Starting backend on http://localhost:8000 ..."
cd backend
uv run uvicorn main:app --reload --port 8000 &
BACKEND_PID=$!
cd ..

# Wait for backend readiness so frontend proxy doesn't hit startup race.
echo "Waiting for backend health check ..."
for i in {1..60}; do
  if curl -fsS http://localhost:8000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

if ! curl -fsS http://localhost:8000/api/health >/dev/null 2>&1; then
  echo "Backend did not become ready in time. Exiting."
  kill "$BACKEND_PID" 2>/dev/null || true
  exit 1
fi

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
