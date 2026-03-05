# Ethiopia Dashboard Modernization Backlog (Data-First Revision)

## Summary
This revision puts **data acquisition first** before any app modernization work.  
Because this turn is in Plan Mode (no file mutations), the first executable task is to create and commit the backlog markdown file at [ETHIOPIA_NIGERIA_STYLE_BACKLOG.md](/Users/emmettsexton/Documents/GitHub/ethiopia-conflict-app/ETHIOPIA_NIGERIA_STYLE_BACKLOG.md) after data sync is complete.

Chosen defaults:
- Scope: core 3 flows only (Interactive Maps, Trend Analysis, Absolute Data).
- WB integration: removed for v1.
- Time model: 12‑month presets first.
- Raster handling: skip `eth_ppp_2020.tif` initially (not required for runtime because `population_data.json` exists).

## Public APIs / Interfaces To Add or Change
1. Add `GET /api/meta/periods`.
2. Add `GET /api/spatial/classification`.
3. Extend/replace `GET /api/spatial/events` with location + `period_id` filtering.
4. Add `GET /api/trends/location`.
5. Add `GET /api/absolute/series`.
6. Add exports: `GET /api/export/aggregated`, `GET /api/export/absolute-summary`.
7. Remove WB routes from active app wiring for v1 (`/api/wb-projects*` not used by UI).
8. Update frontend types in `frontend/lib/types.ts` to match new schemas.

## Backlog (Decision-Complete, Ordered)

1. **BL-000: Source data acquisition plan (must execute first)**
Define canonical source as `https://github.com/mglpurroy/ethiopia-dashboard` and canonical destination under `backend/data/`.
Use this exact mapping:
`data/acled_Ethiopia.csv` → `backend/data/acled_Ethiopia.csv`
`data/acled_Ethiopia_light.csv` → `backend/data/acled_Ethiopia_light.csv`
`data/population_data.json` → `backend/data/population_data.json`
`data/processed/intersection_result_acled.csv` → `backend/data/processed/intersection_result_acled.csv`
`data/eth_adm_csa_bofedb_2021_shp/*` → `backend/data/eth_adm_csa_bofedb_2021_shp/*`
Do not copy `data/eth_ppp_2020.tif` in v1.

2. **BL-001: Execute data copy into logical places**
Create a repeatable sync script (e.g., `backend/scripts/sync_ethiopia_source_data.sh`) that clones/pulls source and copies mapped files.
Script must be idempotent and safe to re-run.

3. **BL-002: Data integrity verification**
Add a verification script (e.g., `backend/scripts/verify_ethiopia_data.py`) that checks:
file existence, required columns, non-empty datasets, parseable dates, expected ADM columns.
Fail with actionable errors.

4. **BL-003: Archive conflicting legacy data assets**
Move prior-country runtime data to `backend/data/_legacy_country/` to avoid accidental load.
Do not hard-delete in v1.

5. **BL-004: Persist backlog markdown file in repo**
Write this backlog to [ETHIOPIA_NIGERIA_STYLE_BACKLOG.md](/Users/emmettsexton/Documents/GitHub/ethiopia-conflict-app/ETHIOPIA_NIGERIA_STYLE_BACKLOG.md) immediately after BL-001/BL-002, before implementation tasks.

6. **BL-005: Backend path and loader refactor for Ethiopia**
Update services to default to Ethiopia file names/paths and ADM geometry set:
raw ACLED from `backend/data/acled_Ethiopia.csv`
processed conflict from `backend/data/processed/intersection_result_acled.csv`
boundaries from `backend/data/eth_adm_csa_bofedb_2021_shp/`.
Remove prior-country defaults (legacy ACLED filenames and prior admin naming assumptions).

7. **BL-006: Period preset service**
Implement canonical 12‑month period generator and `GET /api/meta/periods` with stable IDs.

8. **BL-007: Conflict classification engine**
Implement old Ethiopia threshold logic:
`conflict_affected`: death_rate >= 2 and deaths >= 10
`highly_conflict_affected`: death_rate >= 10 and deaths >= 40
Aggregate by ADM1/ADM2/ADM3 with shares and thresholds.

9. **BL-008: Trajectory engine**
Implement trajectory classes:
`At-Risk`, `Onset`, `Recovery`, `Turnaround`, `Stable`, `Fluctuating`, `Insufficient Data`.
Return both current state and historical supporting metrics.

10. **BL-009: Spatial classification API**
Add `GET /api/spatial/classification` to return map-ready GeoJSON for:
conflict-metrics mode and trajectory mode
regions/zones and woredas
selected period and category filters.

11. **BL-010: Detailed incident API**
Extend `GET /api/spatial/events` for `period_id` + selected location filtering and event metadata.

12. **BL-011: Trend API**
Add `GET /api/trends/location` for location-level historical series and computed trajectory.

13. **BL-012: Absolute analysis API**
Add `GET /api/absolute/series` with multi-location (max 25), granularity, and zero-filled aligned periods.

14. **BL-013: Remove WB services from active runtime**
Unregister WB routers in `backend/main.py` and remove WB references from frontend API/hooks/pages.
Keep code in branch history; v1 runtime must not depend on WB endpoints.

15. **BL-014: Frontend route focus**
Set active v1 navigation to:
`/` (Home), `/spatial` (Interactive Maps), `/explorer` (Trend), `/absolute-data` (Absolute Data).
Hide `/actors`, `/early-warning`, `/reports` from nav for v1.

16. **BL-015: Home page Ethiopia overview**
Replace legacy headline metrics and copy with Ethiopia “Current Situation” KPIs and quick start.

17. **BL-016: Interactive Maps page parity**
Implement controls from old Ethiopia flow:
period selector, map view (regions/zones vs woredas), analysis type, conflict metric, location finder/zoom, detailed incident toggle.

18. **BL-017: ConflictMap extension**
Enhance `frontend/components/map/ConflictMap.tsx` for trajectory rendering and detailed-incident mode while preserving existing design language and component boundaries.

19. **BL-018: Trend Analysis page parity**
Repurpose `/explorer` for location-level trend charts, trajectory badge, period-range filtering, detailed table, export.

20. **BL-019: Absolute Data page parity**
Create `/absolute-data` with level filters, up to 25 selected locations, granularity toggle, fatalities/events charts, detailed table, exports.

21. **BL-020: Type/schema synchronization**
Update backend Pydantic models and frontend TS interfaces together; block merges on mismatch.

22. **BL-021: Runtime config updates**
Update `dev.sh`, `docker-compose.yml`, and relevant env defaults to Ethiopia file paths.

23. **BL-022: Performance safeguards**
Cache heavy geospatial outputs by key `(period, level, mode, filters)`, simplify geometry by level, and cap incident payload size.

24. **BL-023: Test suite for data-first migration**
Add tests for:
data sync/verification scripts
period generation
classification thresholds
trajectory categories
new API contract snapshots.

25. **BL-024: Frontend integration smoke tests**
Add route/control smoke tests for 4 v1 routes and map API wiring.

26. **BL-025: Documentation refresh**
Update root docs with:
data sync command
required files and paths
v1 route map
API endpoints and expected schemas.

## Test Cases and Scenarios
1. Data sync script populates all mapped Ethiopia files in `backend/data/` and skips raster.
2. Data verification script passes on copied files and fails with clear messages when a required file/column is removed.
3. Backend boots using Ethiopia paths with no fallback to legacy defaults.
4. `/api/meta/periods` returns deterministic 12‑month presets in newest-first order.
5. `/api/spatial/classification` returns valid GeoJSON for both analysis modes and all admin levels.
6. `/api/spatial/events` correctly scopes incidents by `period_id` and location.
7. `/api/trends/location` returns series + trajectory consistent with classification logic.
8. `/api/absolute/series` returns aligned zero-filled series for selected locations.
9. UI shows no WB controls and no legacy branding on active v1 pages.
10. Core 3 flows function end-to-end with Ethiopia data only.

## Assumptions and Defaults
1. Data is fetched directly from the old Ethiopia repo as first step; no prior local dataset assumption remains.
2. `population_data.json` is sufficient for runtime; raster extraction workflows are optional and deferred.
3. Legacy prior-country data is archived, not deleted, during v1 transition.
4. No DB is introduced in v1; file-based + in-memory caching remains.
5. Core v1 scope is strictly Maps, Trend, Absolute Data.
