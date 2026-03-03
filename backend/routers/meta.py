"""Metadata endpoints (period presets, static lookup data)."""

from fastapi import APIRouter, HTTPException

from services.conflict_service import generate_12_month_periods

router = APIRouter(tags=["meta"])


@router.get("/meta/periods")
def periods():
    """Return deterministic 12-month period presets (newest first)."""
    try:
        return {"periods": generate_12_month_periods()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
