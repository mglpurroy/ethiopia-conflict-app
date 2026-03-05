from fastapi import APIRouter, Query
from services.wb_service import load_wb_projects, get_projects_by_unit, get_wb_state_summary

router = APIRouter(tags=["wb-projects"])


@router.get("/wb-projects")
def get_wb_projects(
    status: str | None = Query(None, description="Filter by project status (Active, Closed, Dropped, Pipeline)"),
):
    """GeoJSON FeatureCollection of World Bank project sites merged with project metadata."""
    return load_wb_projects(status_filter=status)


@router.get("/wb-projects/state-summary")
def wb_state_summary_endpoint():
    """Aggregated WB project stats per state (active count + total commitment)."""
    return get_wb_state_summary()


@router.get("/wb-projects/by-unit")
def get_wb_projects_by_unit(
    level: int = Query(..., description="Admin level: 1=admin-1, 2=admin-2, 3=admin-3"),
    name: str = Query(..., description="Unit name (e.g. 'Amhara', 'Amhara Region')"),
    status: str | None = Query(None, description="Optional status filter"),
):
    """List of WB projects whose sites fall within the specified admin unit."""
    return get_projects_by_unit(level=level, name=name, status_filter=status)
