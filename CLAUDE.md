# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Local Development

```bash
# Start both services (convenience script)
./dev.sh

# Backend only
cd backend
uv run uvicorn main:app --reload --port 8000

# Frontend only
cd frontend && npm run dev   # http://localhost:3000
```

API docs (Swagger UI): http://localhost:8000/docs
Health check: http://localhost:8000/api/health

### Docker

```bash
docker compose up          # Start all services (port 80)
docker compose up -d       # Detached
docker compose logs -f backend
docker compose build
```

### Frontend

```bash
cd frontend
npm run lint               # ESLint
npm run build              # Production build (standalone output)
```

## Architecture

### Overview

FastAPI (Python, port 8000) + Next.js App Router (TypeScript, port 3000), proxied through Nginx on port 80. No database — data is loaded from CSV/shapefiles into an in-memory module-level cache with pickle persistence.

```
ACLED CSV + Shapefiles
    ↓ loaded at startup
Backend services (in-memory cache + pickle)
    ↓ exposed as REST endpoints
FastAPI routers (/api/*)
    ↓ fetched via api.ts
TanStack Query hooks (5-min staleTime)
    ↓ rendered by
Next.js pages (App Router)
```

### Backend (`backend/`)

**Entry point:** `main.py` — FastAPI app with lifespan that warm-up caches all datasets on startup.

**Services** (business logic, no HTTP concerns):
- `services/conflict_service.py` — loads ACLED CSV, filters BRD events, computes KPIs, timeseries, admin aggregations. Module-level `_cache` dict + pickle files with TTL.
- `services/spatial_service.py` — loads ward/LGA/state shapefiles, returns GeoJSON (simplified for wards), choropleth data merged with conflict metrics, unit history.
- `services/alert_service.py` — computes 4-dimension Conflict Index (0–10), RAG status, MoM change detection with z-score escalation.
- `services/ai_service.py` — Claude API integration for narrative summaries of states/LGAs and actor profiles. Cached 1h.

**Routers** (HTTP layer only):
- `routers/conflicts.py` → `/api/summary`, `/api/conflicts`, `/api/conflicts/timeseries`, `/api/conflicts/by-admin`
- `routers/alerts.py` → `/api/alerts/status`, `/api/alerts/conflict-index`, `/api/alerts/changes`, `/api/alerts/summary`
- `routers/spatial.py` → `/api/spatial/boundaries/{level}`, `/api/spatial/choropleth`, `/api/spatial/events`, `/api/spatial/unit-summary`
- `routers/actors.py` → `/api/actors`, `/api/actors/{name}/timeline`, `/api/actors/{name}/geography`, `/api/actors/{name}/profile`
- `routers/exports.py` → `/api/export/csv`, `/api/export/excel`

**Schemas:** All responses are Pydantic `BaseModel`s in `models/schemas.py`.

**Caching tiers:** (1) module-level dict (fastest), (2) pickle file in `CACHE_DIR` (survives restarts), (3) reload from source. TTL defaults to 3600s. Boundaries cached 24h, AI summaries 1h.

**Data:** `backend/data/` and `backend/acled_Nigeria.csv` are symlinks to `../nigeria-dashboard/`. For Docker, real files must be present (symlinks don't resolve in containers).

### Frontend (`frontend/`)

**App Router pages** (`app/`):
- `/` — Alert Dashboard: KPI strip, RAG summary counts, state alert grid, top-5 hotspots
- `/early-warning` — State table with configurable RAG thresholds
- `/spatial` — MapLibre GL choropleth with state/LGA drill-down
- `/explorer` — Recharts time series with date/state/event-type filters
- `/actors` — Top actors table + timeline + geography + AI profile
- `/reports` — CSV/Excel/GeoJSON export + print briefing

**Data fetching:** All server state via TanStack Query hooks in `lib/hooks/`. Hooks call typed functions in `lib/api.ts`, which wraps `fetch` with `NEXT_PUBLIC_API_URL`.

**Map:** `components/map/ConflictMap.tsx` uses `dynamic import` with `{ ssr: false }` to avoid hydration errors with MapLibre GL.

**Types:** `lib/types.ts` mirrors `models/schemas.py` — keep these in sync manually when changing Pydantic models.

**Design tokens** (Tailwind):
- Primary: `#667eea` (indigo), Secondary: `#764ba2` (purple)
- RAG: Red `#c0392b`, Amber `#d35400`, Green `#27ae60`

### Alert Service Logic

- **Conflict Index** (0–10): average of deadliness + geographic diffusion + civilian danger + actor fragmentation, each normalized 0–10.
- **RAG thresholds**: Red if CI > 6 OR MoM deaths > +50%; Amber if CI 3–6 OR MoM > +20%; Green otherwise. Thresholds are query-param configurable.
- **Statistical escalation**: z-score > 2 vs 12-month monthly baseline.

### Environment Variables

**Backend** (`.env`):
```
ANTHROPIC_API_KEY=...
DATA_PATH=...
CACHE_DIR=...
CORS_ORIGINS=http://localhost:3000
ACLED_DATA_PATH=...
```

**Frontend** (`.env.local`):
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```
