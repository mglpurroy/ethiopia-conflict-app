# CLAUDE.md

Working notes for agents operating in this repository.

## Current Product State

- Country scope: Ethiopia only.
- Primary v1 user flows:
1. `/` Home
2. `/spatial` Interactive Maps
3. `/explorer` Trend Analysis
4. `/absolute-data` Absolute Data
- World Bank routes are not mounted in `backend/main.py` for active runtime.

## Local Commands

```bash
# Start backend + frontend together
./dev.sh

# Backend only
cd backend
uv run uvicorn main:app --reload --port 8000

# Frontend only
cd frontend
npm run dev
```

- Frontend: `http://localhost:3000`
- Backend docs: `http://localhost:8000/docs`
- Health: `http://localhost:8000/api/health`

## Stack

- Backend: FastAPI + pandas/geopandas (file-based data, in-memory + pickle cache)
- Frontend: Next.js App Router + TypeScript + MapLibre + Recharts
- Package/runtime tools:
1. Python via `uv` (backend)
2. Node/npm (frontend)

## Data Paths

Runtime data is under `backend/data/`:
- `acled_Ethiopia.csv`
- `acled_Ethiopia_light.csv`
- `population_data.json`
- `processed/intersection_result_acled.csv`
- `eth_adm_csa_bofedb_2021_shp/*`

## Backend Layout

- `backend/main.py`: app creation, CORS, router registration, cache warmup.
- `backend/services/conflict_service.py`: core conflict loading, period generation, classification logic, trends, aggregates.
- `backend/services/spatial_service.py`: boundaries, map GeoJSON, event GeoJSON, unit history.
- `backend/services/alert_service.py`: alert/conflict-index helpers.
- `backend/services/ai_service.py`: AI narratives for location/actor summaries.

Routers mounted under `/api`:
- `conflicts.py`
- `spatial.py`
- `meta.py`
- `trends.py`
- `absolute.py`
- `alerts.py`
- `actors.py`
- `exports.py`

## Frontend Layout

- `frontend/app/spatial/page.tsx`: controls + map + analytics charts under map.
- `frontend/components/map/ConflictMap.tsx`: MapLibre choropleth/events rendering, drill-down, hover/click behavior.
- `frontend/lib/api.ts`: API client wrappers.
- `frontend/lib/types.ts`: shared frontend types.

## Spatial Behavior (Current)

- Period dropdown uses `/api/meta/periods`.
- Admin controls are Ethiopia hierarchy: Regions, Zones, Woredas.
- Conflict map uses 4 status classes:
1. No reported violence
2. Below threshold
3. Conflict-Affected
4. Highly Conflict-Affected
- Double-click drill behavior:
1. Region -> Zones
2. Zone -> Woredas
3. Woreda -> zoom to woreda extent
- Detailed incidents overlay can be toggled on and is period/location scoped.

## Notes for Future Edits

- Keep backend schemas and frontend types aligned.
- Preserve Ethiopia naming and admin terminology in new code and UI text.
- Prefer extending existing service functions over creating parallel logic paths.
