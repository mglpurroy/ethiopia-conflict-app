# Ethiopia Dashboard Migration Backlog

## Objective
Ship a production-ready Ethiopia dashboard on the same core architecture as the Nigeria app:
- FastAPI backend (data + analytics + geo APIs)
- Next.js frontend (typed API client + React Query + MapLibre UI)
- Containerized deploy (Render + optional Nginx + local Docker Compose)

## Target State
- ETH dataset parity with current Streamlit outputs.
- Nigeria-style UX baseline: sidebar shell, KPI strip, map-first page, drill-down panels, explorer/actors/reports pages.
- Stable deploy pipeline with health checks, env-driven config, and reproducible images.

## Backlog

### 1. Repository and Architecture Scaffold
- [ ] Create ETH project structure mirroring Nigeria layout (`backend/`, `frontend/`, `nginx/`, `docker-compose.yml`, `render.yaml`).
- [ ] Add environment contract docs (`backend/.env.example`, `frontend/.env.local.example`).
- [ ] Add shared architecture README with request flow and data flow diagrams.
- [ ] Define API versioning strategy (`/api/*`) and naming conventions.

**Acceptance**
- New repo boots with placeholder API + frontend route.
- Local startup command runs both services.

### 2. Data Ingestion and Canonical Models
- [ ] Move ETH data-loading logic from Streamlit `utils/data_loader.py` into backend services.
- [ ] Standardize schemas for ACLED events, admin boundaries (ADM1/ADM2/ADM3), population, and optional WB data.
- [ ] Add canonical column mapping layer (raw-to-internal field names).
- [ ] Add cache tiers: in-memory TTL + disk pickle cache.
- [ ] Add startup data validation checks (required files, required columns, CRS checks).

**Acceptance**
- Backend can load ETH data without Streamlit dependencies.
- Data validation errors are explicit and fail fast.

### 3. Backend Domain Services
- [ ] Implement `conflict_service` for summary KPIs, filtered events, timeseries, admin aggregation.
- [ ] Implement `spatial_service` for boundaries GeoJSON, choropleth attributes, events GeoJSON, unit history.
- [ ] Implement `alerts_service` for conflict index + status classification + change detection.
- [ ] Implement optional `ai_service` for unit/actor narrative summaries (feature-flagged).
- [ ] Add strict response models (`pydantic`) for all endpoints.

**Acceptance**
- Service layer has no FastAPI imports.
- All responses are typed and serialization-safe.

### 4. Backend API Surface
- [ ] Implement routers:
  - [ ] `/api/summary`
  - [ ] `/api/conflicts`, `/api/conflicts/timeseries`, `/api/conflicts/by-admin`
  - [ ] `/api/spatial/boundaries/{level}`, `/api/spatial/choropleth`, `/api/spatial/events`, `/api/spatial/unit-history`, `/api/spatial/unit-summary`
  - [ ] `/api/alerts/status`, `/api/alerts/conflict-index`, `/api/alerts/changes`, `/api/alerts/summary`
  - [ ] `/api/actors` and actor detail endpoints (activity series, geography, profile)
  - [ ] `/api/export/csv`, `/api/export/excel`
- [ ] Add `/api/health` and startup cache warm-up.
- [ ] Add pagination/limits on heavy endpoints.

**Acceptance**
- Swagger docs complete and usable.
- Endpoint latency acceptable on cached path.

### 5. Frontend Foundation
- [ ] Scaffold Next.js App Router project aligned with Nigeria setup.
- [ ] Add app shell + sidebar navigation.
- [ ] Add typed API client (`lib/api.ts`) and TS models (`lib/types.ts`).
- [ ] Add React Query provider and hooks for alerts/conflicts/spatial/actors.
- [ ] Implement global design tokens in `globals.css` and Tailwind config.

**Acceptance**
- Frontend can render with mock and live API data.
- Hook cache/stale policy defined per endpoint class.

### 6. Map and Interaction Layer
- [ ] Implement MapLibre component equivalent to Nigeria `ConflictMap`.
- [ ] Add choropleth rendering for ADM1/ADM2/ADM3 with variable toggles.
- [ ] Add event point overlay with type filters.
- [ ] Add drill-down interactions (state/region -> zone -> woreda) with breadcrumb context.
- [ ] Add unit click panel for trend, actors, summary, and co-located projects (if enabled).

**Acceptance**
- Map interactions are stable across filter changes.
- GeoJSON payload sizes remain performant.

### 7. Page Parity (Nigeria-style)
- [ ] Dashboard page: KPI strip + map workspace + ranked table.
- [ ] Explorer page: timeseries by frequency/dimension with filters.
- [ ] Actors page: top actor table + activity series + geography + profile.
- [ ] Reports page: CSV/Excel export + static briefing link.
- [ ] Optional early-warning and dedicated spatial pages retained or hidden by nav config.

**Acceptance**
- Navigation is coherent and all visible pages are production-ready.

### 8. Visual Design Upgrade
- [ ] Replace Streamlit-style visual patterns with consistent component system.
- [ ] Implement hierarchy rules: strong header, compact controls, map-first layout, readable data density.
- [ ] Add standardized color semantics for status, thresholds, and event types.
- [ ] Improve mobile behavior for filter drawers, tables, and side panels.

**Acceptance**
- Dashboard is visually consistent and usable on desktop/tablet/mobile.

### 9. Exports and Reporting
- [ ] Implement CSV export for filtered events.
- [ ] Implement multi-sheet Excel export (events + admin summaries + ward/woreda aggregates).
- [ ] Add static HTML report endpoint integration where needed.

**Acceptance**
- Export files open cleanly and reflect active filters.

### 10. Deployment and Runtime
- [ ] Containerize backend with geospatial system dependencies.
- [ ] Containerize frontend with standalone build output.
- [ ] Configure `render.yaml` for backend and frontend services.
- [ ] Configure CORS and frontend API URL wiring.
- [ ] Configure persistent cache path and data path mounts where required.
- [ ] Keep optional Nginx proxy for single-host deployment.

**Acceptance**
- Clean deploy on Render from main branch.
- Health checks pass and frontend can call backend in production.

### 11. Quality Gates
- [ ] Add backend unit tests for core aggregations and alert logic.
- [ ] Add API integration smoke tests for critical endpoints.
- [ ] Add frontend smoke tests for key pages and map mount.
- [ ] Add lint/type checks in CI.
- [ ] Add seed performance checks for largest GeoJSON endpoints.

**Acceptance**
- CI blocks merges on test/lint/type failures.

### 12. Release Hardening
- [ ] Add observability basics (request logging, error logging, startup diagnostics).
- [ ] Add graceful fallback behavior for missing optional features (AI key absent, WB data absent).
- [ ] Add data refresh runbook and cache invalidation steps.
- [ ] Finalize operations docs (deploy, rollback, env var matrix, troubleshooting).

**Acceptance**
- On-call handoff is possible with repo docs only.

## Execution Order
1. Repository and architecture scaffold  
2. Data ingestion and canonical models  
3. Backend services and APIs  
4. Frontend foundation  
5. Map and page parity  
6. Visual upgrade  
7. Exports and deployment  
8. Quality gates and release hardening

## Definition of Done
- ETH dashboard runs on FastAPI + Next + MapLibre with production deployment config.
- Core analytics and map outputs match current ETH dashboard behavior.
- UI reaches Nigeria-style baseline quality with stable interactions and typed data flow.
- CI checks and operational docs are in place for maintainable ownership.
