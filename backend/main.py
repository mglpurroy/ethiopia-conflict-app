"""Ethiopia Conflict Monitoring API — FastAPI entry point."""

import os
from dotenv import load_dotenv
load_dotenv()

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import conflicts, spatial, alerts, actors, exports, meta, trends, absolute


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Warm up data caches on startup."""
    try:
        from services.conflict_service import load_conflict_data, load_population_data, load_raw_acled
        from services.spatial_service import load_admin_boundaries, _load_acled_admin3_join
        print("Warming up data caches...")
        load_raw_acled()
        load_conflict_data()
        load_population_data()
        load_admin_boundaries()
        _load_acled_admin3_join()
        print("Cache warm-up complete.")
    except Exception as e:
        print(f"Cache warm-up warning: {e}")
    yield


app = FastAPI(
    title="Ethiopia Conflict Monitoring API",
    version="1.0.0",
    description="Early Warning & Conflict Analytics API for Ethiopia — powered by ACLED data.",
    lifespan=lifespan,
)

cors_origins = os.getenv("CORS_ORIGINS", "*").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(conflicts.router, prefix="/api")
app.include_router(spatial.router, prefix="/api")
app.include_router(alerts.router, prefix="/api")
app.include_router(actors.router, prefix="/api")
app.include_router(exports.router, prefix="/api")
app.include_router(meta.router, prefix="/api")
app.include_router(trends.router, prefix="/api")
app.include_router(absolute.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "ethiopia-conflict-api"}
