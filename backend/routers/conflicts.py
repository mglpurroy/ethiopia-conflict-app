"""Conflict data endpoints."""

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import Response
from typing import Optional
import pandas as pd

from services.conflict_service import (
    get_summary_kpis,
    get_timeseries,
    get_by_admin,
    get_filtered_events,
    load_raw_acled,
)
from services.spatial_service import get_by_ward

router = APIRouter(tags=["conflicts"])


@router.get("/summary")
def summary(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
):
    try:
        return get_summary_kpis(start_date, end_date)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/conflicts")
def conflicts(
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    states: Optional[str] = Query(None, description="Comma-separated state names"),
    event_type: Optional[str] = Query(None, description="Comma-separated event types"),
    limit: int = Query(1000, le=10000),
):
    try:
        states_list = [s.strip() for s in states.split(",")] if states else None
        types_list = [t.strip() for t in event_type.split(",")] if event_type else None
        df = load_raw_acled()
        if start:
            df = df[df['event_date'] >= pd.to_datetime(start)]
        if end:
            df = df[df['event_date'] <= pd.to_datetime(end)]
        if states_list:
            df = df[df['admin1'].isin(states_list)]
        if types_list:
            df = df[df['event_type'].isin(types_list)]
        df = df.sort_values('fatalities', ascending=False).head(limit)
        df['event_date'] = df['event_date'].astype(str)
        cols = ['event_id_cnty', 'event_date', 'event_type', 'sub_event_type',
                'actor1', 'actor2', 'admin1', 'admin2', 'admin3', 'location',
                'latitude', 'longitude', 'fatalities', 'notes']
        cols = [c for c in cols if c in df.columns]
        # Use pandas to_json which serialises NaN→null correctly, then return as raw JSON
        return Response(content=df[cols].to_json(orient='records'), media_type='application/json')
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/conflicts/timeseries")
def timeseries(
    frequency: str = Query("monthly", pattern="^(monthly|quarterly|yearly)$"),
    dimension: str = Query("event_type", pattern="^(event_type|sub_event_type|actor)$"),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    states: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
):
    try:
        states_list = [s.strip() for s in states.split(",")] if states else None
        types_list = [t.strip() for t in event_type.split(",")] if event_type else None
        return get_timeseries(frequency, dimension, start, end, states_list, types_list)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/conflicts/by-admin")
def by_admin(
    level: int = Query(1, ge=1, le=3),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    parent: Optional[str] = Query(None, description="Parent unit name to filter by (LGA name for level 3)"),
):
    try:
        if level == 3:
            return get_by_ward(start_date=start, end_date=end, parent_lga=parent)
        return get_by_admin(level, start, end)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
