# Ethiopia Conflict App (v1 Migration Baseline)

This repository runs an Ethiopia-first dashboard with the established app structure, focused on 4 active routes:

- `/` Home
- `/spatial` Interactive Maps
- `/explorer` Trend Analysis
- `/absolute-data` Absolute Data

World Bank runtime routes are intentionally not wired into `backend/main.py` for v1.
Preprocessing scripts from the legacy Ethiopia repo are not ported in this phase; runtime uses synced processed outputs.

## Ethiopia Data Sync

Sync the required source files from the legacy Ethiopia repo:

```bash
./backend/scripts/sync_ethiopia_source_data.sh
```

By default this script pulls from:

- `https://github.com/mglpurroy/ethiopia-dashboard.git`

It copies:

- `data/acled_Ethiopia.csv` -> `backend/data/acled_Ethiopia.csv`
- `data/acled_Ethiopia_light.csv` -> `backend/data/acled_Ethiopia_light.csv`
- `data/population_data.json` -> `backend/data/population_data.json`
- `data/processed/intersection_result_acled.csv` -> `backend/data/processed/intersection_result_acled.csv`
- `data/eth_adm_csa_bofedb_2021_shp/*` -> `backend/data/eth_adm_csa_bofedb_2021_shp/*`

Raster is intentionally skipped in v1:

- `data/eth_ppp_2020.tif`

## Data Verification

Validate required files, columns, dates, and ADM geometry:

```bash
cd backend
uv run python scripts/verify_ethiopia_data.py
```

## API Endpoints (v1 Core)

- `GET /api/meta/periods`
- `GET /api/spatial/classification`
- `GET /api/spatial/events`
- `GET /api/trends/location`
- `GET /api/absolute/series`
- `GET /api/export/aggregated`
- `GET /api/export/absolute-summary`

Additional legacy endpoints still exist for compatibility (`/api/summary`, `/api/conflicts/*`, etc.), but the primary v1 UI uses the routes above.

## Schema Notes

- `GET /api/meta/periods`: returns deterministic 12-month period presets (`id`, `label`, `start_year`, `start_month`, `end_year`, `end_month`, `type`).
- `GET /api/spatial/classification`: GeoJSON FeatureCollection with conflict metrics or trajectory properties by selected map mode.
- `GET /api/spatial/events`: GeoJSON FeatureCollection of filtered ACLED points (period/location scoping supported).
- `GET /api/trends/location`: location metadata + trajectory + historical period series.
- `GET /api/absolute/series`: aligned zero-filled time series for selected PCODEs (max 25).

## Local Run

Backend:

```bash
cd backend
uv run uvicorn main:app --reload --port 8000
```

Frontend:

```bash
cd frontend
npm run dev
```

## Tests

Backend tests and smoke checks:

```bash
cd backend
uv run pytest
```
