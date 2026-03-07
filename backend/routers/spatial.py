"""Spatial / GeoJSON endpoints."""

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import JSONResponse
from typing import Optional

from services.spatial_service import (
    get_boundaries_geojson,
    get_choropleth_data,
    get_unit_history,
    get_events_geojson,
    get_classification_geojson,
    get_psnp_woredas_geojson,
)
from services.ai_service import get_unit_summary

router = APIRouter(tags=["spatial"])


@router.get("/spatial/boundaries/{level}")
def boundaries(level: int):
    if level not in (1, 2, 3):
        raise HTTPException(status_code=400, detail="level must be 1, 2, or 3")
    try:
        data = get_boundaries_geojson(level)
        return JSONResponse(content=data, headers={"Cache-Control": "public, max-age=86400"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/spatial/choropleth")
def choropleth(
    level: int = Query(1, ge=1, le=3),
    variable: str = Query("deaths", pattern="^(deaths|rate|ward_share|events|density)$"),
    start_year: Optional[int] = Query(None),
    start_month: Optional[int] = Query(None, ge=1, le=12),
    end_year: Optional[int] = Query(None),
    end_month: Optional[int] = Query(None, ge=1, le=12),
    rate_thresh: float = Query(2.0),
    abs_thresh: int = Query(10),
    agg_thresh: float = Query(0.2),
    affected_only: bool = Query(False),
    parent_pcode: str = Query(''),
):
    try:
        data = get_choropleth_data(
            level=level,
            variable=variable,
            start_year=start_year,
            start_month=start_month,
            end_year=end_year,
            end_month=end_month,
            rate_thresh=rate_thresh,
            abs_thresh=abs_thresh,
            agg_thresh=agg_thresh,
            affected_only=affected_only,
            parent_pcode=parent_pcode,
        )
        return JSONResponse(content=data, headers={"Cache-Control": "public, max-age=3600"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/spatial/events")
def events(
    period_id: Optional[str] = Query(None),
    start_year: Optional[int] = Query(None),
    start_month: Optional[int] = Query(None, ge=1, le=12),
    end_year: Optional[int] = Query(None),
    end_month: Optional[int] = Query(None, ge=1, le=12),
    level: Optional[int] = Query(None, ge=1, le=3),
    pcode: str = Query(""),
    name: str = Query(""),
    limit: int = Query(5000, ge=1, le=50000),
):
    try:
        data = get_events_geojson(
            start_year=start_year,
            start_month=start_month,
            end_year=end_year,
            end_month=end_month,
            limit=limit,
            period_id=period_id,
            level=level,
            pcode=pcode,
            name=name,
        )
        return JSONResponse(content=data, headers={"Cache-Control": "public, max-age=3600"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/spatial/classification")
def classification(
    period_id: str = Query(..., description="Period id from /api/meta/periods"),
    map_view: str = Query("regions_zones", pattern="^(regions_zones|woredas)$"),
    agg_level: str = Query("ADM2", pattern="^(ADM1|ADM2|ADM3)$"),
    analysis_type: str = Query("conflict_metrics", pattern="^(conflict_metrics|trajectory)$"),
    map_var: str = Query("share_woredas", pattern="^(share_woredas|share_population)$"),
    conflict_metric: str = Query("conflict_affected", pattern="^(conflict_affected|highly_conflict_affected)$"),
    parent_pcode: str = Query(""),
    parent_level: Optional[int] = Query(None, ge=1, le=2),
    trajectory_categories: Optional[str] = Query(
        None, description="Comma-separated trajectory categories to include"
    ),
):
    try:
        cats = (
            [c.strip() for c in trajectory_categories.split(",") if c.strip()]
            if trajectory_categories
            else None
        )
        data = get_classification_geojson(
            period_id=period_id,
            map_view=map_view,
            agg_level=agg_level,
            analysis_type=analysis_type,
            map_var=map_var,
            conflict_metric=conflict_metric,
            parent_pcode=parent_pcode,
            parent_level=parent_level,
            trajectory_categories=cats,
        )
        return JSONResponse(content=data, headers={"Cache-Control": "public, max-age=3600"})
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/spatial/unit-summary")
def unit_summary(
    level: int = Query(1, ge=1, le=3),
    name: str = Query(''),
    start_year: Optional[int] = Query(None),
    start_month: Optional[int] = Query(None, ge=1, le=12),
    end_year: Optional[int] = Query(None),
    end_month: Optional[int] = Query(None, ge=1, le=12),
):
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    try:
        data = get_unit_summary(level, name, start_year, start_month, end_year, end_month)
        return JSONResponse(content=data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/spatial/psnp-woredas")
def psnp_woredas():
    """GeoJSON FeatureCollection of PSNP woreda centroids (EFY 2018 list)."""
    try:
        data = get_psnp_woredas_geojson()
        return JSONResponse(content=data, headers={"Cache-Control": "public, max-age=86400"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/spatial/unit-history")
def unit_history(
    level: int = Query(1, ge=1, le=3),
    pcode: str = Query(''),
    name: str = Query(''),
):
    try:
        data = get_unit_history(level=level, pcode=pcode, name=name)
        return JSONResponse(content=data)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
