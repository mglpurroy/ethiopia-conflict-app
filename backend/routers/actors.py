"""Actor profile endpoints."""

from fastapi import APIRouter, Query, HTTPException
from typing import Optional, List
import pandas as pd

from services.conflict_service import load_raw_acled, get_actors
from services.ai_service import get_actor_profile

router = APIRouter(tags=["actors"])


def _parse_event_types(event_types: Optional[str]) -> Optional[List[str]]:
    """Parse comma-separated event_types query param into a list, or None if empty."""
    if not event_types:
        return None
    return [t.strip() for t in event_types.split(',') if t.strip()]


@router.get("/actors")
def actors(
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    top_n: int = Query(20, ge=5, le=100),
    event_types: Optional[str] = Query(None, description="Comma-separated event types to include"),
    actor_types: Optional[str] = Query(None, description="Comma-separated inter1/inter2 actor types to include"),
):
    try:
        return get_actors(start, end, top_n, _parse_event_types(event_types), _parse_event_types(actor_types))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/actors/{actor_name}/timeline")
def actor_timeline(
    actor_name: str,
    frequency: str = Query("monthly", pattern="^(monthly|quarterly|yearly)$"),
    event_types: Optional[str] = Query(None, description="Comma-separated event types to include"),
):
    try:
        df = load_raw_acled()
        actor_df = df[(df['actor1'] == actor_name) | (df['actor2'] == actor_name)].copy()
        et = _parse_event_types(event_types)
        if et:
            actor_df = actor_df[actor_df['event_type'].isin(et)]
        if frequency == 'yearly':
            actor_df['period'] = actor_df['event_date'].dt.to_period('Y').astype(str)
        elif frequency == 'quarterly':
            actor_df['period'] = actor_df['event_date'].dt.to_period('Q').astype(str)
        else:
            actor_df['period'] = actor_df['event_date'].dt.to_period('M').astype(str)
        agg = actor_df.groupby('period').agg(
            events=('event_id_cnty', 'count'),
            deaths=('fatalities', 'sum'),
        ).reset_index()
        return agg.to_dict(orient='records')
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/actors/{actor_name}/profile")
def actor_profile(actor_name: str):
    try:
        return get_actor_profile(actor_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/actors/{actor_name}/geography")
def actor_geography(
    actor_name: str,
    event_types: Optional[str] = Query(None, description="Comma-separated event types to include"),
):
    try:
        df = load_raw_acled()
        actor_df = df[(df['actor1'] == actor_name) | (df['actor2'] == actor_name)]
        et = _parse_event_types(event_types)
        if et:
            actor_df = actor_df[actor_df['event_type'].isin(et)]
        agg = actor_df.groupby(['admin1', 'admin2']).agg(
            events=('event_id_cnty', 'count'),
            deaths=('fatalities', 'sum'),
        ).reset_index()
        return agg.to_dict(orient='records')
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
