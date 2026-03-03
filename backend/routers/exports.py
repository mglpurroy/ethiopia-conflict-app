"""Data export endpoints — CSV, Excel, and HTML reports."""

from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import StreamingResponse, HTMLResponse
from typing import Optional
import pandas as pd
import io
import os

from services.conflict_service import (
    classify_and_aggregate,
    generate_12_month_periods,
    get_by_admin,
    get_period_by_id,
    load_conflict_data,
    load_population_data,
    load_raw_acled,
)

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
    """Serve a legacy FCV monitor HTML report if present."""
    path = os.path.join(DATA_DIR, "nigeria-fcv-monitor.html")
    legacy_path = os.path.join(DATA_DIR, "_legacy_nigeria", "nigeria-fcv-monitor.html")
    try:
        if not os.path.exists(path) and os.path.exists(legacy_path):
            path = legacy_path
        with open(path, "r", encoding="utf-8") as f:
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
            headers={"Content-Disposition": "attachment; filename=ethiopia_conflict_events.csv"},
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
            headers={"Content-Disposition": "attachment; filename=ethiopia_conflict_report.xlsx"},
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/export/aggregated")
def export_aggregated(
    period_id: Optional[str] = Query(None, description="Period id from /api/meta/periods"),
    level: str = Query("ADM2", pattern="^(ADM1|ADM2|ADM3)$"),
    conflict_metric: str = Query("conflict_affected", pattern="^(conflict_affected|highly_conflict_affected)$"),
    agg_thresh: float = Query(0.2, ge=0, le=1),
):
    """Export conflict classification aggregates as CSV."""
    try:
        if period_id:
            period = get_period_by_id(period_id)
            if not period:
                raise HTTPException(status_code=400, detail=f"Unknown period_id: {period_id}")
        else:
            period = generate_12_month_periods()[0]

        if conflict_metric == "highly_conflict_affected":
            rate_thresh, abs_thresh = 10.0, 40
        else:
            rate_thresh, abs_thresh = 2.0, 10

        pop = load_population_data()
        conflict = load_conflict_data()
        agg_level = "ADM1" if level == "ADM1" else "ADM2"
        aggregated, wards = classify_and_aggregate(
            pop,
            conflict,
            period["start_year"],
            period["start_month"],
            period["end_year"],
            period["end_month"],
            rate_thresh=rate_thresh,
            abs_thresh=abs_thresh,
            agg_thresh=agg_thresh,
            agg_level=agg_level,
        )

        df = wards if level == "ADM3" else aggregated
        buf = io.StringIO()
        df.to_csv(buf, index=False)
        buf.seek(0)
        filename = f"ethiopia_{level.lower()}_{period['id']}_aggregated.csv"
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/export/absolute-summary")
def export_absolute_summary(
    pcodes: str = Query(..., description="Comma-separated location PCODEs"),
    level: str = Query("ADM3", pattern="^(ADM1|ADM2|ADM3)$"),
    start_year: Optional[int] = Query(None),
    start_month: Optional[int] = Query(None, ge=1, le=12),
    end_year: Optional[int] = Query(None),
    end_month: Optional[int] = Query(None, ge=1, le=12),
):
    """Export multi-location absolute totals (events/deaths) as CSV."""
    try:
        selected = [p.strip() for p in pcodes.split(",") if p.strip()]
        selected = list(dict.fromkeys(selected))
        if not selected:
            raise HTTPException(status_code=400, detail="pcodes must include at least one value")
        if len(selected) > 25:
            raise HTTPException(status_code=400, detail="pcodes supports up to 25 locations")

        code_col = f"{level}_PCODE"
        name_col = f"{level}_EN"
        conflict = load_conflict_data().copy()
        pop = load_population_data()

        if code_col not in conflict.columns:
            raise HTTPException(status_code=400, detail=f"Unsupported level `{level}`")

        if start_year is not None:
            sm = start_month or 1
            conflict = conflict[
                (conflict["year"] > start_year) | ((conflict["year"] == start_year) & (conflict["month"] >= sm))
            ]
        if end_year is not None:
            em = end_month or 12
            conflict = conflict[
                (conflict["year"] < end_year) | ((conflict["year"] == end_year) & (conflict["month"] <= em))
            ]

        summary = (
            conflict[conflict[code_col].isin(selected)]
            .groupby(code_col, as_index=False)
            .agg(
                total_deaths=("ACLED_BRD_total", "sum"),
                total_events=("event_count", "sum"),
                months_with_data=("month", "count"),
            )
        )

        lookup = (
            pop[[code_col, name_col]]
            .dropna(subset=[code_col])
            .drop_duplicates(subset=[code_col])
            .set_index(code_col)[name_col]
            .to_dict()
            if code_col in pop.columns and name_col in pop.columns
            else {}
        )
        summary[name_col] = summary[code_col].map(lookup).fillna(summary[code_col])
        summary["average_monthly_deaths"] = summary["total_deaths"] / summary["months_with_data"].replace(0, 1)
        summary["average_monthly_events"] = summary["total_events"] / summary["months_with_data"].replace(0, 1)

        summary = summary[
            [code_col, name_col, "total_deaths", "total_events", "months_with_data", "average_monthly_deaths", "average_monthly_events"]
        ].sort_values("total_deaths", ascending=False)

        buf = io.StringIO()
        summary.to_csv(buf, index=False)
        buf.seek(0)
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=ethiopia_absolute_summary.csv"},
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
