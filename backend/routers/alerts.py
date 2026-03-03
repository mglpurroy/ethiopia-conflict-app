"""Alert and Early Warning endpoints."""

from fastapi import APIRouter, Query, HTTPException
from typing import Optional

from services.alert_service import (
    compute_rag_status,
    compute_conflict_index,
    compute_changes,
    get_alerts_summary,
)

router = APIRouter(tags=["alerts"])


@router.get("/alerts/status")
def alert_status(
    ci_red: float = Query(6.0),
    ci_amber: float = Query(3.0),
    mom_red: float = Query(0.5),
    mom_amber: float = Query(0.2),
):
    try:
        return compute_rag_status(ci_red, ci_amber, mom_red, mom_amber)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/alerts/conflict-index")
def conflict_index(reference_days: int = Query(365, ge=30, le=1825)):
    try:
        return compute_conflict_index(reference_days)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/alerts/changes")
def changes(comparison_days: int = Query(30, ge=7, le=180)):
    try:
        return compute_changes(comparison_days)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/alerts/summary")
def alerts_summary():
    try:
        return get_alerts_summary()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
