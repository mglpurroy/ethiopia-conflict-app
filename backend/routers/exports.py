"""Data export endpoints — CSV, Excel, and HTML reports."""

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import StreamingResponse, HTMLResponse
from typing import Optional
import pandas as pd
import io
import os

from services.conflict_service import load_raw_acled, load_conflict_data, get_by_admin

DATA_DIR = os.path.join(os.path.dirname(__file__), '..', 'data')

router = APIRouter(tags=["exports"])


def _filter_df(
    df: pd.DataFrame,
    start: Optional[str],
    end: Optional[str],
    states: Optional[str],
    event_type: Optional[str],
) -> pd.DataFrame:
    if start:
        df = df[df['event_date'] >= pd.to_datetime(start)]
    if end:
        df = df[df['event_date'] <= pd.to_datetime(end)]
    if states:
        state_list = [s.strip() for s in states.split(",")]
        df = df[df['admin1'].isin(state_list)]
    if event_type:
        type_list = [t.strip() for t in event_type.split(",")]
        df = df[df['event_type'].isin(type_list)]
    return df


@router.get("/export/fcv-monitor", response_class=HTMLResponse)
def fcv_monitor_report():
    """Serve the Nigeria FCV Risk Monitor HTML briefing."""
    path = os.path.join(DATA_DIR, 'nigeria-fcv-monitor.html')
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="FCV Monitor report not found")


@router.get("/export/csv")
def export_csv(
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    states: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
):
    try:
        df = load_raw_acled()
        df = _filter_df(df, start, end, states, event_type)
        df['event_date'] = df['event_date'].astype(str)
        buf = io.StringIO()
        df.to_csv(buf, index=False)
        buf.seek(0)
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=nigeria_conflict_events.csv"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/export/excel")
def export_excel(
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    states: Optional[str] = Query(None),
    event_type: Optional[str] = Query(None),
):
    try:
        raw = load_raw_acled()
        events_df = _filter_df(raw.copy(), start, end, states, event_type)
        events_df['event_date'] = events_df['event_date'].astype(str)

        state_agg = get_by_admin(1, start, end)
        state_df = pd.DataFrame(state_agg)

        ward_data = load_conflict_data()

        buf = io.BytesIO()
        with pd.ExcelWriter(buf, engine='openpyxl') as writer:
            events_df.to_excel(writer, sheet_name='Events', index=False)
            state_df.to_excel(writer, sheet_name='State Summary', index=False)
            ward_data.head(5000).to_excel(writer, sheet_name='Ward Aggregates', index=False)
        buf.seek(0)

        return StreamingResponse(
            iter([buf.read()]),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=nigeria_conflict_report.xlsx"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
