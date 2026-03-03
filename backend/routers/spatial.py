"""Spatial / GeoJSON endpoints."""

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import JSONResponse
from typing import Optional

from services.spatial_service import get_boundaries_geojson, get_choropleth_data, get_unit_history, get_events_geojson
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
    variable: str = Query("deaths", pattern="^(deaths|rate|ward_share)$"),
    start_year: Optional[int] = Query(None),
    start_month: Optional[int] = Query(None, ge=1, le=12),
    end_year: Optional[int] = Query(None),
    end_month: Optional[int] = Query(None, ge=1, le=12),
    rate_thresh: float = Query(10.0),
    abs_thresh: int = Query(5),
    agg_thresh: float = Query(0.1),
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
    start_year: Optional[int] = Query(None),
    start_month: Optional[int] = Query(None, ge=1, le=12),
    end_year: Optional[int] = Query(None),
    end_month: Optional[int] = Query(None, ge=1, le=12),
    limit: int = Query(5000, ge=1, le=50000),
):
    try:
        data = get_events_geojson(start_year, start_month, end_year, end_month, limit)
        return JSONResponse(content=data, headers={"Cache-Control": "public, max-age=3600"})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/spatial/unit-summary")
def unit_summary(
    level: int = Query(1, ge=1, le=2),
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
